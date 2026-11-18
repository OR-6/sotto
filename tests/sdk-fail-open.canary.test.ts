// CANARY. Documents current SDK behaviour WITHOUT Sotto's guards: @firebase/ai 3.1.0
// (firebase 13.4.0) sends ONLY_ON_DEVICE requests to the cloud when window.LanguageModel is
// missing. If this starts failing after an SDK upgrade, the SDK fixed it: update the README
// finding and keep the guards anyway.
import { afterEach, expect, it } from 'vitest';
import { getGenerativeModel, InferenceMode } from 'firebase/ai';
import { fakeNetwork, LIVE, makeAI, setWindow } from './helpers';

const env = makeAI();
afterEach(() => setWindow({}));

it('SDK (unguarded) routes ONLY_ON_DEVICE to the cloud when LanguageModel is absent', async () => {
  const net = fakeNetwork();
  globalThis.fetch = net.fetch;
  setWindow({});
  const model = getGenerativeModel(env.ai, { mode: InferenceMode.ONLY_ON_DEVICE });
  const r = await model.generateContent(LIVE);
  expect(r.response.inferenceSource).toBe('in_cloud');
  expect(net.sent).toHaveLength(1);
  expect(net.sent[0].url).toContain('firebasevertexai.googleapis.com');
  expect(net.sent[0].body).toContain('medial meniscus');
});
