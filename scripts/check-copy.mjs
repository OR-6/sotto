// check:copy (docs/PRIVACY.md, copy rules): user-facing text never claims "100% private",
// "secure", "guaranteed" or "anonymous", and never says "private" without "Private mode"
// on the same line. Scans the pages, the UI strings, the core copy and the README.
import { existsSync } from 'node:fs';
import { lines, read, report, walk } from './lib.mjs';

const files = ['index.html', 'README.md', ...walk('src/ui', ['.ts', '.html', '.css']), ...walk('src/core', ['.ts'])].filter(existsSync);
const BANNED = /\b100\s*%\s*private\b|\b(secure|securely|guaranteed?|guarantees|anonymous|anonymously|anonymi[sz]ed?|unhackable|military[- ]grade)\b/i;
const PRIVATE = /\bprivate(ly)?\b/i;
const problems = [];
for (const f of files) {
  for (const { n, l } of lines(read(f))) {
    // The README states the rule itself on lines that say "never claims"; allow those.
    if (f === 'README.md' && /never (says|claims)/i.test(l)) continue;
    if (BANNED.test(l)) problems.push(`${f}:${n} banned claim: ${l.trim().slice(0, 120)}`);
    if (PRIVATE.test(l) && !/Private mode/.test(l) && !/\bprivate\s*:/.test(l) && !/^\s*(import|export|\/\/|\*)/.test(l)) problems.push(`${f}:${n} "private" without "Private mode": ${l.trim().slice(0, 120)}`);
  }
}
// Text fields: browser cloud assists off. Raw <input>/<textarea> in pages must say spellcheck="false".
for (const f of ['index.html'].filter(existsSync)) {
  if (!/<html[^>]*translate="no"/.test(read(f))) problems.push(`${f}: <html> must carry translate="no"`);
  for (const { n, l } of lines(read(f))) if (/<(input|textarea)\b/.test(l) && !/spellcheck="false"/.test(l)) problems.push(`${f}:${n} text field without spellcheck="false"`);
}
for (const f of walk('src/ui', ['.ts'])) for (const { n, l } of lines(read(f))) if (/createElement\(['"](input|textarea)['"]\)/.test(l)) problems.push(`${f}:${n} create text fields with h() so cloud assists are switched off`);
report('check:copy', problems, `${files.length} files clean (no banned claims; "private" only with "Private mode")`);
