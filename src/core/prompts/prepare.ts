// Prepare: a brief before a conversation the person is nervous about. The cloud writes the
// full brief from the one situation line the user typed (and saw before sending); the device
// writes a shorter one offline or when the user keeps everything on the device.

export type Brief = {
  what: string;
  terms: { term: string; meaning: string }[];
  questions: string[];
  bring: string[];
  red_flags: string[];
  panic: string[];
  /** ≤ 100 words for the small model to use live. */
  digest: string;
};

export const PREPARE_SYSTEM = [
  'You prepare a person for a conversation they are nervous about, from one line describing the situation.',
  'Write JSON with: "what" (what will probably happen, at most 60 words);',
  '"terms" (5 to 8 terms they may hear, each with a plain meaning of at most 12 words);',
  '"questions" (five questions people in this situation often regret not asking, first person);',
  '"bring" (three things to bring or have ready); "red_flags" (three things to watch for);',
  '"panic" (three short sentences to say if they freeze, first person);',
  '"digest" (at most 100 words: the key terms, what matters and what to watch for, for a small model to use during the conversation).',
  'Plain English. No medical or legal advice beyond "ask about". Do not invent rules of a specific institution, numbers, prices or dates.',
].join(' ');

export const PREPARE_DEVICE_SYSTEM = [
  'You prepare a person for a conversation they are nervous about, from one line describing the situation.',
  'Write JSON with: "what" (what will probably happen, at most 40 words); "questions" (three questions to ask, first person);',
  '"panic" (two short sentences to say if they freeze); "digest" (at most 60 words for a small model to use live).',
  'Plain English. No advice. Do not invent numbers, prices or dates.',
].join(' ');

const strArr = (min: number, max: number) => ({ type: 'array', minItems: min, maxItems: max, items: { type: 'string' } });

export const PREPARE_SCHEMA = {
  type: 'object',
  properties: {
    what: { type: 'string' },
    terms: { type: 'array', minItems: 3, maxItems: 8, items: { type: 'object', properties: { term: { type: 'string' }, meaning: { type: 'string' } }, required: ['term', 'meaning'] } },
    questions: strArr(3, 6),
    bring: strArr(1, 4),
    red_flags: strArr(1, 4),
    panic: strArr(2, 4),
    digest: { type: 'string' },
  },
  required: ['what', 'terms', 'questions', 'bring', 'red_flags', 'panic', 'digest'],
} as const;

export const PREPARE_DEVICE_SCHEMA = {
  type: 'object',
  properties: { what: { type: 'string' }, questions: strArr(2, 4), panic: strArr(1, 3), digest: { type: 'string' } },
  required: ['what', 'questions', 'panic', 'digest'],
} as const;

export const prepareUser = (situation: string) => `Situation: ${situation}`;

const s = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => s(x, max)).filter(Boolean).slice(0, n) : []);

/** Validates a brief from either model. Cloud output is untrusted: text only, capped, shaped. */
export function toBrief(raw: unknown): Brief | null {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return null;
  const brief: Brief = {
    what: s(r.what, 600),
    terms: Array.isArray(r.terms)
      ? r.terms
          .map((t) => ({ term: s((t as { term?: unknown })?.term, 60), meaning: s((t as { meaning?: unknown })?.meaning, 160) }))
          .filter((t) => t.term && t.meaning)
          .slice(0, 8)
      : [],
    questions: list(r.questions, 6, 200),
    bring: list(r.bring, 4, 160),
    red_flags: list(r.red_flags, 4, 160),
    panic: list(r.panic, 4, 120),
    digest: s(r.digest, 900),
  };
  if (!brief.what && !brief.questions.length) return null;
  if (!brief.digest) brief.digest = [brief.what, ...brief.terms.map((t) => `${t.term}: ${t.meaning}`)].join(' ').slice(0, 700);
  return brief;
}
