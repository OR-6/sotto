// Builds the compact context block every live prompt starts with (docs/CONTENT.md §1).
// Pure and budgeted: the result never exceeds `budgetChars`.
import { trimTurns, type Turn } from './turns';

export type Tone = 'casual' | 'neutral' | 'formal';
export type ContextInput = {
  situation: string;
  partner: string;
  tone: Tone;
  joke: boolean;
  /** Situation pack digest plus the active brief digest, or ''. */
  brief: string;
  /** Voice pack digest, or ''. */
  voice: string;
  turns: readonly Turn[];
  /** Total character budget for the context block. */
  budgetChars: number;
};

export const DIGEST_MAX_WORDS = 120;

export function capWords(s: string, max: number): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  return words.length <= max ? words.join(' ') : words.slice(0, max).join(' ') + ' …';
}

/** Header lines in a fixed order; digests are capped by words so the turns keep their room. */
export function buildContext(c: ContextInput): string {
  const header = [
    `Situation: ${c.situation || 'a conversation'}`,
    `Talking to: ${c.partner || 'someone'}`,
    `Tone: ${c.tone}${c.joke ? ', add a light joke where it fits' : ''}`,
    `Brief: ${c.brief ? capWords(c.brief, DIGEST_MAX_WORDS) : 'none'}`,
    `Voice: ${c.voice ? capWords(c.voice, DIGEST_MAX_WORDS) : 'none'}`,
    'Conversation (oldest first):',
  ].join('\n');
  const room = Math.max(200, c.budgetChars - header.length - 1);
  const turns = trimTurns(c.turns, room);
  const body = turns.length ? turns.map((t) => `${t.who}: ${t.text}`).join('\n') : '(nothing said yet)';
  const out = `${header}\n${body}`;
  return out.length <= c.budgetChars ? out : out.slice(out.length - c.budgetChars);
}
