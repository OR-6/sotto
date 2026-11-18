// check:storage (I6): browser storage may only be touched by src/ui/store.ts, whose key
// allow-list never includes transcripts or receipts (tests/store.test.ts).
import { lines, read, report, walk } from './lib.mjs';

const ALLOWED = new Set(['src/ui/store.ts']);
const RE = /\b(localStorage|sessionStorage|indexedDB|openDatabase)\b|\bcaches\s*\.\s*open\b|document\s*\.\s*cookie|navigator\s*\.\s*storage\b/;
const files = walk('src', ['.ts', '.tsx', '.js', '.mjs']).map((p) => p.replaceAll('\\', '/'));
const problems = [];
for (const f of files) {
  if (ALLOWED.has(f)) continue;
  for (const { n, l } of lines(read(f))) if (RE.test(l)) problems.push(`${f}:${n} ${l.trim().slice(0, 120)}`);
}
report('check:storage', problems, `${files.length} source files clean (no storage outside src/ui/store.ts)`);
