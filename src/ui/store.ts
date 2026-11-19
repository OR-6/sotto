// The only module that touches browser storage (check:storage enforces it). Keys come from an
// allow-list that never includes transcripts or receipts (invariant I6). Every read and write
// is wrapped: in a private window or with storage blocked, the app still works, it just forgets.

/** 'resume' holds the conversation setup for one reload (no conversation content), then is cleared. */
export const STORE_KEYS = ['settings', 'phrases', 'voicePack', 'briefs', 'summaries', 'stats', 'resume'] as const;
export type StoreKey = (typeof STORE_KEYS)[number];

const PREFIX = 'sotto.v1.';

/**
 * Ward mode (a shared device, opened with ?ward): nothing is read from or written to storage,
 * so the next person finds nothing of the last.
 */
export const WARD = typeof location !== 'undefined' && new URLSearchParams(location.search).has('ward');

/** Kept briefs and summaries expire after 30 days. */
const EXPIRES: Partial<Record<StoreKey, number>> = { briefs: 30, summaries: 30 };
const expire = (key: StoreKey, v: unknown): unknown => {
  const days = EXPIRES[key];
  if (!days || !Array.isArray(v)) return v;
  const cutoff = Date.now() - days * 86_400_000;
  return v.filter((x) => !(x && typeof x === 'object' && 'date' in x) || Date.parse(String((x as { date: unknown }).date)) >= cutoff);
};

export function load<T>(key: StoreKey, fallback: T): T {
  if (!STORE_KEYS.includes(key)) throw new Error(`not an allowed storage key: ${String(key)}`);
  if (WARD) return fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (expire(key, JSON.parse(raw)) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: StoreKey, value: T): boolean {
  if (!STORE_KEYS.includes(key)) throw new Error(`not an allowed storage key: ${String(key)}`);
  if (WARD) return false;
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Databases the Firebase SDKs create once a cloud step has run (identifiers, tokens, config). */
export const FIREBASE_DATABASES = ['firebase-installations-database', 'firebase_remote_config', 'firebase-app-check-database', 'firebase-heartbeat-database'];

/** Clear everything Sotto and the Firebase SDKs saved on this device. */
export function clearAll(): void {
  try {
    for (const k of STORE_KEYS) localStorage.removeItem(PREFIX + k);
  } catch {
    /* nothing to clear */
  }
  try {
    for (const db of FIREBASE_DATABASES) indexedDB.deleteDatabase(db);
  } catch {
    /* storage blocked */
  }
}
