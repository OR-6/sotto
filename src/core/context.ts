// Builds the compact context block every live prompt starts with.
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

/**
 * Header lines in a fixed order, then the turns. Over budget, the brief and voice digests shrink
 * first (120, 60, 30 words, then none); the header is never cut, and the last partner turn is kept.
 */
export function buildContext(c: ContextInput): string {
  for (const words of [DIGEST_MAX_WORDS, 60, 30, 0]) {
    const header = [
      `Situation: ${c.situation || 'a conversation'}`,
      `Talking to: ${c.partner || 'someone'}`,
      `Tone: ${c.tone}${c.joke ? ', add a light joke where it fits' : ''}`,
      `Brief: ${c.brief && words ? capWords(c.brief, words) : 'none'}`,
      `Voice: ${c.voice && words ? capWords(c.voice, words) : 'none'}`,
      'Conversation (oldest first):',
    ].join('\n');
    const room = c.budgetChars - header.length - 1;
    if (room < 200 && words) continue; // give the turns room: shrink the digests
    const turns = trimTurns(c.turns, Math.max(40, room));
    const body = turns.length ? turns.map((t) => `${t.who}: ${t.text}`).join('\n') : '(nothing said yet)';
    const out = `${header}\n${body}`;
    if (out.length <= c.budgetChars || !words) return out.length <= c.budgetChars ? out : out.slice(0, c.budgetChars);
  }
  return '';
}
