// Egress guard: a network-level backstop for invariants I1 and I2.
//
// Once installed, every request to a Gemini / AI Logic host is REJECTED unless a
// one-shot permit is armed (only `cloud.ts` arms permits, after the user approved the exact text),
// AND every `text` field in the request body is exactly one of the permit's approved
// texts, AND every other string in the body is a short structural token (role, MIME
// type, schema type, model name) or explicitly listed in the permit.
//
// Why: in @firebase/ai 3.1.0, ONLY_ON_DEVICE falls back to the cloud when
// `window.LanguageModel` is missing (tests/sdk-fail-open.canary.test.ts). The capability
// pre-check stops that before the SDK is called; this guard makes sure that even if the
// pre-check is bypassed or a future SDK version changes routing, device-only text can
// never reach the network.
//
// Scope: guards `fetch`, which is the only transport the AI Logic SDK uses for
// generateContent / generateContentStream (verified in step 0). It does not cover
// WebSocket (Live API, unused) or XHR / sendBeacon (no AI host is ever called that way).
// The guard stores no request bodies (I6): the audit log keeps reasons, host, path and size.

export const AI_HOSTS: readonly string[] = [
  'firebasevertexai.googleapis.com', // AI Logic proxy (both Gemini backends)
  'generativelanguage.googleapis.com', // Gemini Developer API direct (never used; blocked anyway)
  'aiplatform.googleapis.com', // Vertex direct (never used; blocked anyway)
];

export function isAiHost(host: string): boolean {
  return AI_HOSTS.some((h) => host === h || host.endsWith(`-${h}`) || host.endsWith(`.${h}`));
}

/** A string that may appear outside `text` fields without a permit listing it. */
const STRUCTURAL_TOKEN = /^[A-Za-z0-9_.:\/+-]{0,64}$/;

export class EgressBlockedError extends Error {
  readonly code = 'sotto/egress-blocked';
  constructor(readonly reason: string) {
    super(`Sotto blocked an outgoing AI request: ${reason}`);
    this.name = 'EgressBlockedError';
  }
}

export type GuardEvent = {
  at: string;
  outcome: 'allowed' | 'blocked' | 'failed';
  reason: string;
  host: string;
  path: string;
  bytes: number;
};

export type PermitSpec = {
  /** The exact texts (the approved system and user text) allowed in `text` fields. */
  texts: readonly string[];
  /** Extra non-`text` strings allowed in the body (e.g. schema descriptions). */
  structural?: readonly string[];
  /** Permit lifetime. Default 60 s. */
  ttlMs?: number;
};

type Permit = { texts: Set<string>; structural: Set<string>; expires: number };

export type EgressGuard = {
  /** Arms a one-shot permit for the next matching AI request. Returns a disarm function. */
  armCloudPermit(spec: PermitSpec): () => void;
  /** In-memory audit trail for the Receipt. No bodies. */
  readonly events: readonly GuardEvent[];
  /** Every other cross-origin request this page made (host, count, request bytes). No bodies. */
  readonly others: ReadonlyMap<string, { count: number; bytes: number }>;
};

type FetchFn = typeof fetch;

/** Collects every string leaf in `value`, split into `text` fields and everything else. */
function collectStrings(value: unknown, key: string | null, texts: string[], others: string[]): void {
  if (typeof value === 'string') {
    (key === 'text' ? texts : others).push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, null, texts, others);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      // Object keys can carry data too (e.g. schema property names): treat them as strings.
      others.push(k);
      collectStrings(v, k, texts, others);
    }
  }
}

/** Checks a request body against a permit. Returns null when it matches, else the reason. */
export function checkBodyAgainstPermit(body: string, permit: Pick<Permit, 'texts' | 'structural'>): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'body is not JSON';
  }
  const texts: string[] = [];
  const others: string[] = [];
  collectStrings(parsed, null, texts, others);
  if (texts.length === 0) return 'body has no text parts';
  for (const t of texts) {
    if (!permit.texts.has(t)) return 'a text part is not the approved text';
  }
  for (const s of others) {
    if (!STRUCTURAL_TOKEN.test(s) && !permit.structural.has(s)) {
      return 'body contains an unexpected free-text string';
    }
  }
  return null;
}

async function readBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  const b = init?.body;
  if (typeof b === 'string') return b;
  if (b != null) return null; // Blob, FormData, stream, buffer: never sent by the SDK; refuse.
  if (typeof Request !== 'undefined' && input instanceof Request) return input.clone().text();
  return '';
}

function toUrl(input: RequestInfo | URL): URL {
  const raw = typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input);
  const base = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  return new URL(raw, base);
}

/**
 * Builds the guarded fetch around `inner`. Exported for tests; the app uses `installEgressGuard`.
 */
export function createEgressGuard(inner: FetchFn, now: () => number = Date.now): { fetch: FetchFn; guard: EgressGuard } {
  let permits: Permit[] = [];
  const events: GuardEvent[] = [];
  const others = new Map<string, { count: number; bytes: number }>();
  const sameOrigin = (u: URL) => typeof location !== 'undefined' && u.origin === location.origin;

  const log = (outcome: GuardEvent['outcome'], reason: string, url: URL, bytes: number) => {
    events.push({ at: new Date(now()).toISOString(), outcome, reason, host: url.host, path: url.pathname, bytes });
  };

  const guardedFetch: FetchFn = async (input, init) => {
    let url: URL;
    try {
      url = toUrl(input);
    } catch {
      return inner(input, init);
    }
    if (!isAiHost(url.host)) {
      if (!sameOrigin(url)) {
        const b = typeof init?.body === 'string' ? new TextEncoder().encode(init.body).length : 0;
        const o = others.get(url.host) ?? { count: 0, bytes: 0 };
        others.set(url.host, { count: o.count + 1, bytes: o.bytes + b });
      }
      return inner(input, init);
    }

    const body = await readBody(input, init);
    const bytes = body == null ? 0 : new TextEncoder().encode(body).length;
    const block = (reason: string): never => {
      log('blocked', reason, url, bytes);
      throw new EgressBlockedError(reason);
    };

    permits = permits.filter((p) => p.expires >= now());
    if (!permits.length) block('no cloud permit is armed (device-only text cannot leave)');
    if (body == null) block('request body is not a string');
    // Each armed permit belongs to one cloud call; the request must match one of them exactly.
    let mismatch = '';
    const match = permits.find((p) => !(mismatch = checkBodyAgainstPermit(body!, p) ?? ''));
    if (!match) block(mismatch); // permits stay armed for the real requests

    permits = permits.filter((p) => p !== match); // one-shot
    try {
      const res = await inner(input, init);
      log('allowed', 'matched cloud permit', url, bytes); // a response came back, so the body was sent
      return res;
    } catch (e) {
      // Cut off by a newer turn or a timeout: the body was already handed over, so count it as sent.
      if ((e as { name?: string })?.name === 'AbortError') log('allowed', 'aborted after sending; counted as sent', url, bytes);
      else log('failed', 'network error before a response; counted as not sent', url, bytes);
      throw e;
    }
  };

  const guard: EgressGuard = {
    armCloudPermit(spec) {
      const mine: Permit = {
        texts: new Set(spec.texts),
        structural: new Set(spec.structural ?? []),
        expires: now() + (spec.ttlMs ?? 60_000),
      };
      permits = [...permits, mine];
      return () => {
        permits = permits.filter((p) => p !== mine);
      };
    },
    get events() {
      return events;
    },
    get others() {
      return others;
    },
  };

  return { fetch: guardedFetch, guard };
}

let installed: EgressGuard | null = null;

/**
 * Replaces `target.fetch` with the guarded version and locks it so that no later code
 * can unwrap it. Idempotent per target. Call once at app start, before any SDK call.
 */
export function installEgressGuard(target: { fetch: FetchFn } = globalThis): EgressGuard {
  if (target === globalThis && installed) return installed;
  const { fetch: guarded, guard } = createEgressGuard(target.fetch.bind(target));
  Object.defineProperty(target, 'fetch', { value: guarded, writable: false, configurable: false, enumerable: true });
  if (target === globalThis) installed = guard;
  return guard;
}
