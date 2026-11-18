// check:attribution (house rule): no tool attribution of any kind in the repo or its history:
// no co-author trailers, no "generated with" lines, no assistant or vendor names.
// The names are stored encoded so this file does not itself contain them.
import { execSync } from 'node:child_process';
import { projectFiles, read, report } from './lib.mjs';

const decode = (b) => Buffer.from(b, 'base64').toString('utf8');
const NAMES = ['Y2xhdWRl', 'YW50aHJvcGlj', 'Y2hhdGdwdA==', 'b3BlbmFp', 'Z2l0aHViIGNvcGlsb3Q=', 'Y29kZXg=', 'Y3Vyc29yIGFp', 'YWkgYXNzaXN0YW50'].map(decode);
const PATTERNS = [
  new RegExp(`\\b(${NAMES.map((n) => n.replace(/ /g, '\\s+')).join('|')})\\b`, 'i'),
  /co-authored-by/i,
  /generated (with|by) (an? )?(ai|llm|assistant)/i,
  /🤖/u,
];
const SKIP = [/^package-lock\.json$/, /\.(png|jpe?g|gif|ico|webp|woff2?|pdf)$/i, /^scripts\/check-attribution\.mjs$/];
const problems = [];
for (const f of projectFiles().filter((f) => !SKIP.some((r) => r.test(f)))) {
  let text;
  try {
    text = read(f);
  } catch {
    continue;
  }
  text.split('\n').forEach((l, i) => {
    if (PATTERNS.some((p) => p.test(l))) problems.push(`${f}:${i + 1} ${l.trim().slice(0, 100)}`);
  });
}
try {
  const log = execSync('git log --format=%H%x09%an%x09%ae%x09%B%x1e', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  for (const entry of log.split('\x1e').map((e) => e.trim()).filter(Boolean)) {
    if (PATTERNS.some((p) => p.test(entry))) problems.push(`commit ${entry.slice(0, 10)}: attribution in the commit metadata`);
  }
} catch {
  // no commits yet
}
report('check:attribution', problems, 'no attribution lines, trailers or tool names in files or commits');
