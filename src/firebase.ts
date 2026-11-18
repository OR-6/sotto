// Firebase for Sotto, split in two so that Private mode loads nothing from the network:
//
// - `deviceAI`: the AI Logic service on an app with no App Check, no Remote Config and no
//   Installations. Device-only models are built on it; they never make a request.
// - `getCloud()`: created on the first cloud step the user starts (Prepare, Summary, Cloud live
//   mode). Only then are App Check (reCAPTCHA Enterprise), Installations and Remote Config
//   started, and only on this second app.
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

declare global {
  // App Check debug-token hook read by the SDK (localhost only).
  // eslint-disable-next-line no-var
  var FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean | undefined;
}

// Each value is read as `import.meta.env.VITE_X` directly, so Vite inlines only these.
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const configMissing = Object.entries(firebaseConfig)
  .filter(([, v]) => !v)
  .map(([k]) => k);

// The SDK needs these strings to build a model, but an ONLY_ON_DEVICE call never contacts Firebase.
// The device app never gets the real config, so nothing it records (such as the SDK's usage
// heartbeat) can ever be sent with a real project's requests.
const deviceApp = initializeApp({ apiKey: 'device-only', projectId: 'device-only', appId: '1:0:web:0' });
export const deviceAI: AI = getAI(deviceApp, { backend: new GoogleAIBackend() });

const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const siteKey: string | undefined = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
export const appCheckState: 'recaptcha-enterprise' | 'debug-token' | 'missing-site-key' | 'no-config' = configMissing.length
  ? 'no-config'
  : import.meta.env.DEV && isLocalhost
    ? 'debug-token'
    : siteKey
      ? 'recaptcha-enterprise'
      : 'missing-site-key';

let cloud: { app: FirebaseApp; ai: AI } | null = null;

/** The cloud-capable app. Starts App Check on first use; call only from a cloud step the user chose. */
export function getCloud(): { app: FirebaseApp; ai: AI } {
  if (cloud) return cloud;
  const app = initializeApp(configMissing.length ? { apiKey: 'no-config', projectId: 'no-config', appId: '1:0:web:0' } : firebaseConfig, 'sotto-cloud');
  if (import.meta.env.DEV && isLocalhost) {
    // Dev server only: the production build drops this branch (scripts/check-dist.mjs checks).
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  if (!configMissing.length) {
    initializeAppCheck(app, {
      // With a debug token set, the SDK uses the debug provider and ignores this key.
      provider: new ReCaptchaEnterpriseProvider(siteKey || 'debug-only-no-site-key'),
      isTokenAutoRefreshEnabled: false,
    });
  }
  // getAI reads App Check when it is created, so it must come after initializeAppCheck.
  // Limited-use tokens give replay protection (Web SDK 12.14.0+).
  cloud = { app, ai: getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true }) };
  return cloud;
}

/** True once a cloud step has started (the receipt explains the extra requests from then on). */
export const cloudStarted = () => cloud !== null;
