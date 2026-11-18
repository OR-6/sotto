import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;

// Dev server only: lets the step-zero lab save its measurements into replays/.
function labSave(): Plugin {
  return {
    name: 'sotto-lab-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lab/save', (req, res) => {
        if (req.method !== 'POST') return void (res.statusCode = 405, res.end());
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          try {
            const { name, data } = JSON.parse(body) as { name: string; data: unknown };
            if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error('bad name');
            // Replays are served to the app (public/replays); measurements stay in replays/.
            const replay = name.startsWith('replay-');
            const dir = replay ? resolve(root, 'public', 'replays') : resolve(root, 'replays');
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, replay ? `${name.slice(7)}.json` : `step0-${name}.json`), JSON.stringify(data, null, 2) + '\n');
            res.statusCode = 204;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [labSave()],
  build: {
    rollupOptions: {
      input: {
        // The lab is a dev-server page only; it is never built or deployed.
        main: resolve(root, 'index.html'),
      },
    },
  },
});
