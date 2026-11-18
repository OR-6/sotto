import { describe, expect, it } from 'vitest';
import { listen, LocalSpeechUnavailableError, readSpeechState, supportsLocal, type RecognitionCtor } from '../src/speech/recognise';
import { offlineVoices } from '../src/speech/speak';

function fakeRecognition(withLocal = true, available = 'available') {
  const instances: FakeRec[] = [];
  class FakeRec {
    lang = '';
    continuous = false;
    interimResults = false;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    started = false;
    constructor() {
      instances.push(this);
    }
    start() {
      this.started = true;
    }
    stop() {
      this.onend?.();
    }
    abort() {}
    static available = async () => available;
    static install = async () => true;
  }
  if (withLocal) Object.defineProperty(FakeRec.prototype, 'processLocally', { value: false, writable: true });
  return { C: FakeRec as unknown as RecognitionCtor, instances };
}

describe('on-device speech wrapper', () => {
  it('refuses to start without a real processLocally property (no server fallback)', () => {
    const { C, instances } = fakeRecognition(false);
    expect(supportsLocal(C)).toBe(false);
    expect(() => listen({ onInterim() {}, onFinal() {}, onError() {}, onState() {} }, {}, { SpeechRecognition: C })).toThrow(LocalSpeechUnavailableError);
    expect(instances).toHaveLength(0);
  });

  it('reports missing when the browser has no local recognition', async () => {
    expect(await readSpeechState('en-US', {})).toBe('missing');
    expect(await readSpeechState('en-US', { SpeechRecognition: fakeRecognition(false).C })).toBe('missing');
    expect(await readSpeechState('en-US', { SpeechRecognition: fakeRecognition(true, 'downloadable').C })).toBe('downloadable');
  });

  it('starts with processLocally, continuous and interim results, and times finals', () => {
    const { C, instances } = fakeRecognition();
    let t = 1000;
    const finals: [string, number][] = [];
    const interims: string[] = [];
    listen({ onInterim: (x) => interims.push(x), onFinal: (x, d) => finals.push([x, d]), onError() {}, onState() {} }, { now: () => t }, { SpeechRecognition: C });
    const r = instances[0] as unknown as { processLocally: boolean; continuous: boolean; interimResults: boolean; started: boolean; onresult: (e: unknown) => void };
    expect(r).toMatchObject({ processLocally: true, continuous: true, interimResults: true, started: true });
    r.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: false, length: 1, 0: { transcript: 'what can', confidence: 0 } } } });
    t = 1350;
    r.onresult({ resultIndex: 0, results: { length: 1, 0: { isFinal: true, length: 1, 0: { transcript: ' what can I get you ', confidence: 0.9 } } } });
    expect(interims).toEqual(['what can']);
    expect(finals).toEqual([['what can I get you', 350]]);
  });

  it('restarts after the browser ends a session, until stopped', () => {
    const { C, instances } = fakeRecognition();
    const l = listen({ onInterim() {}, onFinal() {}, onError() {}, onState() {} }, {}, { SpeechRecognition: C });
    (instances[0] as unknown as { onend: () => void }).onend();
    expect(instances).toHaveLength(2);
    l.stop();
    expect(instances).toHaveLength(2);
  });

  it('lists only offline English voices', () => {
    const v = offlineVoices([
      { name: 'Cloud', lang: 'en-US', localService: false },
      { name: 'Samantha', lang: 'en-US', localService: true },
      { name: 'Anna', lang: 'de-DE', localService: true },
    ]);
    expect(v.map((x) => x.name)).toEqual(['Samantha']);
  });
});
