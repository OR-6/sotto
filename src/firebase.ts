// Firebase app, App Check and the AI Logic service. Shared by every page.
import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, GoogleAIBackend } from 'firebase/ai';

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

// Without a config the app still runs on device: the SDK needs these strings to build a model,
// but an ONLY_ON_DEVICE call never contacts Firebase.
export const app = initializeApp(
  configMissing.length ? { apiKey: 'no-config', projectId: 'no-config', appId: '1:0:web:0' } : firebaseConfig,
);

const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

if (import.meta.env.DEV && isLocalhost) {
  // Dev server only: the production build drops this branch, so a debug token can never ship
  // (scripts/check-dist.mjs fails the build if one does).
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
}

const siteKey: string | undefined = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
export const appCheckState: 'recaptcha-enterprise' | 'debug-only' | 'missing-site-key' | 'no-config' = configMissing.length
  ? 'no-config'
  : siteKey
    ? 'recaptcha-enterprise'
    : import.meta.env.DEV && isLocalhost
      ? 'debug-only'
      : 'missing-site-key';

if (configMissing.length === 0) {
  initializeAppCheck(app, {
    // With a debug token set, the SDK uses the debug provider and ignores this key.
    provider: new ReCaptchaEnterpriseProvider(siteKey || 'debug-only-no-site-key'),
    isTokenAutoRefreshEnabled: true,
  });
}

// Limited-use tokens give replay protection (Web SDK 12.14.0+).
export const ai = getAI(app, { backend: new GoogleAIBackend(), useLimitedUseAppCheckTokens: true });
