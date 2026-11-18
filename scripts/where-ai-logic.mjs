// Generates docs/WHERE-AI-LOGIC-IS-USED.md from the source (SPEC R5), so every file and
// line pointer is exact. `npm run docs:ai` writes it; `check:ai` fails if it is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { lines, walk } from './lib.mjs';

const OUT = 'docs/WHERE-AI-LOGIC-IS-USED.md';
const PATTERNS = [
  { re: /\bgetAI\s*\(/, what: '`getAI`: creates the AI Logic service (Gemini Developer API backend, limited-use App Check tokens)' },
  { re: /\bgetGenerativeModel\s*\(/, what: '`getGenerativeModel`: creates a model' },
  { re: /\.generateContent\s*\(/, what: '`generateContent`: **runs inference**' },
  { re: /\.generateContentStream\s*\(/, what: '`generateContentStream`: **runs inference, streaming**' },
  { re: /\.initializeDeviceModel\s*\(/, what: '`initializeDeviceModel`: prepares / downloads the on-device model (on a user click)' },
  { re: /InferenceMode\s*\.\s*[A-Z_]+/, what: 'inference mode' },
  { re: /responseConstraint\s*:/, what: 'on-device structured output (`responseConstraint`)' },
  { re: /responseSchema\s*:/, what: 'cloud structured output (`responseSchema`)' },
  { re: /\.inferenceSource\b/, what: '`inferenceSource` read (Receipt / post-check)' },
  { re: /LanguageModel\s*\.\s*availability/, what: '`LanguageModel.availability()`: feature detection only, no inference (the one direct Prompt API call)' },
];

export function generate() {
  const rows = [];
  for (const f of walk('src', ['.ts']).map((p) => p.replaceAll('\\', '/')).sort()) {
    for (const { n, l } of lines(readFileSync(f, 'utf8'))) {
      if (/^\s*(\/\/|\*)/.test(l)) continue;
      for (const p of PATTERNS) {
        const m = l.match(p.re);
        if (m) rows.push(`| [${f}:${n}](../${f}#L${n}) | ${p.what === 'inference mode' ? `inference mode \`${m[0].replace(/\s/g, '')}\`` : p.what} |`);
      }
    }
  }
  return `# Where Firebase AI Logic is used

Every model call in Sotto goes through **Firebase AI Logic** (\`firebase/ai\`, hybrid inference). No other model API is called (enforced by \`npm run check:ai\`). This file is generated from the source by \`npm run docs:ai\`; \`check:ai\` fails if it is out of date.

## The split

| Step | Module | Inference mode | What the model sees | Where it runs |
|---|---|---|---|---|
| Live: Say, Ask, completions, repeat-back, jargon (Private mode) | [src/ai/models.ts](../src/ai/models.ts) \`createDeviceOnlyModel\` | \`ONLY_ON_DEVICE\` + runtime pre-check + \`inferenceSource\` post-check + egress guard | the last turns, chips, compact brief and voice digests | Gemini Nano in Chrome, on the device |
| Live in Cloud live mode (explicit, red banner) | [src/ai/cloud.ts](../src/ai/cloud.ts) \`cloudCall\` | \`PREFER_ON_DEVICE\` | the same | the device when it has the model, else the cloud; the receipt says which |
| Prepare (the brief) | [src/ai/cloud.ts](../src/ai/cloud.ts) \`cloudCall\` | \`PREFER_IN_CLOUD\`, falls back to a shorter on-device brief offline | the situation line the user typed, shown first | the cloud, or the device offline |
| Voice pack | [src/ai/cloud.ts](../src/ai/cloud.ts) \`cloudCall\` | \`ONLY_IN_CLOUD\` | the phrases and answers the user typed, shown first | the cloud |
| Summary | [src/ai/cloud.ts](../src/ai/cloud.ts) \`cloudCall\`, or on device | \`PREFER_IN_CLOUD\` or \`ONLY_ON_DEVICE\` | only the lines the user ticked, shown first | the cloud, or the device |
| Capability check | [src/ai/capability.ts](../src/ai/capability.ts) | none (no inference) | nothing | on the device |

Service setup: [src/firebase.ts](../src/firebase.ts) (\`initializeApp\`, App Check with reCAPTCHA Enterprise, \`getAI\` with \`useLimitedUseAppCheckTokens: true\`). Cloud model name and kill switch: Remote Config, [src/config.ts](../src/config.ts).

## Every call site (generated)

| Where | What |
|---|---|
${rows.join('\n')}
`;
}

if (process.argv[1]?.endsWith('where-ai-logic.mjs')) {
  writeFileSync(OUT, generate());
  console.log(`docs:ai: wrote ${OUT}`);
}
