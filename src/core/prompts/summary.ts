// Summary: after the conversation, only from the lines the user ticked.

export type Summary = {
  summary: string;
  decisions: { what: string; who: string; quote: string }[];
  followups: { what: string; when: string }[];
  email: string;
};

export const SUMMARY_SYSTEM = [
  'You summarise a conversation for the person who had it, from the lines they chose to share.',
  'Lines starting "They:" were said to the person; lines starting "Me:" were said by the person; lines starting "Flagged:" are things the person marked.',
  'Write JSON with: "summary" (at most 60 words, plain English);',
  '"decisions" (what was decided, who decided, and the exact quote, only from the lines);',
  '"followups" (what the person may want to do next, with "when" relative to today such as "this week", never an invented date);',
  '"email" (a short, polite message the person could send to confirm what was agreed, first person, no greeting name).',
  'No advice beyond suggesting questions. Never invent facts, numbers or dates that are not in the lines.',
].join(' ');

export const SUMMARY_DEVICE_SYSTEM =
  'You summarise a conversation for the person who had it. Write JSON with "summary" (at most 50 words), "decisions" (what, who, quote; only from the lines), "followups" (what, when; never an invented date) and "email" (at most 60 words, first person). Never invent facts.';

export const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    decisions: { type: 'array', maxItems: 8, items: { type: 'object', properties: { what: { type: 'string' }, who: { type: 'string' }, quote: { type: 'string' } }, required: ['what', 'who', 'quote'] } },
    followups: { type: 'array', maxItems: 6, items: { type: 'object', properties: { what: { type: 'string' }, when: { type: 'string' } }, required: ['what', 'when'] } },
    email: { type: 'string' },
  },
  required: ['summary', 'decisions', 'followups', 'email'],
} as const;

export type SummaryLine = { kind: 'They' | 'Me' | 'Flagged'; text: string };

/** The exact text that will be sent: one line per ticked item, in conversation order. */
export function summaryUser(lines: readonly SummaryLine[]): string {
  return lines.map((l) => `${l.kind}: ${l.text}`).join('\n');
}

const s = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function toSummary(raw: unknown): Summary | null {
  const r = raw as Record<string, unknown> | undefined;
  if (!r || typeof r !== 'object') return null;
  const out: Summary = {
    summary: s(r.summary, 700),
    decisions: Array.isArray(r.decisions) ? r.decisions.map((d) => ({ what: s((d as Record<string, unknown>)?.what, 200), who: s((d as Record<string, unknown>)?.who, 60), quote: s((d as Record<string, unknown>)?.quote, 200) })).filter((d) => d.what).slice(0, 8) : [],
    followups: Array.isArray(r.followups) ? r.followups.map((f) => ({ what: s((f as Record<string, unknown>)?.what, 200), when: s((f as Record<string, unknown>)?.when, 60) })).filter((f) => f.what).slice(0, 6) : [],
    email: String(r.email ?? '').trim().slice(0, 1500),
  };
  return out.summary ? out : null;
}
