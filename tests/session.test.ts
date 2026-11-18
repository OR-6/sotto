// @vitest-environment jsdom
// The conversation screen in jsdom, driven by the real live engine with a scripted backend.
import { beforeEach, describe, expect, it } from 'vitest';
import { createLive, type StreamFn } from '../src/ai/live';
import { createReceipt } from '../src/core/receipt';

const SAY = (a: string) => JSON.stringify({ options: [{ text: a, kind: 'answer' }, { text: 'No, thank you', kind: 'alternative' }, { text: 'What else is there?', kind: 'question' }] });

function backend(reply: (p: string) => string, ms = 20): StreamFn {
  return async (prompt, onText, signal) => {
    await new Promise<void>((res, rej) => {
      const t = setTimeout(res, ms);
      signal.addEventListener('abort', () => (clearTimeout(t), rej(new DOMException('a', 'AbortError'))));
    });
    const full = reply(prompt);
    onText(full);
    return { text: full, ms, source: 'on_device' };
  };
}

async function mount() {
  const { renderSession } = await import('../src/ui/session');
  const { state } = await import('../src/ui/state');
  state.speech = 'missing';
  state.mode = 'say';
  const receipt = createReceipt();
  const live = createLive({ backend: { mode: 'ONLY_ON_DEVICE', say: backend((p) => SAY(p.includes('Oat') ? 'Oat is fine' : 'A tea, please')), ask: backend(() => '{}') }, receipt, budgetChars: 3000 });
  let ended = 0;
  const view = renderSession({ live, phrases: ['Yes', 'No'], suggestions: true, onEnd: () => ended++, openReceipt: () => undefined });
  document.body.replaceChildren(view.el);
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const text = (i: number) => document.querySelector(`#option-${i} .text`)?.textContent;
  return { view, live, state, settle, text, ended: () => ended };
}

beforeEach(() => {
  document.body.innerHTML = '';
  (globalThis as { speechSynthesis?: unknown }).speechSynthesis = undefined;
});

describe('conversation screen', () => {
  it('a typed partner line gives three tappable options; the partner box is left so keys work', async () => {
    const { settle, text } = await mount();
    const input = document.getElementById('partner-input') as HTMLTextAreaElement;
    input.focus();
    input.value = 'What can I get you?';
    (document.getElementById('partner-form') as HTMLFormElement).requestSubmit();
    expect(document.activeElement).not.toBe(input);
    await settle();
    expect(text(1)).toBe('A tea, please');
    expect((document.getElementById('option-1') as HTMLButtonElement).disabled).toBe(false);
  });

  it('key 1 says option 1; Ctrl+1 and a held key do nothing', async () => {
    const { live, settle } = await mount();
    live.partner('What can I get you?');
    await settle();
    const said = () => document.getElementById('partner-said')!.textContent;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', ctrlKey: true, bubbles: true }));
    expect(said()).not.toBe('A tea, please');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', repeat: true, bubbles: true }));
    expect(said()).not.toBe('A tea, please');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true }));
    expect(said()).toBe('A tea, please');
    expect(live.turns.at(-1)).toMatchObject({ who: 'Y', text: 'A tea, please' });
  });

  it('a new line dims the old options instead of blanking them, then replaces them', async () => {
    const { live, settle, text } = await mount();
    live.partner('What can I get you?');
    await settle();
    live.partner('Oat milk okay?');
    expect(document.getElementById('options')!.classList.contains('stale')).toBe(true);
    expect(text(1)).toBe('A tea, please'); // still there, still usable
    await settle();
    expect(text(1)).toBe('Oat is fine');
    expect(document.getElementById('options')!.classList.contains('stale')).toBe(false);
  });

  it('Hold on speaks the hold line and tells the partner a reply is coming', async () => {
    await mount();
    (document.getElementById('hold') as HTMLButtonElement).click();
    expect(document.getElementById('partner-said')!.textContent).toBe('Hold on, please.');
    expect(document.getElementById('partner-typing')!.textContent).toMatch(/reply is coming/i);
  });

  it('leaving the screen does not switch scanning off in the settings', async () => {
    const { view, state } = await mount();
    (document.getElementById('scan-toggle') as HTMLButtonElement).click();
    expect(state.settings.scan).toBe(true);
    view.dispose();
    expect(state.settings.scan).toBe(true);
    state.settings.scan = false;
  });

  it('nothing in Private mode is counted as sent', async () => {
    const { live, settle } = await mount();
    live.partner('What can I get you?');
    await settle();
    expect(document.getElementById('open-receipt')!.textContent).toContain('nothing sent');
  });
});
