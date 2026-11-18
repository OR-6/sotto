import { describe, expect, it } from 'vitest';
import { createEgressGuard, EgressBlockedError, installEgressGuard, isAiHost } from '../src/ai/egress-guard';
import { fakeNetwork, LIVE as RAW } from './helpers';

const AI_URL = 'https://firebasevertexai.googleapis.com/v1beta/projects/p/models/gemini-3.5-flash-lite:generateContent?key=k';
const APPROVED = 'knee MRI results, orthopaedist, tomorrow';
const SYSTEM = 'You prepare a person for a conversation.';
const body = (userText: string, extra: object = {}) =>
  JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM }] },
    generationConfig: { responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { summary: { type: 'STRING' } } } },
    ...extra,
  });
const post = (b: BodyInit) => ({ method: 'POST', body: b });

function setup(start = 1_000) {
  let t = start;
  const net = fakeNetwork();
  const { fetch, guard } = createEgressGuard(net.fetch, () => t);
  return { net, fetch, guard, advance: (ms: number) => (t += ms) };
}

describe('egress guard', () => {
  it('recognises AI hosts, including regional Vertex hosts', () => {
    expect(isAiHost('firebasevertexai.googleapis.com')).toBe(true);
    expect(isAiHost('us-central1-aiplatform.googleapis.com')).toBe(true);
    expect(isAiHost('generativelanguage.googleapis.com')).toBe(true);
    expect(isAiHost('content-firebaseappcheck.googleapis.com')).toBe(false);
    expect(isAiHost('evil-firebasevertexai.googleapis.com.example.com')).toBe(false);
  });

  it('passes non-AI requests through untouched', async () => {
    const { net, fetch } = setup();
    await fetch('https://firebaseremoteconfig.googleapis.com/v1/x', post('{"a":"free text is fine here"}'));
    expect(net.sent).toHaveLength(1);
  });

  it('blocks every AI request when no permit is armed', async () => {
    const { net, fetch, guard } = setup();
    await expect(fetch(AI_URL, post(body(RAW)))).rejects.toBeInstanceOf(EgressBlockedError);
    expect(net.sent).toHaveLength(0);
    expect(guard.events.at(-1)?.outcome).toBe('blocked');
  });

  it('allows exactly one matching request per permit', async () => {
    const { net, fetch, guard } = setup();
    guard.armCloudPermit({ texts: [SYSTEM, APPROVED] });
    await fetch(AI_URL, post(body(APPROVED)));
    expect(net.sent).toHaveLength(1);
    await expect(fetch(AI_URL, post(body(APPROVED)))).rejects.toThrow(/no cloud permit/);
    expect(net.sent).toHaveLength(1);
  });

  it('blocks raw text even while a permit is armed, and keeps the permit for the real request', async () => {
    const { net, fetch, guard } = setup();
    guard.armCloudPermit({ texts: [SYSTEM, APPROVED] });
    await expect(fetch(AI_URL, post(body(RAW)))).rejects.toThrow(/not the approved text/);
    expect(net.sent).toHaveLength(0);
    await fetch(AI_URL, post(body(APPROVED)));
    expect(net.sent).toHaveLength(1);
  });

  it('blocks free text smuggled outside text fields', async () => {
    const { net, fetch, guard } = setup();
    guard.armCloudPermit({ texts: [SYSTEM, APPROVED] });
    await expect(fetch(AI_URL, post(body(APPROVED, { note: RAW })))).rejects.toThrow(/unexpected free-text/);
    await expect(fetch(AI_URL, post(body(APPROVED, { [RAW]: 1 })))).rejects.toThrow(/unexpected free-text/);
    expect(net.sent).toHaveLength(0);
  });

  it('allows extra strings the permit lists explicitly (e.g. schema descriptions)', async () => {
    const { net, fetch, guard } = setup();
    const desc = 'A short plain-language summary.';
    guard.armCloudPermit({ texts: [SYSTEM, APPROVED], structural: [desc] });
    await fetch(AI_URL, post(body(APPROVED, { meta: { description: desc } })));
    expect(net.sent).toHaveLength(1);
  });

  it('blocks after the permit expires', async () => {
    const { net, fetch, guard, advance } = setup();
    guard.armCloudPermit({ texts: [SYSTEM, APPROVED], ttlMs: 1_000 });
    advance(1_001);
    await expect(fetch(AI_URL, post(body(APPROVED)))).rejects.toThrow(/expired/);
    expect(net.sent).toHaveLength(0);
  });

  it('blocks non-string and non-JSON bodies', async () => {
    const { net, fetch, guard } = setup();
    guard.armCloudPermit({ texts: [APPROVED] });
    await expect(fetch(AI_URL, post(new Blob([body(APPROVED)])))).rejects.toThrow(/not a string/);
    await expect(fetch(AI_URL, post(APPROVED))).rejects.toThrow(/not JSON/);
    expect(net.sent).toHaveLength(0);
  });

  it('reads the body of a Request object', async () => {
    const { net, fetch, guard } = setup();
    guard.armCloudPermit({ texts: [SYSTEM, APPROVED] });
    await expect(fetch(new Request(AI_URL, post(body(RAW))))).rejects.toBeInstanceOf(EgressBlockedError);
    await fetch(new Request(AI_URL, post(body(APPROVED))));
    expect(net.sent).toHaveLength(1);
  });

  it('refuses to arm a second permit while one is live, and disarm works', async () => {
    const { fetch, guard } = setup();
    const disarm = guard.armCloudPermit({ texts: [APPROVED] });
    expect(() => guard.armCloudPermit({ texts: [APPROVED] })).toThrow(/already armed/);
    disarm();
    await expect(fetch(AI_URL, post(body(APPROVED)))).rejects.toThrow(/no cloud permit/);
  });

  it('never records request bodies in its audit log (I6)', async () => {
    const { fetch, guard } = setup();
    await fetch(AI_URL, post(body(RAW))).catch(() => {});
    expect(JSON.stringify(guard.events)).not.toContain('Okafor');
    expect(JSON.stringify(guard.events)).not.toContain('key=');
  });

  it('locks the installed fetch so it cannot be unwrapped', () => {
    const net = fakeNetwork();
    const target = { fetch: net.fetch };
    installEgressGuard(target);
    expect(() => {
      'use strict';
      (target as { fetch: unknown }).fetch = net.fetch;
    }).toThrow(TypeError);
    expect(() => Object.defineProperty(target, 'fetch', { value: net.fetch })).toThrow(TypeError);
  });
});
