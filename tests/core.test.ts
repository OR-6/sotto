import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildContext, capWords } from '../src/core/context';
import { filterAsk, filterSay, longestSharedRun, parseJson, tidy, SAY_MAX_WORDS, ASK_MAX_WORDS, MEANS_MAX_WORDS } from '../src/core/filter';
import { createReceipt, sha256Hex } from '../src/core/receipt';
import { computeStats, median, percentile } from '../src/core/stats';
import { partialAsk, partialSayTexts } from '../src/core/stream';
import { cleanLine, lastPartner, tokensToChars, trimTurns, wordCount, type Turn } from '../src/core/turns';

const T = (id: number, who: 'P' | 'Y', text: string): Turn => ({ id, who, text, at: id, via: 'typed' });

describe('turns', () => {
  it('cleans control characters and whitespace', () => {
    expect(cleanLine('  hi\u0000 there\n\tyou ')).toBe('hi there you');
  });

  it('never drops the last partner turn, whatever the budget', () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.constantFrom<'P' | 'Y'>('P', 'Y'), fc.string({ minLength: 1, maxLength: 400 })), { minLength: 1, maxLength: 20 }), fc.integer({ min: 20, max: 4000 }), (raw, budget) => {
        const turns = raw.map(([w, t], i) => T(i + 1, w, t));
        const out = trimTurns(turns, budget);
        const lp = lastPartner(turns.slice(-8));
        if (lp) expect(out.some((t) => t.id === lp.id)).toBe(true);
        // order is preserved
        const ids = out.map((t) => t.id);
        expect([...ids].sort((a, b) => a - b)).toEqual(ids);
        // budget respected except the anchor's own minimum
        const used = out.reduce((n, t) => n + t.text.length + 4, 0);
        expect(used).toBeLessThanOrEqual(Math.max(budget, 6));
      }),
    );
  });

  it('keeps at most eight turns, the most recent', () => {
    const turns = Array.from({ length: 12 }, (_, i) => T(i + 1, i % 2 ? 'Y' : 'P', `line ${i + 1}`));
    const out = trimTurns(turns, 10_000);
    expect(out.map((t) => t.id)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('cuts an over-long partner turn from the front', () => {
    const out = trimTurns([T(1, 'P', 'a'.repeat(500) + ' THE END')], 100);
    expect(out[0].text.endsWith('THE END')).toBe(true);
    expect(out[0].text.startsWith('…')).toBe(true);
  });

  it('budgets by characters with a margin', () => {
    expect(tokensToChars(1000)).toBe(3200);
    expect(wordCount('  one two  three ')).toBe(3);
  });
});

describe('context', () => {
  const base = { situation: 'Café', partner: 'the barista', tone: 'neutral' as const, joke: false, brief: '', voice: '', turns: [T(1, 'P', 'What can I get you?')], budgetChars: 3000 };
  it('renders the header and the turns in order', () => {
    const c = buildContext({ ...base, turns: [T(1, 'P', 'Hi'), T(2, 'Y', 'Hello'), T(3, 'P', 'Oat milk okay?')] });
    expect(c).toContain('Situation: Café');
    expect(c).toMatch(/P: Hi\nY: Hello\nP: Oat milk okay\?$/);
    expect(c).toContain('Brief: none');
  });
  it('caps digests by words', () => {
    expect(capWords('a b c d e', 3)).toBe('a b c …');
    const c = buildContext({ ...base, brief: 'word '.repeat(500) });
    expect(c.length).toBeLessThan(1200);
  });
  it('never exceeds the budget', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2000 }), fc.string({ maxLength: 2000 }), fc.array(fc.string({ minLength: 1, maxLength: 600 }), { minLength: 1, maxLength: 12 }), fc.integer({ min: 600, max: 12000 }), (brief, voice, lines, budget) => {
        const turns = lines.map((l, i) => T(i + 1, i % 2 ? 'Y' : 'P', l));
        expect(buildContext({ ...base, brief, voice, turns, budgetChars: budget }).length).toBeLessThanOrEqual(budget);
      }),
    );
  });
  it('shrinks the digests before cutting anything, and never cuts the header', () => {
    const c = buildContext({ ...base, brief: 'brief '.repeat(300), voice: 'voice '.repeat(300), turns: [T(1, 'P', 'x'.repeat(500))], budgetChars: 900 });
    expect(c.startsWith('Situation: Café')).toBe(true);
    expect(c).toContain('Conversation (oldest first):');
    expect(c.length).toBeLessThanOrEqual(900);
  });

  it('mentions a joke only when asked', () => {
    expect(buildContext({ ...base, joke: true })).toContain('light joke');
    expect(buildContext(base)).not.toContain('joke');
  });
});

describe('parseJson', () => {
  it('parses fenced and prefixed JSON', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
    expect(parseJson('nope')).toBeUndefined();
  });
});

describe('filterSay', () => {
  const ok = { options: [{ text: 'An iced latte, please', kind: 'answer' }, { text: 'Just water for me', kind: 'alternative' }, { text: 'What do you recommend?', kind: 'question' }] };
  it('passes three good options unchanged, in kind order', () => {
    const f = filterSay({ options: [ok.options[2], ok.options[0], ok.options[1]] }, 'What can I get you?');
    expect(f.options.map((o) => o.kind)).toEqual(['answer', 'alternative', 'question']);
    expect(f.padded).toBe(0);
    expect(f.dropped).toEqual([]);
  });
  it('keeps the user\'s own strong words; drops meta talk, echoes and over-long options, then pads with labelled filler', () => {
    const own = filterSay({ options: [{ text: 'I want to stop taking these pills', kind: 'answer' }, { text: 'You need to call my wife now', kind: 'alternative' }, { text: 'Who can I talk to?', kind: 'question' }] }, 'Is there anyone we should call?');
    expect(own.dropped).toEqual([]);
    expect(own.options.map((o) => o.text)).toContain('You need to call my wife now');
    const f = filterSay(
      {
        options: [
          { text: 'As an AI language model I agree', kind: 'answer' },
          { text: 'As an AI I cannot help with that', kind: 'alternative' },
          { text: 'the mri shows a partial tear of the medial meniscus', kind: 'question' },
          { text: 'word '.repeat(20), kind: 'answer' },
        ],
      },
      'The MRI shows a partial tear of the medial meniscus.',
    );
    expect(f.dropped.map((d) => d.why)).toEqual(['talks about itself', 'talks about itself', 'repeats the partner', 'too long']);
    expect(f.options).toHaveLength(3);
    expect(f.padded).toBe(3);
    expect(f.options.every((o) => o.filler)).toBe(true);
  });
  it('tidies quotes and list markers', () => {
    expect(tidy('1. "Yes, please"')).toBe('Yes, please');
    expect(tidy('Option 2: No thanks')).toBe('No thanks');
  });
  it('always returns exactly three options within the word cap (property)', () => {
    fc.assert(
      fc.property(fc.anything(), fc.string(), (raw, line) => {
        const f = filterSay(raw, line);
        expect(f.options).toHaveLength(3);
        for (const o of f.options) expect(wordCount(o.text)).toBeLessThanOrEqual(SAY_MAX_WORDS);
      }),
    );
  });
  it('never passes an option quoting more than six consecutive partner words (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('the', 'tear', 'of', 'knee', 'is', 'partial', 'a', 'shows', 'mri', 'yes'), { minLength: 7, maxLength: 14 }), (words) => {
        const line = words.join(' ');
        const f = filterSay({ options: [{ text: line, kind: 'answer' }] }, line);
        for (const o of f.options) expect(longestSharedRun(o.text, line)).toBeLessThanOrEqual(6);
      }),
    );
  });
});

describe('filterAsk', () => {
  const line = 'Your rent goes up by 45 euros from the first of March, and you need to sign by Friday.';
  it('keeps a good answer and a verbatim flag', () => {
    const f = filterAsk({ means: 'Your rent rises by 45 euros a month from March.', ask: 'Can I see the new agreement in writing first?', flag: { kind: 'deadline', quote: 'you need to sign by Friday' } }, line);
    expect(f.result?.flag).toEqual({ kind: 'deadline', quote: 'you need to sign by Friday' });
  });
  it('drops a Means with an invented number', () => {
    const f = filterAsk({ means: 'Your rent rises by 50 euros.', ask: 'When does it start?', flag: { kind: 'none', quote: '' } }, line);
    expect(f.result?.means).toBe('');
    expect(f.notes).toContain('means invented a number, dropped');
  });
  it('accepts ordinals and "twice" (measured false drops in the step-zero bench)', () => {
    expect(filterAsk({ means: 'Your rent will be 45 euros higher from March 1st.', ask: 'When?', flag: { kind: 'none', quote: '' } }, 'Your rent goes up by 45 euros from the first of March.').result?.means).toContain('March 1st');
    expect(filterAsk({ means: 'Swallow one tablet two times each day with food.', ask: 'Why?', flag: { kind: 'none', quote: '' } }, 'Take one tablet twice a day with food.').result?.means).toContain('two times');
    expect(filterAsk({ means: 'Sign by the 15th.', ask: 'Why?', flag: { kind: 'none', quote: '' } }, 'Sign the renewal by the fifteenth.').result?.means).toBe('Sign by the 15th.');
  });

  it('accepts numbers the line gave as words, rejects one-word flag quotes', () => {
    const l = 'That means six weeks of physiotherapy, and your rent goes up by forty five euros.';
    expect(filterAsk({ means: 'Physio for 6 weeks; rent up 45 euros.', ask: 'When?', flag: { kind: 'none', quote: '' } }, l).result?.means).toBe('Physio for 6 weeks; rent up 45 euros.');
    expect(filterAsk({ means: 'x', ask: 'When?', flag: { kind: 'cost', quote: 'euros' } }, l).result?.flag.kind).toBe('none');
  });

  it('downgrades a flag whose quote is not in the line', () => {
    const f = filterAsk({ means: 'A rent rise.', ask: 'Why?', flag: { kind: 'cost', quote: 'two hundred euros' } }, line);
    expect(f.result?.flag.kind).toBe('none');
  });
  it('adds a missing question mark to a question, drops a statement', () => {
    expect(filterAsk({ means: 'x', ask: 'When does it start', flag: { kind: 'none', quote: '' } }, line).result?.ask).toBe('When does it start?');
    expect(filterAsk({ means: 'x', ask: 'Sign it today.', flag: { kind: 'none', quote: '' } }, line).result?.ask).toBe('');
  });
  it('drops advice', () => {
    const f = filterAsk({ means: 'You should refuse the treatment.', ask: 'What happens if I wait?', flag: { kind: 'none', quote: '' } }, 'We recommend surgery.');
    expect(f.result?.means).toBe('');
  });
  it('never passes over-long or non-question Ask lines, or invented numbers (property)', () => {
    fc.assert(
      fc.property(fc.anything(), fc.string(), (raw, l) => {
        const r = filterAsk(raw, l).result;
        if (!r) return;
        if (r.ask) {
          expect(r.ask.endsWith('?')).toBe(true);
          expect(wordCount(r.ask)).toBeLessThanOrEqual(ASK_MAX_WORDS);
        }
        expect(wordCount(r.means.replace(/…$/, ''))).toBeLessThanOrEqual(MEANS_MAX_WORDS);
        const nums = r.means.match(/\d+(?:[.,]\d+)?/g) ?? [];
        for (const n of nums) expect(l.replace(',', '.')).toContain(n.replace(',', '.'));
      }),
    );
  });
});

describe('stream parsing', () => {
  it('reads completed option texts from a partial stream', () => {
    expect(partialSayTexts('{"options":[{"text":"Yes, ple')).toEqual([]);
    expect(partialSayTexts('{"options":[{"text":"Yes, please","kind":"answer"},{"text":"No \\"thanks\\""')).toEqual(['Yes, please', 'No "thanks"']);
  });
  it('reads means and ask from a partial stream', () => {
    expect(partialAsk('{"means":"It is torn","ask":"How')).toEqual({ means: 'It is torn', ask: undefined });
  });
});

describe('receipt', () => {
  it('records device steps with zero bytes and no text', () => {
    const r = createReceipt(() => new Date('2026-11-19T10:00:00Z'));
    const s = r.recordDevice({ step: 'say', mode: 'ONLY_ON_DEVICE', ms: 812.4 });
    expect(s).toEqual({ n: 1, at: '2026-11-19T10:00:00.000Z', step: 'say', mode: 'ONLY_ON_DEVICE', where: 'on_device', ms: 812, bytesOut: 0 });
    expect(r.bytesOut).toBe(0);
    expect(JSON.stringify(r.toJSON())).not.toContain('outgoing');
  });
  it('records cloud steps with the exact text, its byte length and SHA-256', async () => {
    const r = createReceipt();
    const s = await r.recordCloud({ step: 'prepare', mode: 'PREFER_IN_CLOUD', ms: 900, where: 'in_cloud', outgoing: 'knee MRI, café' });
    expect(s.bytesOut).toBe(new TextEncoder().encode('knee MRI, café').length);
    expect(s.sha256).toBe(await sha256Hex('knee MRI, café'));
    expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('a cloud-capable step that ran on device sends and stores nothing', async () => {
    const r = createReceipt();
    const s = await r.recordCloud({ step: 'prepare', mode: 'PREFER_IN_CLOUD', ms: 900, where: 'on_device', outgoing: 'x' });
    expect(s.bytesOut).toBe(0);
    expect(s.outgoing).toBeUndefined();
  });
});

describe('stats', () => {
  it('computes median, percentile and words per minute, ignoring hold-the-floor', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    const s = computeStats([
      { askedAt: 0, answeredAt: 2000, text: 'An iced latte please', via: 'option' },
      { askedAt: 10_000, answeredAt: 11_000, text: 'Yes', via: 'quick' },
      { askedAt: 20_000, answeredAt: 20_100, text: 'Hold on, please.', via: 'hold' },
    ]);
    expect(s.answers).toBe(2);
    expect(s.words).toBe(5);
    expect(s.wpm).toBe(100); // 5 words in 3 seconds of composing
  });
});

describe('compact Say lines format', async () => {
  const { parseSayLines } = await import('../src/core/prompts/say-lines');
  it('parses complete lines and ignores a line still being written', () => {
    expect(parseSayLines('A: To go, please\nB: For here, thanks\nQ: Is there a seat?')).toEqual([
      { text: 'To go, please', kind: 'answer' },
      { text: 'For here, thanks', kind: 'alternative' },
      { text: 'Is there a seat?', kind: 'question' },
    ]);
    expect(parseSayLines('A: To go, please\nB: For he', false)).toEqual([{ text: 'To go, please', kind: 'answer' }]);
    expect(parseSayLines('1. A: Yes\n2) Q: Why?')).toEqual([{ text: 'Yes', kind: 'answer' }, { text: 'Why?', kind: 'question' }]);
  });
});
