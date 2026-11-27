// Remote Config keys with in-app defaults (template: remoteconfig.template.json). The app works offline or
// when the fetch fails: the compiled-in defaults apply. The Remote Config SDK caches these
// values in the browser; that is app configuration, never anything said in a session.
import type { FirebaseApp } from 'firebase/app';
import { fetchAndActivate, getRemoteConfig, getValue } from 'firebase/remote-config';

export type AppConfig = {
  cloudModel: string;
  cloudEnabled: boolean;
  packsVersion: number;
  maxContextTokens: number;
  latencyTargetMs: number;
  source: 'remote' | 'default';
};

export const CONFIG_DEFAULTS = {
  cloud_model: 'gemini-3.5-flash-lite',
  cloud_enabled: true,
  packs_version: 1,
  max_context_tokens_web: 3000,
  max_context_tokens_android: 1500,
  latency_target_ms: 1500,
} as const;

export const DEFAULT_CONFIG: AppConfig = {
  cloudModel: CONFIG_DEFAULTS.cloud_model,
  cloudEnabled: CONFIG_DEFAULTS.cloud_enabled,
  packsVersion: CONFIG_DEFAULTS.packs_version,
  maxContextTokens: CONFIG_DEFAULTS.max_context_tokens_web,
  latencyTargetMs: CONFIG_DEFAULTS.latency_target_ms,
  source: 'default',
};

const MODEL_NAME = /^[a-z0-9][a-z0-9.\-]{2,62}$/;
const clamp = (n: number, lo: number, hi: number, d: number) => (Number.isFinite(n) && n >= lo && n <= hi ? Math.round(n) : d);

/** Sanitises raw values so a bad remote value cannot break the app. Exported for tests. */
export function sanitize(raw: { model: string; enabled: boolean; packs: number; tokens: number; latency: number }, source: AppConfig['source']): AppConfig {
  const model = raw.model.trim();
  return {
    cloudModel: MODEL_NAME.test(model) && !/latest/.test(model) ? model : CONFIG_DEFAULTS.cloud_model,
    cloudEnabled: raw.enabled,
    packsVersion: clamp(raw.packs, 1, 10_000, CONFIG_DEFAULTS.packs_version),
    maxContextTokens: clamp(raw.tokens, 500, 8000, CONFIG_DEFAULTS.max_context_tokens_web),
    latencyTargetMs: clamp(raw.latency, 300, 10_000, CONFIG_DEFAULTS.latency_target_ms),
    source,
  };
}

export async function loadConfig(app: FirebaseApp, timeoutMs = 3000): Promise<AppConfig> {
  try {
    const rc = getRemoteConfig(app);
    rc.settings.minimumFetchIntervalMillis = 10 * 60 * 1000; // the kill switch reaches visitors within ~10 minutes
    rc.settings.fetchTimeoutMillis = timeoutMs;
    rc.defaultConfig = { ...CONFIG_DEFAULTS };
    await Promise.race([fetchAndActivate(rc), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs + 500))]);
    return sanitize(
      {
        model: getValue(rc, 'cloud_model').asString(),
        enabled: getValue(rc, 'cloud_enabled').asBoolean(),
        packs: getValue(rc, 'packs_version').asNumber(),
        tokens: getValue(rc, 'max_context_tokens_web').asNumber(),
        latency: getValue(rc, 'latency_target_ms').asNumber(),
      },
      getValue(rc, 'cloud_enabled').getSource() === 'remote' ? 'remote' : 'default',
    );
  } catch {
    // Offline or blocked: use the last values this browser activated (a kill switch already
    // received stays in force), else the compiled-in defaults.
    try {
      const rc = getRemoteConfig(app);
      const src = getValue(rc, 'cloud_enabled').getSource();
      if (src === 'remote') {
        return sanitize(
          { model: getValue(rc, 'cloud_model').asString(), enabled: getValue(rc, 'cloud_enabled').asBoolean(), packs: getValue(rc, 'packs_version').asNumber(), tokens: getValue(rc, 'max_context_tokens_web').asNumber(), latency: getValue(rc, 'latency_target_ms').asNumber() },
          'remote',
        );
      }
    } catch {
      /* no cached values */
    }
    return DEFAULT_CONFIG;
  }
}
