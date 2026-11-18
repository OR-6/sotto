// The egress guard against the exact AI Logic request bodies that @firebase/ai (firebase 13.3.0)
// produced in real Chrome 157 on 12 Nov 2026 (tests/fixtures-sdk-bodies.json, toy text only).
// Proves the guard's body rules accept real SDK output when permitted, and block it otherwise.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkBodyAgainstPermit, createEgressGuard } from '../src/ai/egress-guard';
import { fakeNetwork } from './helpers';

type NetEntry = { host: string; path: string; body: string };
const evidence = JSON.parse(readFileSync(new URL('./fixtures-sdk-bodies.json', import.meta.url), 'utf8')) as { net: NetEntry[] };
const aiBodies = evidence.net.filter((n) => n.host === 'firebasevertexai.googleapis.com').map((n) => ({ ...n, url: `https://${n.host}${n.path}` }));

function textsOf(body: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown, k: string | null) => {
    if (typeof v === 'string') { if (k === 'text') out.push(v); }
    else if (Array.isArray(v)) v.forEach((x) => walk(x, null));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([kk, vv]) => walk(vv, kk));
  };
  walk(JSON.parse(body), null);
  return out;
}

describe('egress guard on real SDK request bodies', () => {
  it('has captured bodies to test (5 cloud calls in the hello run)', () => {
    expect(aiBodies).toHaveLength(5);
  });

  it.each(aiBodies.map((b, i) => [i, b] as const))('body %i passes only with a permit for its exact texts', async (_i, b) => {
    const texts = textsOf(b.body);
    expect(checkBodyAgainstPermit(b.body, { texts: new Set(texts), structural: new Set() })).toBeNull();
    expect(checkBodyAgainstPermit(b.body, { texts: new Set(texts.map((t) => `${t} `)), structural: new Set() })).not.toBeNull();

    const net = fakeNetwork();
    const { fetch, guard } = createEgressGuard(net.fetch);
    await expect(fetch(b.url, { method: 'POST', body: b.body })).rejects.toThrow(/no cloud permit/);
    guard.armCloudPermit({ texts });
    await fetch(b.url, { method: 'POST', body: b.body });
    expect(net.sent).toHaveLength(1);
  });
});
