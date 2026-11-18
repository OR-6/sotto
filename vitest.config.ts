import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The guard tests must run the *browser* build of @firebase/ai: only it contains the
// on-device (Chrome) adapter. Under Node the package's "node" export wins and has no
// adapter, so tests would pass for the wrong reason. Alias it to the browser ESM build and
// inline firebase so the alias also applies to `firebase/ai`'s re-export. Test-only.
const aiBrowser = fileURLToPath(new URL('./node_modules/@firebase/ai/dist/esm/index.esm.js', import.meta.url));

export default defineConfig({
  resolve: { alias: [{ find: /^@firebase\/ai$/, replacement: aiBrowser }] },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    isolate: true,
    server: { deps: { inline: [/firebase/, /@firebase\//] } },
  },
});
