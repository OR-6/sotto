// The only module that touches browser storage (check:storage enforces it). Keys come from an
// allow-list that never includes transcripts or receipts (invariant I6). Every read and write
// is wrapped: in a private window or with storage blocked, the app still works, it just forgets.

export const STORE_KEYS = ['settings', 'phrases', 'voicePack', 'briefs', 'summaries', 'stats'] as const;
export type StoreKey = (typeof STORE_KEYS)[number];

const PREFIX = 'sotto.v1.';

export function load<T>(key: StoreKey, fallback: T): T {
  if (!STORE_KEYS.includes(key)) throw new Error(`not an allowed storage key: ${String(key)}`);
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: StoreKey, value: T): boolean {
  if (!STORE_KEYS.includes(key)) throw new Error(`not an allowed storage key: ${String(key)}`);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Clear everything Sotto saved on this device. */
export function clearAll(): void {
  try {
    for (const k of STORE_KEYS) localStorage.removeItem(PREFIX + k);
  } catch {
    /* nothing to clear */
  }
}
