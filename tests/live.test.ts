import { describe, expect, it } from 'vitest';
import { createLive, type LiveBackend, type LiveEvent, type StreamFn } from '../src/ai/live';
import { createReceipt } from '../src/core/receipt';

const SAY = (a: string) => JSON.stringify({ options: [{ text: a, kind: 'answer' }, { text: 'No, thank you', kind: 'alternative' }, { text: 'What do you suggest?', kind: 'question' }] });

/** A fake stream: replies after `ms`, in two chunks, honouring the abort signal. */
function fakeStream(reply: (prompt: string) => string, ms = 30): StreamFn & { prompts: string[] } {
  const prompts: string[] = [];
  const fn = (async (prompt, onText, signal) => {
    prompts.push(prompt);
    const full = reply(prompt);
    const half = full.slice(0, Math.ceil(full.length / 2));
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('aborted', 'AbortError'))), { once: true });
    });
    onText(half);
    onText(full);
    return { text: full, ms, source: 'on_device' };
  }) as StreamFn & { prompts: string[] };
  fn.prompts = prompts;
  return fn;
}

function setup(backend?: Partial<LiveBackend>) {
  const say = fakeStream((p) => SAY(p.includes('Oat milk') ? 'Oat is fine' : 'A coffee, please'));
  const ask = fakeStream(() => JSON.stringify({ means: 'They found a small tear.', ask: 'What happens next?', flag: { kind: 'none', quote: '' } }));
  const receipt = createReceipt();
  const live = createLive({ backend: { mode: 'ONLY_ON_DEVICE', say, ask, ...backend }, receipt, budgetChars: 3000 });
  const events: LiveEvent[] = [];
  live.on((e) => events.push(e));
  const until = (pred: (e: LiveEvent) => boolean) =>
    new Promise<LiveEvent>((resolve) => {
      const found = events.find(pred);
      if (found) return resolve(found);
      const off = live.on((e) => pred(e) && (off(), resolve(e)));
    });
  return { live, events, receipt, say, ask, until };
}

describe('live loop', () => {
  it('a partner turn produces three Say options and a zero-byte device receipt step', async () => {
    const { live, receipt, until } = setup();
    live.chips.situation = 'Café';
    live.partner('What can I get you?');
    const e = (await until((x) => x.type === 'say')) as Extract<LiveEvent, { type: 'say' }>;
    expect(e.options.map((o) => o.text)).toEqual(['A coffee, please', 'No, thank you', 'What do you suggest?']);
    expect(receipt.steps).toHaveLength(1);
    expect(receipt.steps[0]).toMatchObject({ step: 'say', where: 'on_device', bytesOut: 0 });
  });

  it('emits the first option before the call finishes (streaming)', async () => {
    const { live, events, until } = setup();
    live.partner('What can I get you?');
    await until((x) => x.type === 'say');
    const iPartial = events.findIndex((x) => x.type === 'say-partial');
    const iFinal = events.findIndex((x) => x.type === 'say');
    expect(iPartial).toBeGreaterThan(-1);
    expect(iPartial).toBeLessThan(iFinal);
  });

  it('a newer turn cancels the stale call; only the newest result is shown', async () => {
    const { live, events, until } = setup();
    live.partner('What can I get you?');
    live.partner('Oat milk okay?');
    const e = (await until((x) => x.type === 'say')) as Extract<LiveEvent, { type: 'say' }>;
    await new Promise((r) => setTimeout(r, 60));
    const finals = events.filter((x) => x.type === 'say') as Extract<LiveEvent, { type: 'say' }>[];
    expect(finals).toHaveLength(1);
    expect(e.options[0].text).toBe('Oat is fine');
    expect(events.some((x) => x.type === 'error')).toBe(false);
  });

  it('a steer word re-runs Say with the steer in the prompt', async () => {
    const { live, say, until } = setup();
    live.partner('What can I get you?');
    await until((x) => x.type === 'say');
    live.steer('cold');
    await new Promise((r) => setTimeout(r, 60));
    expect(say.prompts.at(-1)).toContain('Steer: cold');
  });

  it('user lines become Y turns and do not start a call', async () => {
    const { live, say } = setup();
    live.user('Hello');
    expect(live.turns[0]).toMatchObject({ who: 'Y', text: 'Hello' });
    expect(say.prompts).toHaveLength(0);
  });

  it('Ask mode produces Means and Ask', async () => {
    const { live, until } = setup();
    live.mode = 'ask';
    live.partner('The MRI shows a partial tear.');
    const e = (await until((x) => x.type === 'ask')) as Extract<LiveEvent, { type: 'ask' }>;
    expect(e.result).toEqual({ means: 'They found a small tear.', ask: 'What happens next?', flag: { kind: 'none', quote: '' } });
  });

  it('a failing backend reports an error and records a failed device step', async () => {
    const boom: StreamFn = async () => {
      throw new Error('The on-device model is busy.');
    };
    const { live, receipt, until } = setup({ say: boom });
    live.partner('Hi');
    const e = await until((x) => x.type === 'error');
    expect(e).toMatchObject({ type: 'error', message: 'The on-device model is busy.' });
    expect(receipt.steps.at(-1)).toMatchObject({ where: 'failed', bytesOut: 0 });
  });

  it('merges speech that resumes within 1.5 s into the same partner turn', async () => {
    const { live, say, until } = setup();
    live.partner('What can I', 'speech');
    live.partner('get you today?', 'speech');
    await until((x) => x.type === 'say');
    expect(live.turns).toHaveLength(1);
    expect(live.turns[0].text).toBe('What can I get you today?');
    expect(say.prompts.at(-1)).toContain('P: What can I get you today?');
  });

  it('typed lines are never merged', () => {
    const { live } = setup();
    live.partner('One', 'typed');
    live.partner('Two', 'typed');
    expect(live.turns).toHaveLength(2);
  });

  it('ignores empty input', () => {
    const { live } = setup();
    expect(live.partner('   ')).toBeUndefined();
    expect(live.turns).toHaveLength(0);
  });
});
