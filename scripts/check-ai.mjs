// check:ai (invariants I1, I2). Fails on any direct model API use, and enforces where models
// and cloud-capable inference modes may appear. Scans app source only (src/); tests define
// FAKE LanguageModel objects on purpose and are not app code.
//   --final: also fails while the step-zero lab page still exists (removed before submission).
import { existsSync } from 'node:fs';
import { lines, read, report, walk } from './lib.mjs';
import { generate } from './where-ai-logic.mjs';

const final = process.argv.includes('--final');
const files = walk('src', ['.ts', '.tsx', '.js', '.mjs']).map((p) => p.replaceAll('\\', '/'));
const problems = [];
const allow = (file, list) => list.some((a) => (a.endsWith('/') ? file.startsWith(a) : file === a));

const RULES = [
  { re: /LanguageModel\s*\.\s*(create|prompt\w*)\b|new\s+LanguageModel\b/, why: 'direct Prompt API call', only: [] },
  { re: /\.\s*prompt(Streaming)?\s*\(/, why: 'direct session.prompt call', only: [] },
  { re: /LanguageModel\s*\.\s*availability\b/, why: 'LanguageModel.availability outside capability.ts', only: ['src/ai/capability.ts'] },
  // No other AI SDKs or endpoints: app code may import only firebase/* and local modules,
  // and may not contain absolute URLs other than reserved example domains and localhost.
  { re: /\bfrom\s+['"](?!\.|firebase\/)[^'"]+['"]|\brequire\(\s*['"](?!\.)/, why: 'third-party import in app code (only firebase/* allowed)', only: [] },
  { re: /\bhttps?:\/\/(?!(?:[\w-]+\.)*example\.(?:com|org|net)\b|localhost\b)[A-Za-z0-9]/, why: 'absolute URL in app code', only: [] },
  { re: /generativelanguage\.googleapis|aiplatform\.googleapis|firebasevertexai\.googleapis/, why: 'model endpoint referenced directly', only: ['src/ai/egress-guard.ts'] },
  { re: /\bgetGenerativeModel\s*\(/, why: 'model created outside models.ts / cloud.ts', only: ['src/ai/models.ts', 'src/ai/cloud.ts'] },
  { re: /InferenceMode\s*\.\s*(PREFER_IN_CLOUD|ONLY_IN_CLOUD|PREFER_ON_DEVICE)\b/, why: 'cloud-capable mode outside cloud.ts (I2)', only: ['src/ai/cloud.ts'] },
  { re: /['"](prefer_in_cloud|only_in_cloud|prefer_on_device)['"]/, why: 'cloud-capable mode string outside cloud.ts (I2)', only: ['src/ai/cloud.ts'] },
  { re: /from\s+['"]firebase\/ai['"]/, why: 'firebase/ai imported outside src/ai/ and src/firebase.ts', only: ['src/ai/', 'src/firebase.ts'] },
];

for (const f of files) {
  for (const { n, l } of lines(read(f))) {
    for (const r of RULES) {
      if (r.re.test(l) && !allow(f, r.only)) problems.push(`${f}:${n} ${r.why}: ${l.trim().slice(0, 120)}`);
    }
  }
}

// I2/I3: cloud.ts must ask for approval of the exact text and arm a one-shot egress permit.
if (existsSync('src/ai/cloud.ts')) {
  const c = read('src/ai/cloud.ts');
  if (!/await approve\(outgoing\)/.test(c)) problems.push('src/ai/cloud.ts does not await approve(outgoing) before sending');
  if (!/egressGuard\.armCloudPermit\(/.test(c)) problems.push('src/ai/cloud.ts does not arm an egress permit');
}
// I1: every page entry installs the egress guard before anything else.
for (const f of files.filter((f) => /^src\/(main|lab\/lab)\.ts$/.test(f))) {
  const first = read(f).split('\n').find((l) => /^import /.test(l)) ?? '';
  if (!/install-guard/.test(first)) problems.push(`${f}: the first import must be ../ai/install-guard (egress guard first)`);
}
// R5: the call-site list must match the code.
if (!existsSync('docs/WHERE-AI-LOGIC-IS-USED.md') || read('docs/WHERE-AI-LOGIC-IS-USED.md') !== generate()) {
  problems.push('docs/WHERE-AI-LOGIC-IS-USED.md is out of date: run `npm run docs:ai`');
}
if (final) {
  for (const p of ['src/lab', 'lab']) if (existsSync(p)) problems.push(`${p} must be deleted before submission (step-zero only)`);
}

report('check:ai', problems, `${files.length} source files clean`);
