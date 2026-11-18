// On-device speech recognition (Web Speech API with local processing).
// The wrapper never starts recognition without `processLocally = true`, and if local
// recognition is unavailable it reports that and stops: it never falls back to a server.
// Sotto never touches audio bytes; the browser's recogniser turns speech into text.

export type SpeechState = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'missing';

type RecognitionResultLike = { isFinal: boolean; 0: { transcript: string; confidence: number }; length: number };
type RecognitionEventLike = { resultIndex: number; results: { length: number; [i: number]: RecognitionResultLike } };
type RecognitionErrorLike = { error: string; message?: string };

export type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  phrases?: unknown[];
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: RecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  onspeechend?: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

export type RecognitionCtor = {
  new (): RecognitionLike;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
  install?: (o: { langs: string[] }) => Promise<boolean>;
};

export function recognitionCtor(env: object = globalThis): RecognitionCtor | undefined {
  const e = env as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return e.SpeechRecognition ?? e.webkitSpeechRecognition;
}

/** Resolves with `fallback` if `p` has not settled within `ms` (some browsers never answer). */
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

/** True when the recogniser has a real processLocally property (not just an expando). */
export function supportsLocal(C: RecognitionCtor): boolean {
  const proto = (C as unknown as { prototype?: object }).prototype;
  return Boolean(proto && 'processLocally' in proto);
}

/** Reads local recognition availability for `lang`. Never throws, never downloads. */
export async function readSpeechState(lang = 'en-US', env: object = globalThis): Promise<SpeechState> {
  const C = recognitionCtor(env);
  if (!C || typeof C.available !== 'function' || !supportsLocal(C)) return 'missing';
  try {
    const a = await withTimeout(C.available({ langs: [lang], processLocally: true }), 2500, 'unavailable');
    return a === 'available' || a === 'downloadable' || a === 'downloading' ? a : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** Installs the local language pack. Must run on a user gesture (transient activation). */
export async function installSpeech(lang = 'en-US', env: object = globalThis): Promise<boolean> {
  const C = recognitionCtor(env);
  if (!C || typeof C.install !== 'function') return false;
  try {
    return Boolean(await C.install({ langs: [lang] }));
  } catch {
    return false;
  }
}

export type Heard = { text: string; final: boolean; at: number };
export type ListenHandlers = {
  onInterim(text: string): void;
  /** A finished utterance. `delayMs` is the time from the last interim result to this final one. */
  onFinal(text: string, delayMs: number): void;
  onError(code: string): void;
  onState(listening: boolean): void;
};

export type Listener = { stop(): void; readonly listening: boolean };

export class LocalSpeechUnavailableError extends Error {
  constructor(readonly state: SpeechState) {
    super(`On-device speech recognition is ${state} in this browser. Sotto does not use server speech recognition; the other person can type instead.`);
    this.name = 'LocalSpeechUnavailableError';
  }
}

/**
 * Starts continuous local recognition. Restarts after the browser ends a session (Chrome ends
 * continuous sessions on long silences) until `stop()` is called.
 */
export function listen(h: ListenHandlers, opts: { lang?: string; phrases?: string[]; now?: () => number } = {}, env: object = globalThis): Listener {
  const C = recognitionCtor(env);
  if (!C) throw new LocalSpeechUnavailableError('missing');
  // A browser without local recognition has no processLocally property; setting it would only add
  // an expando and Chrome would quietly use its server recogniser. Refuse instead.
  if (!supportsLocal(C)) throw new LocalSpeechUnavailableError('unavailable');
  const now = opts.now ?? (() => performance.now());
  let stopped = false;
  let listening = false;
  let lastInterimAt = 0;
  let rec: RecognitionLike | null = null;
  let restarts = 0;
  let startedAt = 0;
  let quickFails = 0;

  const begin = () => {
    const r = new C();
    r.lang = opts.lang ?? 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.processLocally = true; // never server recognition
    if (opts.phrases?.length && 'phrases' in r) {
      try {
        r.phrases = opts.phrases.map((phrase) => ({ phrase, boost: 5 }));
      } catch {
        /* phrases unsupported: carry on without biasing */
      }
    }
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? '';
        if (res.isFinal) {
          const t = now();
          h.onFinal(text.trim(), lastInterimAt ? Math.max(0, t - lastInterimAt) : 0);
          lastInterimAt = 0;
        } else {
          lastInterimAt = now();
          h.onInterim(text);
        }
      }
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      h.onError(e.error);
      if (e.error === 'service-not-allowed' || e.error === 'not-allowed' || e.error === 'language-not-supported') stopped = true;
    };
    r.onend = () => {
      listening = false;
      if (stopped) return h.onState(false);
      // Chrome ends continuous sessions on long silences: restart, backing off if it keeps ending at once.
      quickFails = now() - startedAt < 1000 ? quickFails + 1 : 0;
      if (quickFails >= 6) {
        h.onError('restarting-too-often');
        return h.onState(false);
      }
      restarts++;
      const delay = quickFails ? Math.min(4000, 250 * 2 ** (quickFails - 1)) : 0;
      setTimeout(() => {
        if (stopped) return h.onState(false);
        try {
          begin();
        } catch {
          h.onState(false);
        }
      }, delay);
    };
    rec = r;
    startedAt = now();
    r.start();
    listening = true;
    h.onState(true);
  };
  begin();
  return {
    stop() {
      stopped = true;
      if (rec) {
        // Detach first: a late result from this recogniser must never reach the next session.
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.abort();
      }
      listening = false;
      h.onState(false);
    },
    get listening() {
      return listening;
    },
  };
}
