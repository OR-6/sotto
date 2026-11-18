import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installEgressGuard } from '../src/ai/egress-guard';
import { toBrief } from '../src/core/prompts/prepare';
import { fakeLanguageModel, fakeNetwork, makeAI, setWindow } from './helpers';

const BRIEF = { what: 'The doctor explains the scan.', terms: [{ term: 'meniscus', meaning: 'cartilage cushion in the knee' }], questions: ['What are my options?'], bring: ['the scan letter'], red_flags: ['being rushed'], panic: ['Can you say that more slowly?'], digest: 'Knee scan results; ask about options.' };
const net = fakeNetwork(JSON.stringify(BRIEF));
let offline = false;
// The network must be in place before the app modules load (install-guard locks fetch).
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => (offline ? Promise.reject(new TypeError('Failed to fetch')) : net.fetch(input, init))) as typeof fetch;
installEgressGuard(globalThis);
beforeAll(() => undefined);
afterEach(() => {
  net.sent.length = 0;
  setWindow({});
});
const env = makeAI();
const { prepareInCloud, prepareOnDevice, prepareOutgoing } = await import('../src/ai/prepare');
const { createReceipt } = await import('../src/core/receipt');

describe('toBrief', () => {
  it('shapes and caps untrusted output', () => {
    const b = toBrief({ ...BRIEF, what: 'x'.repeat(2000), questions: ['a', 2, null, '<b>bold</b>'], terms: [{ term: '', meaning: 'm' }, { term: 't', meaning: 'm' }] })!;
    expect(b.what.length).toBe(600);
    expect(b.questions).toEqual(['a', '2', '<b>bold</b>']);
    expect(b.terms).toEqual([{ term: 't', meaning: 'm' }]);
  });
  it('rejects empty output and builds a digest when missing', () => {
    expect(toBrief({})).toBeNull();
    expect(toBrief('nope')).toBeNull();
    expect(toBrief({ what: 'W', questions: [], terms: [{ term: 'T', meaning: 'M' }] })!.digest).toBe('W T: M');
  });
});

describe('prepare', () => {
  it('sends exactly the shown line and its instructions, nothing else', async () => {
    const receipt = createReceipt();
    const shown = prepareOutgoing('knee MRI results, orthopaedist, tomorrow', 'gemini-3.5-flash-lite');
    const r = await prepareInCloud(env.ai, 'knee MRI results, orthopaedist, tomorrow', 'gemini-3.5-flash-lite', async (o) => o.user === shown.user && o.system === shown.system, receipt);
    expect(r.source).toBe('in_cloud');
    expect(r.brief.terms[0].term).toBe('meniscus');
    const body = JSON.parse(net.sent[0].body);
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: shown.user }] }]);
    expect(receipt.steps[0].outgoing).toBe(`${shown.system}\n\n${shown.user}`);
  });

  it('falls back to the device when the cloud cannot be reached (PREFER_IN_CLOUD)', async () => {
    const LanguageModel = fakeLanguageModel('available', JSON.stringify({ what: 'Short brief.', questions: ['Q?'], panic: ['Slow down please.'], digest: 'd' }));
    setWindow({ LanguageModel });
    offline = true;
    const receipt = createReceipt();
    try {
      const r = await prepareInCloud(env.ai, 'rent meeting', 'gemini-3.5-flash-lite', async () => true, receipt).catch((e) => e);
      expect(r.source).toBe('on_device');
      expect(r.brief.what).toBe('Short brief.');
      expect(receipt.steps[0]).toMatchObject({ where: 'on_device', bytesOut: 0 });
    } finally {
      offline = false;
    }
  });

  it('prepares on device with zero network requests', async () => {
    const LanguageModel = fakeLanguageModel('available', JSON.stringify({ what: 'Short brief.', questions: ['Q?'], panic: ['Slow down please.'], digest: 'd' }));
    setWindow({ LanguageModel });
    const receipt = createReceipt();
    const r = await prepareOnDevice(env.ai, 'rent meeting', receipt, { LanguageModel });
    expect(r).toMatchObject({ source: 'on_device', bytesOut: 0 });
    expect(net.sent).toHaveLength(0);
    expect(receipt.bytesOut).toBe(0);
  });
});
