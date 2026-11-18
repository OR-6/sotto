// cloud.ts under the real SDK browser bundle, the real egress guard and a fake network.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installEgressGuard } from '../src/ai/egress-guard';
import { fakeLanguageModel, fakeNetwork, LIVE, makeAI, setWindow } from './helpers';

const net = fakeNetwork('{"what":"You will hear the results."}');
beforeAll(() => {
  globalThis.fetch = net.fetch;
  installEgressGuard(globalThis); // install-guard.ts reuses this instance
});
afterEach(() => {
  net.sent.length = 0;
  setWindow({});
});

const env = makeAI();
const load = () => import('../src/ai/cloud');
const { createReceipt } = await import('../src/core/receipt');
const { createLive } = await import('../src/ai/live');
const { createPrivateBackend } = await import('../src/ai/private-backend');

const req = (over: object = {}) => ({ step: 'prepare', mode: 'PREFER_IN_CLOUD' as const, model: 'gemini-3.5-flash-lite', system: 'You prepare a person.', user: 'knee MRI results, orthopaedist, tomorrow', ...over });

describe('cloudCall', () => {
  it('sends nothing unless the user approves the exact outgoing text', async () => {
    const { cloudCall, CloudDeclinedError } = await load();
    const receipt = createReceipt();
    let seen: unknown;
    await expect(cloudCall(env.ai, req(), async (o) => ((seen = o), false), receipt)).rejects.toBeInstanceOf(CloudDeclinedError);
    expect(net.sent).toHaveLength(0);
    expect(seen).toMatchObject({ user: 'knee MRI results, orthopaedist, tomorrow', system: 'You prepare a person.', mode: 'PREFER_IN_CLOUD' });
    expect(receipt.steps).toHaveLength(0);
  });

  it('an approved call sends exactly the shown text and records bytes and hash', async () => {
    const { cloudCall } = await load();
    const receipt = createReceipt();
    const r = await cloudCall(env.ai, req(), async () => true, receipt);
    expect(r.source).toBe('in_cloud');
    expect(net.sent).toHaveLength(1);
    const body = JSON.parse(net.sent[0].body);
    expect(body.contents[0].parts[0].text).toBe('knee MRI results, orthopaedist, tomorrow');
    expect(body.systemInstruction.parts[0].text).toBe('You prepare a person.');
    expect(receipt.steps[0]).toMatchObject({ step: 'prepare', where: 'in_cloud' });
    expect(receipt.steps[0].bytesOut).toBeGreaterThan(0);
    expect(receipt.steps[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a call that failed after sending still counts its bytes in the receipt', async () => {
    const { cloudCall, CloudError } = await load();
    const receipt = createReceipt();
    net.status = 500;
    try {
      await expect(cloudCall(env.ai, req(), async () => true, receipt)).rejects.toBeInstanceOf(CloudError);
    } finally {
      net.status = 200;
    }
    expect(net.sent).toHaveLength(1);
    expect(receipt.steps[0]).toMatchObject({ where: 'failed' });
    expect(receipt.steps[0].bytesOut).toBe(new TextEncoder().encode(net.sent[0].body).length);
    expect(receipt.steps[0].outgoing).toContain('knee MRI results');
  });

  it('the permit is one-shot: a second request from the same model is blocked at the network', async () => {
    const { cloudCall } = await load();
    const { getGenerativeModel, InferenceMode } = await import('firebase/ai');
    await cloudCall(env.ai, req(), async () => true, createReceipt());
    const rogue = getGenerativeModel(env.ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model: 'gemini-3.5-flash-lite' } });
    await expect(rogue.generateContent('knee MRI results, orthopaedist, tomorrow')).rejects.toThrow(/Sotto blocked/);
    expect(net.sent).toHaveLength(1);
  });

  it('sends structured output as a cloud schema with enum format', async () => {
    const { cloudCall, toCloudSchema } = await load();
    const { SAY_SCHEMA } = await import('../src/core/prompts/say');
    expect(toCloudSchema(SAY_SCHEMA)).toMatchObject({ properties: { options: { items: { properties: { kind: { type: 'string', format: 'enum' } } } } } });
    await cloudCall(env.ai, req({ schema: SAY_SCHEMA, mode: 'ONLY_IN_CLOUD' }), async () => true, createReceipt());
    const body = JSON.parse(net.sent[0].body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema.properties.options.maxItems).toBe(3);
  });

  it('Cloud live mode (PREFER_ON_DEVICE) is refused unless the session switch is on', async () => {
    const { cloudCall, setCloudLive, CloudDeclinedError } = await load();
    setCloudLive(false);
    await expect(cloudCall(env.ai, req({ mode: 'PREFER_ON_DEVICE', user: LIVE }), async () => true, createReceipt())).rejects.toBeInstanceOf(CloudDeclinedError);
    expect(net.sent).toHaveLength(0);
  });

  it('Cloud live mode runs on the device when the device has the model (no network)', async () => {
    const { cloudCall, setCloudLive } = await load();
    const LanguageModel = fakeLanguageModel('available', '{"options":[]}');
    setWindow({ LanguageModel });
    setCloudLive(true);
    const receipt = createReceipt();
    const r = await cloudCall(env.ai, req({ mode: 'PREFER_ON_DEVICE', user: LIVE, device: { system: 'S' } }), async () => true, receipt);
    setCloudLive(false);
    expect(r.source).toBe('on_device');
    expect(net.sent).toHaveLength(0);
    expect(receipt.steps[0]).toMatchObject({ where: 'on_device', bytesOut: 0 });
    expect(receipt.steps[0].outgoing).toBeUndefined();
  });

  it('the kill switch stops every cloud step before approval is even asked', async () => {
    const { cloudCall, cloudState, CloudOffError } = await load();
    cloudState.enabled = false;
    let asked = false;
    await expect(cloudCall(env.ai, req(), async () => ((asked = true), true), createReceipt())).rejects.toBeInstanceOf(CloudOffError);
    cloudState.enabled = true;
    expect(asked).toBe(false);
    expect(net.sent).toHaveLength(0);
  });
});

describe('Private mode end to end (invariant I1)', () => {
  it('a live partner turn causes zero network requests and a zero-byte receipt', async () => {
    const LanguageModel = fakeLanguageModel('available', JSON.stringify({ options: [{ text: 'Yes, please', kind: 'answer' }, { text: 'No, thanks', kind: 'alternative' }, { text: 'What else is there?', kind: 'question' }] }));
    setWindow({ LanguageModel });
    const receipt = createReceipt();
    const backend = createPrivateBackend(env.ai, receipt, { LanguageModel });
    const live = createLive({ backend, receipt, budgetChars: 3000 });
    const done = new Promise((resolve) => live.on((e) => e.type === 'say' && resolve(e)));
    live.partner(LIVE);
    await done;
    expect(net.sent).toHaveLength(0);
    expect(receipt.bytesOut).toBe(0);
    expect(JSON.stringify(receipt.toJSON())).not.toContain('meniscus');
  });

  it('with no LanguageModel at all, the Private backend cannot even be built', async () => {
    setWindow({});
    expect(() => createPrivateBackend(env.ai, createReceipt(), {})).toThrow(/does not expose the on-device model/);
    expect(net.sent).toHaveLength(0);
  });
});
