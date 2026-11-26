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
/** The professional's line itself gives an instruction, so restating it is not advice. */
const INSTRUCTION_RE = /\b(you (need|have|must|'ll need|will need) to|i need you to|make sure|avoid|take (one|two|three|\d+|the|these|this)|bring|don't|do not)\b/i;
const INSTRUCTION_IN_LINE = { test: (line: string) => INSTRUCTION_RE.test(line) && !line.trim().endsWith('?') };
const META = /\b(as an ai|language model|i cannot help|i can't help|json|option \d)\b/i;

export const SAY_MIN_WORDS = 1;
export const SAY_MAX_WORDS = 14;

/** Default quick phrases, used to pad Say when fewer than three options survive. */
export const QUICK_PHRASES = [
  'Yes',
  'No',
  'I need help',
  'Wait',
  'Say that again',
  'Thank you',
  "I don't know",
  'Can you write that down?',
  'Slower please',
  "I'm okay",
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
  // No advice rule here: these are the user's own words to choose ("I want to stop taking these").
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
    out.push({ text, kind, filler: true });
    padded++;
  }
  while (out.length < 3) {
    const kind = SAY_KINDS[out.length];
    const text = [...PAD[kind], ...PAD.answer, ...PAD.alternative, ...PAD.question].find((p) => !out.some((o) => norm(o.text) === norm(p))) ?? 'Let me think';
    out.push({ text, kind, filler: true });
    padded++;
  }
  return { options: out.slice(0, 3), dropped, padded };
}

export const MEANS_MAX_WORDS = 22;
export const ASK_MAX_WORDS = 17;
export const QUOTE_MAX_WORDS = 12;

const NUMBER_WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
  once: 1, twice: 2, thrice: 3, first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30 };
/** Numbers written as digits, plus simple number words ("six", "forty five") as digits. */
const numbersIn = (s: string) => {
  // "1st", "15th" count as 1 and 15.
  const digits = (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.'));
  const words = s.toLowerCase().match(/[a-z]+/g) ?? [];
  const fromWords: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = NUMBER_WORDS[words[i]];
    if (w === undefined) continue;
    const next = NUMBER_WORDS[words[i + 1] ?? ''];
    if (w >= 20 && w < 100 && next !== undefined && next < 10) {
      fromWords.push(String(w + next));
      i++;
    } else fromWords.push(String(w));
  }
  return [...digits, ...fromWords];
};

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
  // A Means may restate an instruction the professional gave ("you need to sign by Friday");
  // it may not add one they did not give.
  if (DIRECTIVE.test(means) && !INSTRUCTION_IN_LINE.test(partnerLine)) {
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
    if (!q || q.length < 3 || !norm(partnerLine).includes(norm(q)) || wordCount(q) > QUOTE_MAX_WORDS) {
      notes.push('flag quote not found in the line, downgraded');
      kind = 'none';
      quote = '';
    } else quote = q;
  } else quote = '';
  if (!means && !ask) return { result: null, notes };
  return { result: { means, ask, flag: { kind, quote } }, notes };
}
