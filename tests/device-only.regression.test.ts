// Regression for the SDK fail-open (ONLY_ON_DEVICE routed to the cloud when LanguageModel is
// missing), against the real @firebase/ai browser bundle. Every layer is tested on its own.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { getGenerativeModel, InferenceMode } from 'firebase/ai';
import { DeviceRuntimeMissingError } from '../src/ai/capability';
import { installEgressGuard, type EgressGuard } from '../src/ai/egress-guard';
import { createDeviceOnlyModel, LeakDetectedError } from '../src/ai/models';
import { fakeLanguageModel, fakeNetwork, LIVE, makeAI, setWindow } from './helpers';

const net = fakeNetwork();
let guard: EgressGuard;
const env = makeAI();
const spec = { system: 'You help.' };

beforeAll(() => {
  globalThis.fetch = net.fetch;
  guard = installEgressGuard(globalThis);
});
afterEach(() => {
  net.sent.length = 0;
  setWindow({});
});

describe('device-only route when the browser has no LanguageModel', () => {
  it('layer 1: the pre-check refuses before the SDK is touched', () => {
    setWindow({});
    expect(() => createDeviceOnlyModel(env.ai, spec, {})).toThrow(DeviceRuntimeMissingError);
    expect(net.sent).toHaveLength(0);
  });

  it('layer 2: if the pre-check is bypassed, the egress guard blocks the SDK fallback', async () => {
    setWindow({});
    const raw = getGenerativeModel(env.ai, { mode: InferenceMode.ONLY_ON_DEVICE });
    await expect(raw.generateContent(LIVE)).rejects.toThrow(/Sotto blocked an outgoing AI request/);
    expect(net.sent).toHaveLength(0);
    expect(guard.events.at(-1)).toMatchObject({ outcome: 'blocked', host: 'firebasevertexai.googleapis.com' });
  });

  it('layer 2 also covers the streaming path', async () => {
    setWindow({});
    const raw = getGenerativeModel(env.ai, { mode: InferenceMode.ONLY_ON_DEVICE });
    await expect(raw.generateContentStream(LIVE)).rejects.toThrow(/Sotto blocked/);
    expect(net.sent).toHaveLength(0);
  });

  it('layer 3: if a request somehow went to the cloud, the post-check discards the result', async () => {
    // Both other layers fail: the pre-check sees a runtime (env), the SDK sees none (window),
    // and a permit for this exact text happens to be armed.
    setWindow({});
    const model = createDeviceOnlyModel(env.ai, spec, { LanguageModel: fakeLanguageModel() });
    const disarm = guard.armCloudPermit({ texts: [LIVE] });
    await expect(model.generate(LIVE)).rejects.toBeInstanceOf(LeakDetectedError);
    disarm();
  });

  it('layer 3 on the streaming path: no text reaches the caller', async () => {
    setWindow({});
    const model = createDeviceOnlyModel(env.ai, spec, { LanguageModel: fakeLanguageModel() });
    const disarm = guard.armCloudPermit({ texts: [LIVE] });
    const seen: string[] = [];
    await expect(model.stream(LIVE, (t) => seen.push(t))).rejects.toBeInstanceOf(LeakDetectedError);
    expect(seen).toEqual([]);
    disarm();
  });

  it('the pre-check also runs on every call (the global can disappear after creation)', async () => {
    const holder: { LanguageModel?: unknown } = { LanguageModel: fakeLanguageModel() };
    setWindow(holder);
    const model = createDeviceOnlyModel(env.ai, spec, holder);
    delete holder.LanguageModel;
    await expect(model.generate(LIVE)).rejects.toBeInstanceOf(DeviceRuntimeMissingError);
    expect(net.sent).toHaveLength(0);
  });
});

describe('device-only route when LanguageModel is present', () => {
  it('runs on device with zero network requests, system prompt in initialPrompts', async () => {
    const LanguageModel = fakeLanguageModel('available', '{"options":[]}');
    setWindow({ LanguageModel });
    const model = createDeviceOnlyModel(env.ai, { system: 'SYSTEM-TEXT', schema: { type: 'object' } }, { LanguageModel });
    const r = await model.generate(LIVE);
    expect(r.source).toBe('on_device');
    expect(r.text).toBe('{"options":[]}');
    expect(net.sent).toHaveLength(0);
    const call = LanguageModel.calls[0];
    expect(JSON.stringify(call.createOptions)).toContain('SYSTEM-TEXT');
    expect(JSON.stringify(call.createOptions)).toContain('"languages":["en"]');
    expect(call.options?.responseConstraint).toEqual({ type: 'object' });
  });

  it('streams on device, accumulating text, with zero network requests', async () => {
    const LanguageModel = fakeLanguageModel('available', '{"options":[{"text":"Yes please","kind":"answer"}]}', { chunks: 4 });
    setWindow({ LanguageModel });
    const model = createDeviceOnlyModel(env.ai, spec, { LanguageModel });
    const seen: string[] = [];
    const r = await model.stream(LIVE, (t) => seen.push(t));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(r.text);
    expect(r.text).toContain('Yes please');
    expect(net.sent).toHaveLength(0);
  });

  it('a per-call AbortSignal reaches the on-device prompt and cancels it', async () => {
    const LanguageModel = fakeLanguageModel('available', 'slow', { delayMs: 200 });
    setWindow({ LanguageModel });
    const model = createDeviceOnlyModel(env.ai, spec, { LanguageModel });
    const ac = new AbortController();
    const p = model.generate(LIVE, ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toThrow(/abort/i);
    expect(LanguageModel.calls[0].options?.signal).toBe(ac.signal);
    // The next call on the same model does not inherit the old signal.
    await model.generate(LIVE);
    expect(LanguageModel.calls[1].options?.signal).toBeUndefined();
  });

  it('throws (no fallback) when the device reports unavailable', async () => {
    const LanguageModel = fakeLanguageModel('unavailable');
    setWindow({ LanguageModel });
    const model = createDeviceOnlyModel(env.ai, spec, { LanguageModel });
    await expect(model.generate(LIVE)).rejects.toThrow(/not available/);
    expect(net.sent).toHaveLength(0);
  });
});
