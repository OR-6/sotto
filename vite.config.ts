import { defineConfig, type Plugin } from 'vite';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
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
            // Never overwrite earlier evidence: a second run of the same step gets a time-stamped name.
            let file = resolve(dir, replay ? `${name.slice(7)}.json` : `step0-${name}.json`);
            if (!replay && existsSync(file)) file = file.replace(/\.json$/, `-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
            writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
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

// The same Content Security Policy the host sends, also inside the built page, so every build that
// is tested (and any static host) carries it. frame-ancestors only works as a header (firebase.json).
const CSP = "default-src 'self'; script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; connect-src 'self' https://firebasevertexai.googleapis.com https://content-firebaseappcheck.googleapis.com https://firebaseinstallations.googleapis.com https://firebaseremoteconfig.googleapis.com https://www.google.com/recaptcha/; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
function cspMeta(): Plugin {
  return {
    name: 'sotto-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig({
  plugins: [labSave(), cspMeta()],
  build: {
    rollupOptions: {
      input: {
        // The lab is a dev-server page only; it is never built or deployed.
        main: resolve(root, 'index.html'),
      },
    },
  },
});
