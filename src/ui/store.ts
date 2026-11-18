// The only module that touches browser storage (check:storage enforces it). Keys come from an
// allow-list that never includes transcripts or receipts (invariant I6). Every read and write
// is wrapped: in a private window or with storage blocked, the app still works, it just forgets.

export const STORE_KEYS = ['settings', 'phrases', 'voicePack', 'briefs', 'summaries', 'stats'] as const;
export type StoreKey = (typeof STORE_KEYS)[number];

const PREFIX = 'sotto.v1.';

/**
 * Ward mode (a shared device, opened with ?ward): nothing is read from or written to storage,
 * so the next person finds nothing of the last.
 */
export const WARD = typeof location !== 'undefined' && new URLSearchParams(location.search).has('ward');

export function load<T>(key: StoreKey, fallback: T): T {
  if (!STORE_KEYS.includes(key)) throw new Error(`not an allowed storage key: ${String(key)}`);
  if (WARD) return fallback;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
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
