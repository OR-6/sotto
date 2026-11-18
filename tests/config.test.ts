import { describe, expect, it } from 'vitest';
import { CONFIG_DEFAULTS, sanitize } from '../src/config';
import { planFor } from '../src/ai/capability';

describe('Remote Config sanitising', () => {
  const raw = { model: 'gemini-3.8-flash', enabled: true, packs: 2, tokens: 2500, latency: 1200 };
  it('accepts sane values', () => {
    expect(sanitize(raw, 'remote')).toMatchObject({ cloudModel: 'gemini-3.8-flash', packsVersion: 2, maxContextTokens: 2500, source: 'remote' });
  });
  it('rejects odd model names and -latest aliases', () => {
    expect(sanitize({ ...raw, model: 'Robert"); drop' }, 'remote').cloudModel).toBe(CONFIG_DEFAULTS.cloud_model);
    expect(sanitize({ ...raw, model: 'gemini-flash-latest' }, 'remote').cloudModel).toBe(CONFIG_DEFAULTS.cloud_model);
  });
  it('clamps numbers', () => {
    expect(sanitize({ ...raw, tokens: 99999, latency: -1 }, 'remote')).toMatchObject({ maxContextTokens: 3000, latencyTargetMs: 1500 });
  });
});

describe('capability plan', () => {
  it('offers Private live help only when the device can run the model', () => {
    expect(planFor('available', true)).toMatchObject({ privateLive: true, needsDownload: false, cloudLive: true });
    expect(planFor('downloadable', true)).toMatchObject({ privateLive: true, needsDownload: true });
    expect(planFor('unavailable', true)).toMatchObject({ privateLive: false, cloudLive: true });
    expect(planFor('missing', false)).toMatchObject({ privateLive: false, cloudLive: false, cloudPrep: false });
  });
});
