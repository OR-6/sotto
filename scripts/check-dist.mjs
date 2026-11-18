// Fails if the production bundle contains an App Check debug token or any other value
// that must never be public. Runs after `vite build` (npm run build).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})('dist');

const forbidden = [
  { name: 'UUID-shaped token (App Check debug token format)', re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i },
  { name: 'VITE_APPCHECK_DEBUG_TOKEN reference', re: /VITE_APPCHECK_DEBUG_TOKEN/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];
const debugToken = process.env.VITE_APPCHECK_DEBUG_TOKEN;
let failed = false;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const { name, re } of forbidden) {
    if (re.test(text)) {
      console.error(`check-dist: ${f} contains ${name}`);
      failed = true;
    }
  }
  if (debugToken && text.includes(debugToken)) {
    console.error(`check-dist: ${f} contains the App Check debug token`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`check-dist: ${files.length} files clean`);
