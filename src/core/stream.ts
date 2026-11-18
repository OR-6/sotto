// Reads usable pieces out of a partial JSON stream, so the first suggestion can be shown
// before the model has finished the third.

const STR = '"((?:[^"\\\\]|\\\\.)*)"';

const unescape = (s: string) => {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
};

/** Every completed `"text": "..."` value in a partial Say stream, in order. */
export function partialSayTexts(soFar: string): string[] {
  const re = new RegExp(`"text"\\s*:\\s*${STR}`, 'g');
  return [...soFar.matchAll(re)].map((m) => unescape(m[1]));
}

/** The completed `means` and `ask` values in a partial Ask stream. */
export function partialAsk(soFar: string): { means?: string; ask?: string } {
  const get = (k: string) => {
    const m = soFar.match(new RegExp(`"${k}"\\s*:\\s*${STR}`));
    return m ? unescape(m[1]) : undefined;
  };
  return { means: get('means'), ask: get('ask') };
}
