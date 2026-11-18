// check:secrets. Scans every file git tracks (or would track) for keys,
// tokens, service-account files and real-looking personal data.
import { projectFiles, read, report } from './lib.mjs';

const SKIP = [/^package-lock\.json$/, /\.(png|jpe?g|gif|ico|webp|woff2?|pdf)$/i];
const SECRETS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'service-account JSON', re: /"type"\s*:\s*"service_account"/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'UUID-shaped token (App Check debug token format)', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i },
  { name: 'secret-looking assignment', re: /\b(api[_-]?key|secret|password|token)\b\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i },
];
// Synthetic-data rules: reserved domains, UK drama phone ranges, the documentation IBAN.
const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})\b/g;
const EMAIL_OK = /(^|\.)example\.(com|org|net)$/i;
const UK_MOBILE = /(?<!\d)(?:\+44\s?|0)7\d{3}[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/g;
const UK_MOBILE_OK = /7700[\s.-]?900/;
const UK_LANDLINE = /(?<!\d)01\d{3}[\s.-]?\d{3}[\s.-]?\d{3}(?!\d)/g;
const UK_LANDLINE_OK = /^01632[\s.-]?960/;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,4})?\b/g;
const IBAN_OK = /^GB82 ?WEST/;

const problems = [];
const files = projectFiles().filter((f) => !SKIP.some((r) => r.test(f)));
for (const f of files) {
  if (/(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example')) problems.push(`${f}: environment file is tracked`);
  let text;
  try {
    text = read(f);
  } catch {
    continue;
  }
  for (const s of SECRETS) if (s.re.test(text)) problems.push(`${f}: ${s.name}`);
  for (const m of text.matchAll(EMAIL)) if (!EMAIL_OK.test(m[1]) && !f.startsWith('scripts/')) problems.push(`${f}: non-example email domain "${m[1]}"`);
  for (const m of text.matchAll(UK_MOBILE)) if (!UK_MOBILE_OK.test(m[0])) problems.push(`${f}: real-looking mobile number "${m[0]}"`);
  for (const m of text.matchAll(UK_LANDLINE)) if (!UK_LANDLINE_OK.test(m[0])) problems.push(`${f}: real-looking landline "${m[0]}"`);
  for (const m of text.matchAll(IBAN)) if (!IBAN_OK.test(m[0]) && /\d{6}/.test(m[0].replace(/ /g, ''))) problems.push(`${f}: IBAN-like value "${m[0]}"`);
}
report('check:secrets', problems, `${files.length} files clean`);
