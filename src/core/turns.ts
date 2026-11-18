// The turn model. A turn is one finished utterance: the partner's (P) or the user's (Y).
// Pure: no DOM, no Firebase.

export type Speaker = 'P' | 'Y';
export type Turn = { id: number; who: Speaker; text: string; at: number; via: 'speech' | 'typed' | 'tap' };

/** Collapses whitespace and strips control characters so a turn is one clean line. */
export function cleanLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Characters per token used for budgeting (countTokens is not available for hybrid). */
export const CHARS_PER_TOKEN = 4;
/** A token budget as characters, with a 20 % safety margin. */
export const tokensToChars = (tokens: number) => Math.floor(tokens * CHARS_PER_TOKEN * 0.8);

export function lastPartner(turns: readonly Turn[]): Turn | undefined {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].who === 'P') return turns[i];
  return undefined;
}

const lineCost = (t: Turn) => t.text.length + 4; // "P: " plus a newline

/**
 * Keeps the most recent turns (at most `maxTurns`) that fit in `budgetChars` when rendered
 * as `X: text` lines. The last partner turn is never dropped: its room is reserved first,
 * and if it alone is over budget it is cut from the front (the end of what was said matters
 * most for what to say next).
 */
export function trimTurns(turns: readonly Turn[], budgetChars: number, maxTurns = 8): Turn[] {
  const recent = turns.slice(-maxTurns);
  const lastP = lastPartner(recent);
  let anchor: Turn | undefined;
  let used = 0;
  if (lastP) {
    anchor = lineCost(lastP) > budgetChars ? { ...lastP, text: '…' + lastP.text.slice(-Math.max(1, budgetChars - 5)) } : lastP;
    used = lineCost(anchor);
  }
  const anchorIndex = lastP ? recent.indexOf(lastP) : -1;
  const out: Turn[] = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const t = recent[i];
    if (i === anchorIndex) {
      out.unshift(anchor!);
      continue;
    }
    if (used + lineCost(t) > budgetChars) {
      if (i > anchorIndex) continue; // a newer turn that does not fit: skip it, still place the anchor
      break; // older turns stop at the first that does not fit
    }
    out.unshift(t);
    used += lineCost(t);
  }
  return out;
}

export const wordCount = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
