// Post-filters on model output (docs/CONTENT.md §2, §3). The on-device model has no
// temperature control on Web, so quality comes from the constraint plus these rules.
// Every function is pure and total: bad input gives a safe, empty-ish result, never a throw.
import { FLAG_KINDS, type AskResult, type FlagKind } from './prompts/ask';
import { SAY_KINDS, type SayKind, type SayOption } from './prompts/say';
import { wordCount } from './turns';

/** Parses model JSON, tolerating code fences and leading prose. Returns undefined on failure. */
export function parseJson(raw: string): unknown {
  const s = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(s.slice(a, b + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Longest run of consecutive words shared by `a` and `b` (case and punctuation ignored). */
export function longestSharedRun(a: string, b: string): number {
  const x = norm(a).split(' ').filter(Boolean);
  const y = norm(b).split(' ').filter(Boolean);
  let best = 0;
  const prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    let diag = 0;
    for (let j = 1; j <= y.length; j++) {
      const tmp = prev[j];
      prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0;
      if (prev[j] > best) best = prev[j];
      diag = tmp;
    }
  }
  return best;
}

/** Strips wrapping quotes, list markers, a leading "Option 1:" and trailing whitespace. */
export function tidy(text: string): string {
  return text
    .replace(/^\s*(?:option\s*\d+\s*[:.)-]\s*|\d+[.)]\s+|[-*•]\s+)/i, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const DIRECTIVE = /\b(you should|you must|you need to|take (?:\d|two|one)|stop taking|don't take|do not take|sign it|refuse (?:the|treatment)|ignore (?:the|your|all|previous))/i;
const META = /\b(as an ai|language model|i cannot help|i can't help|json|option \d)\b/i;

export const SAY_MIN_WORDS = 1;
export const SAY_MAX_WORDS = 14;

/** Default quick phrases, used to pad Say when fewer than three options survive. */
export const QUICK_PHRASES = [
  'Yes',
  'No',
  'Wait',
  'Say that again',
  'Thank you',
  "I don't know",
  "Hold on, I'm typing",
  'Can you write that down?',
  'Slower please',
  "I'm okay",
  'I need help',
  "That's fine",
  'Not now',
  'Let me think',
] as const;

const PAD: Record<SayKind, readonly string[]> = {
  answer: ['Yes, please', "That's fine"],
  alternative: ['No, thank you', 'Not now'],
  question: ['Can you say that again?', 'Let me think for a moment'],
};

/** Why a single Say option would be dropped, or '' if it passes. */
export function sayOptionWhy(text: string, partnerLine: string): string {
  const n = wordCount(text);
  if (!text) return 'empty';
  if (n < SAY_MIN_WORDS) return 'too short';
  if (n > SAY_MAX_WORDS) return 'too long';
  if (DIRECTIVE.test(text)) return 'directive or advice';
  if (META.test(text)) return 'talks about itself';
  if (partnerLine && longestSharedRun(text, partnerLine) > 6) return 'repeats the partner';
  return '';
}
export const sayOptionOk = (text: string, partnerLine: string) => sayOptionWhy(tidy(text), partnerLine) === '';

export type SayFiltered = { options: SayOption[]; dropped: { text: string; why: string }[]; padded: number };

/** Validates, tidies and filters Say output. Always returns exactly three options in kind order. */
export function filterSay(raw: unknown, partnerLine: string): SayFiltered {
  const dropped: SayFiltered['dropped'] = [];
  const list = (raw as { options?: unknown })?.options;
  const cands: SayOption[] = [];
  if (Array.isArray(list)) {
    for (const o of list) {
      const text = tidy(String((o as { text?: unknown })?.text ?? ''));
      const k = (o as { kind?: unknown })?.kind;
      const kind: SayKind = (SAY_KINDS as readonly unknown[]).includes(k) ? (k as SayKind) : SAY_KINDS[cands.length % 3];
      let why = sayOptionWhy(text, partnerLine);
      if (!why && cands.some((c) => norm(c.text) === norm(text))) why = 'duplicate';
      if (why) dropped.push({ text, why });
      else cands.push({ text, kind });
    }
  }
  // One per kind where possible, in the fixed order answer, alternative, question.
  const out: SayOption[] = [];
  const pool = [...cands];
  for (const kind of SAY_KINDS) {
    const i = pool.findIndex((c) => c.kind === kind);
    if (i >= 0) out.push(pool.splice(i, 1)[0]);
  }
  while (out.length < 3 && pool.length) out.push(pool.shift()!);
  let padded = 0;
  for (const kind of SAY_KINDS) {
    if (out.length >= 3) break;
    if (out.some((o) => o.kind === kind)) continue;
    const text = PAD[kind].find((p) => !out.some((o) => norm(o.text) === norm(p))) ?? PAD[kind][0];
    out.push({ text, kind });
    padded++;
  }
  while (out.length < 3) {
    const kind = SAY_KINDS[out.length];
    const text = [...PAD[kind], ...PAD.answer, ...PAD.alternative, ...PAD.question].find((p) => !out.some((o) => norm(o.text) === norm(p))) ?? 'Let me think';
    out.push({ text, kind });
    padded++;
  }
  return { options: out.slice(0, 3), dropped, padded };
}

export const MEANS_MAX_WORDS = 22;
export const ASK_MAX_WORDS = 17;
export const QUOTE_MAX_WORDS = 12;

const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));

export type AskFiltered = { result: AskResult | null; notes: string[] };

/** Validates and filters Ask output. `known` is the partner line plus the brief (for the number rule). */
export function filterAsk(raw: unknown, partnerLine: string, known = ''): AskFiltered {
  const notes: string[] = [];
  const r = raw as Partial<AskResult> | undefined;
  let means = tidy(String(r?.means ?? ''));
  let ask = tidy(String(r?.ask ?? ''));
  const kindRaw = r?.flag?.kind;
  let kind: FlagKind = (FLAG_KINDS as readonly unknown[]).includes(kindRaw) ? (kindRaw as FlagKind) : 'none';
  let quote = tidy(String(r?.flag?.quote ?? ''));

  if (!means && !ask) return { result: null, notes: ['empty'] };
  if (wordCount(means) > MEANS_MAX_WORDS) {
    notes.push('means too long, cut');
    means = means.split(/\s+/).slice(0, MEANS_MAX_WORDS).join(' ') + '…';
  }
  const allowed = new Set([...numbersIn(partnerLine), ...numbersIn(known)]);
  if (numbersIn(means).some((n) => !allowed.has(n))) {
    notes.push('means invented a number, dropped');
    means = '';
  }
  if (DIRECTIVE.test(means)) {
    notes.push('means gave advice, dropped');
    means = '';
  }
  if (ask && !ask.endsWith('?')) {
    if (/^(what|how|why|when|where|who|which|can|could|will|would|is|are|do|does|did|should|may|have|has)\b/i.test(ask)) ask += '?';
    else {
      notes.push('ask was not a question, dropped');
      ask = '';
    }
  }
  if (ask && wordCount(ask) > ASK_MAX_WORDS) {
    notes.push('ask too long, dropped');
    ask = '';
  }
  if (ask && DIRECTIVE.test(ask)) {
    notes.push('ask gave advice, dropped');
    ask = '';
  }
  if (kind !== 'none') {
    const q = quote.replace(/[.…]+$/, '');
    if (!q || !norm(partnerLine).includes(norm(q)) || wordCount(q) > QUOTE_MAX_WORDS) {
      notes.push('flag quote not found in the line, downgraded');
      kind = 'none';
      quote = '';
    } else quote = q;
  } else quote = '';
  if (!means && !ask) return { result: null, notes };
  return { result: { means, ask, flag: { kind, quote } }, notes };
}
