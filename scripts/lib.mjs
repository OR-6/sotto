// Shared helpers for the check:* scripts.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export function walk(dir, exts) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (!exts || exts.some((e) => p.endsWith(e))) out.push(p);
  }
  return out;
}

/** Files git tracks or would track (respects .gitignore and .git/info/exclude). */
export function projectFiles() {
  try {
    return execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean).filter((f) => existsSync(f));
  } catch {
    return walk('.', null).map((p) => relative('.', p)).filter((p) => !p.startsWith('node_modules') && !p.startsWith('dist') && !p.startsWith('.git'));
  }
}

export function read(p) {
  return readFileSync(p, 'utf8');
}

/** Reports findings and sets the exit code. */
export function report(name, problems, okLine) {
  if (problems.length) {
    for (const p of problems) console.error(`${name}: ${p}`);
    console.error(`${name}: FAILED (${problems.length})`);
    process.exitCode = 1;
  } else {
    console.log(`${name}: ${okLine}`);
  }
}

/** Every line of a file with its 1-based number, comments included. */
export function lines(text) {
  return text.split('\n').map((l, i) => ({ n: i + 1, l }));
}
