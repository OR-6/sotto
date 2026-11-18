// Screens 3 to 5: the conversation. User side (Say or Ask) and partner side.
import type { Live, LiveEvent } from '../ai/live';
import { composeRepeat } from '../core/compose';
import { parseJson } from '../core/filter';
import { completeInstruction, type SayOption } from '../core/prompts/say';
import type { AskResult } from '../core/prompts/ask';
import { lastPartner } from '../core/turns';
import { packById } from '../core/packs/packs';
import { listen, type Listener } from '../speech/recognise';
import { speak, stopSpeaking } from '../speech/speak';
import { announce, formatBytes, h, setText } from './dom';
import { state, saveSettings } from './state';
import { createScanner } from './scan';
import { openSettings } from './settings';

export type SessionDeps = {
  live: Live;
  /** On-device helpers (Private mode only). Undefined in Cloud live mode. */
  helpers?: {
    complete(prompt: string, signal: AbortSignal): Promise<string>;
    repeat(prompt: string, signal: AbortSignal): Promise<string>;
  };
  phrases: string[];
  onEnd(): void;
  openReceipt(): void;
};

const KIND_LABEL: Record<SayOption['kind'], string> = { answer: 'Answer', alternative: 'Another way', question: 'Ask back' };
const HOLD_LINE = "One moment, I'm typing.";

export type SessionView = { el: HTMLElement; dispose(): void; refreshReceipt(): void };

export function renderSession(deps: SessionDeps): SessionView {
  const { live } = deps;
  live.mode = state.mode;
  let listener: Listener | null = null;
  let wantListening = state.speech === 'available';
  let askedAt = 0;
  let disposed = false;

  // ---------- partner side ----------
  const partnerNotice = h('p', { class: `partner-notice${state.cloudLive ? ' cloud' : ''}`, id: 'partner-notice' });
  const partnerSaid = h('p', { class: 'partner-said empty', id: 'partner-said', 'aria-live': 'off' }, 'Sotto will show what I say here.');
  const partnerTyping = h('p', { class: 'partner-typing', id: 'partner-typing' });
  const partnerInput = h('textarea', { id: 'partner-input', placeholder: 'Type here to talk to me', 'aria-label': 'Type a message to the Sotto user', maxlength: 600 });
  const partnerSend = h('button', { class: 'btn primary', id: 'partner-send' }, 'Send');
  const flipBtn = h('button', { class: 'btn small', id: 'flip', 'aria-pressed': String(state.settings.flipPartner) }, 'Turn to them');
  const partnerSide = h(
    'aside',
    { class: `partner-side${state.settings.flipPartner ? ' flipped' : ''}`, 'aria-label': 'For the other person', id: 'partner-side' },
    h('div', { class: 'partner-head' }, h('h2', {}, 'For the other person'), flipBtn),
    partnerNotice,
    partnerSaid,
    partnerTyping,
    h('form', { class: 'partner-form', id: 'partner-form' }, partnerInput, partnerSend),
  );
  const setNotice = () =>
    setText(
      partnerNotice,
      state.cloudLive
        ? 'Cloud live mode is on. What is said here is sent to Google\'s Gemini.'
        : listener?.listening
          ? 'Sotto is listening on this device only. You can also type here.'
          : 'Sotto is not listening right now. You can type here.',
    );
  partnerSide.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = partnerInput.value.trim();
    if (!text) return;
    partnerInput.value = '';
    live.partner(text, 'typed');
  });
  partnerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      partnerSide.querySelector('form')!.requestSubmit();
    }
  });
  flipBtn.addEventListener('click', () => {
    const on = !partnerSide.classList.contains('flipped');
    partnerSide.classList.toggle('flipped', on);
    flipBtn.setAttribute('aria-pressed', String(on));
    flipBtn.textContent = on ? 'Turn back' : 'Turn to them';
    saveSettings({ flipPartner: on });
  });

  // ---------- user side: top bar ----------
  const modeBtn = (m: 'say' | 'ask', label: string) => {
    const b = h('button', { 'aria-pressed': String(state.mode === m), id: `switch-${m}` }, label);
    b.addEventListener('click', () => setMode(m));
    return b;
  };
  const sayBtn = modeBtn('say', 'Say');
  const askBtn = modeBtn('ask', 'Ask');
  const pulse = h('span', { class: 'pulse', 'aria-hidden': 'true' });
  const listenLabel = h('span', {}, 'Not listening');
  const listenBtn = h('button', { class: 'btn small', id: 'listen' }, 'Listen');
  const receiptBtn = h('button', { class: 'btn small', id: 'open-receipt' }, 'Receipt');
  const scanBtn = h('button', { class: 'btn small', id: 'scan-toggle', 'aria-pressed': 'false', title: 'Switch scanning: or hold Space for one second' }, 'Scan');
  const endBtn = h('button', { class: 'btn small', id: 'end' }, 'End');
  const settingsBtn = h('button', { class: 'btn small', id: 'session-settings', 'aria-label': 'Settings' }, 'Settings');
  settingsBtn.addEventListener('click', () => void openSettings(() => {
    scanner.setRate(state.settings.scanRateMs);
    live.chips.tone = state.settings.tone;
    live.chips.joke = state.settings.joke;
  }));
  const where = h('span', { class: `where${state.cloudLive ? ' cloud' : ''}`, id: 'where' }, state.cloudLive ? 'Cloud live mode' : 'Private mode');
  where.title = state.cloudLive ? 'Live lines may be sent to the cloud this session' : 'Live help runs on this device; nothing said here is sent';
  const situation = state.situationText || packById(state.pack)?.label || 'Conversation';
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('h1', { class: 'brand' }, 'Sotto'),
    h('span', { class: 'mode-switch', role: 'group', 'aria-label': 'Mode' }, sayBtn, askBtn),
    h('span', { class: 'where situation muted', title: 'Situation' }, situation),
    where,
    state.useBrief && state.brief ? h('span', { class: 'where situation', id: 'brief-on', title: 'The brief you prepared shapes the suggestions' }, 'Brief on') : null,
    h('span', { class: 'spacer' }),
    state.speech === 'available' ? h('span', { class: 'listen-state', role: 'status' }, pulse, listenLabel) : null,
    state.speech === 'available' ? listenBtn : null,
    scanBtn,
    settingsBtn,
    receiptBtn,
    endBtn,
  );
  receiptBtn.addEventListener('click', deps.openReceipt);
  endBtn.addEventListener('click', () => {
    stopListening();
    stopSpeaking();
    deps.onEnd();
  });
  listenBtn.addEventListener('click', () => (listener?.listening ? (wantListening = false, stopListening()) : ((wantListening = true), startListening())));

  // ---------- transcript strip ----------
  const prevLine = h('p', { class: 'prev', id: 'prev-line' });
  const lastLine = h('p', { class: 'last', id: 'last-line' });
  const interim = h('p', { class: 'interim', id: 'interim', 'aria-hidden': 'true' });
  const strip = h('section', { class: 'strip', 'aria-label': 'What was just said' }, prevLine, lastLine, interim);
  const renderStrip = () => {
    const ps = live.turns.filter((t) => t.who === 'P');
    const last = ps.at(-1);
    const prev = ps.at(-2);
    prevLine.replaceChildren(...(prev ? [h('span', { class: 'who' }, 'They said'), prev.text] : []));
    lastLine.replaceChildren(...(last ? [h('span', { class: 'who' }, 'They said'), last.text] : [h('span', { class: 'muted' }, state.speech === 'available' ? 'Waiting for them to speak, or type on their side.' : 'They can type on their side of the screen.')]));
  };

  // ---------- Say ----------
  const optionsEl = h('div', { class: 'options', id: 'options', role: 'group', 'aria-label': 'Things to say' });
  const optionBtns = [0, 1, 2].map((i) => {
    const b = h('button', { class: 'option skeleton', 'data-i': String(i), id: `option-${i + 1}`, disabled: true }, h('span', { class: 'key', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'kind' }), h('span', { class: 'text' }));
    b.addEventListener('click', () => {
      const t = b.querySelector('.text')!.textContent ?? '';
      if (t) say(t, 'option');
    });
    optionsEl.append(b);
    return b;
  });
  let hovering = false;
  let queued: { texts: string[]; kinds: (SayOption['kind'] | '')[]; final: boolean } | null = null;
  const holdsFocus = () => hovering || optionsEl.contains(document.activeElement);
  optionsEl.addEventListener('pointerenter', () => (hovering = true));
  optionsEl.addEventListener('pointerleave', () => ((hovering = false), flushQueue()));
  optionsEl.addEventListener('focusout', () => window.setTimeout(flushQueue, 0));
  function flushQueue() {
    if (queued && !holdsFocus()) {
      const q = queued;
      queued = null;
      paintOptions(q.texts, q.kinds, q.final);
    }
  }
  /** The stability rule: never change an option under the pointer or focus; queue it instead. */
  function showOptions(texts: string[], kinds: (SayOption['kind'] | '')[], final: boolean) {
    if (holdsFocus() && optionBtns.some((b) => !b.classList.contains('skeleton'))) {
      queued = { texts, kinds, final };
      return;
    }
    paintOptions(texts, kinds, final);
  }
  function paintOptions(texts: string[], kinds: (SayOption['kind'] | '')[], final: boolean) {
    optionBtns.forEach((b, i) => {
      const t = texts[i] ?? '';
      const textEl = b.querySelector('.text')!;
      const changed = textEl.textContent !== t;
      setText(textEl, t);
      setText(b.querySelector('.kind'), t ? KIND_LABEL[(kinds[i] || (['answer', 'alternative', 'question'] as const)[i]) as SayOption['kind']] : '');
      b.classList.toggle('skeleton', !t);
      b.classList.remove('said');
      b.disabled = !t;
      b.setAttribute('aria-label', t ? `${i + 1}: ${t}` : 'Thinking');
      if (changed && t) {
        b.classList.remove('fresh');
        void b.offsetWidth;
        b.classList.add('fresh');
      }
    });
    if (final) announce('Three things to say are ready.');
  }
  function skeleton() {
    if (holdsFocus() && optionBtns.some((b) => !b.classList.contains('skeleton'))) return; // keep what is under the finger
    paintOptions([], [], false);
  }

  const steerInput = h('input', { class: 'text-input', id: 'steer', placeholder: 'One word to steer', maxlength: 60, autocomplete: 'off', 'aria-label': 'One or two words to steer the suggestions' });
  const steerGo = h('button', { class: 'btn small', id: 'steer-go' }, 'Steer');
  const sendTyped = h('button', { class: 'btn small', id: 'say-typed', title: 'Say exactly what I typed' }, 'Speak');
  const completions = h('div', { class: 'row completions', id: 'completions', role: 'group', 'aria-label': 'Ways to finish what you typed' });
  const steer = h('div', { class: 'steer' }, h('div', { class: 'row' }, steerInput, steerGo, sendTyped), completions);
  steerGo.addEventListener('click', () => doSteer());
  sendTyped.addEventListener('click', () => {
    const t = steerInput.value.trim();
    if (t) {
      steerInput.value = '';
      completions.replaceChildren();
      say(t, 'typed');
    }
  });
  steerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doSteer();
    }
  });
  function doSteer() {
    const w = steerInput.value.trim();
    if (!w) return;
    live.steer(w);
  }
  let completeTimer = 0;
  let completeAbort: AbortController | null = null;
  steerInput.addEventListener('input', () => {
    setText(partnerTyping, steerInput.value ? 'They are typing a reply.' : '');
    window.clearTimeout(completeTimer);
    completeAbort?.abort();
    const typed = steerInput.value;
    if (!deps.helpers || typed.trim().split(/\s+/).length < 2) return completions.replaceChildren();
    completeTimer = window.setTimeout(async () => {
      const ac = new AbortController();
      completeAbort = ac;
      try {
        const last = lastPartner(live.turns)?.text ?? '';
        const raw = await deps.helpers!.complete(completeInstruction(last, typed), ac.signal);
        if (ac.signal.aborted || steerInput.value !== typed) return;
        const list = ((parseJson(raw) as { completions?: unknown })?.completions ?? []) as unknown[];
        const good = list.map((x) => String(x).trim()).filter((x) => x.toLowerCase().startsWith(typed.trim().toLowerCase()) && x.split(/\s+/).length <= 12).slice(0, 3);
        completions.replaceChildren(...good.map((g) => h('button', { class: 'chip', onclick: () => ((steerInput.value = ''), completions.replaceChildren(), say(g, 'typed')) }, g)));
      } catch {
        /* superseded or unavailable: no completions */
      }
    }, 250);
  });

  const holdBtn = h('button', { class: 'chip hold', id: 'hold' }, 'Hold on');
  holdBtn.addEventListener('click', hold);
  const quick = h('div', { class: 'quick', id: 'quick', role: 'group', 'aria-label': 'Quick phrases' }, holdBtn, ...deps.phrases.filter((p) => !/hold on/i.test(p)).map((p) => h('button', { class: 'chip', onclick: () => say(p, 'quick') }, p)));

  const errorLine = h('p', { class: 'note-line', id: 'live-note', role: 'status' });
  const sayPanel = h('section', { id: 'say-panel', 'aria-label': 'Say' }, optionsEl, steer);

  // ---------- Ask ----------
  const askLast = h('p', { class: 'ask-last', id: 'ask-last' });
  const meansBody = h('p', { class: 'body', id: 'means' });
  const askBody = h('p', { class: 'body', id: 'ask' });
  const meansCard = h('div', { class: 'ask-card means skeleton' }, h('span', { class: 'label' }, 'Means'), meansBody);
  const askCard = h('div', { class: 'ask-card ask skeleton' }, h('span', { class: 'label' }, 'Ask'), askBody);
  const flagEl = h('div', { class: 'flag', id: 'flag', hidden: true });
  const sayQuestion = h('button', { class: 'btn small', id: 'say-question', disabled: true }, 'Say this question');
  const repeatBtn = h('button', { class: 'btn small', id: 'repeat', disabled: true }, 'Repeat it back');
  const repeatLine = h('p', { class: 'note-line', id: 'repeat-line' });
  const decisionsList = h('ol', { id: 'decisions-list' });
  const decisionsCount = h('span', {}, 'Decisions and deadlines (0)');
  const decisions = h('details', { class: 'decisions', id: 'decisions' }, h('summary', {}, decisionsCount), decisionsList);
  const askPanel = h('section', { id: 'ask-panel', 'aria-label': 'Ask', hidden: true }, askLast, meansCard, askCard, flagEl, h('div', { class: 'row' }, sayQuestion, repeatBtn), repeatLine, decisions);
  const flags: { kind: string; quote: string }[] = [];
  sayQuestion.addEventListener('click', () => askBody.textContent && say(askBody.textContent, 'option'));
  repeatBtn.addEventListener('click', async () => {
    if (!deps.helpers) return;
    repeatBtn.disabled = true;
    setText(repeatLine, 'Writing it…');
    try {
      const raw = await deps.helpers.repeat(composeRepeat({ ...live.chips, turns: live.turns, budgetChars: state.config.maxContextTokens * 3 }), new AbortController().signal);
      const line = String((parseJson(raw) as { line?: unknown })?.line ?? '').trim();
      repeatLine.replaceChildren(...(line ? [line, ' ', h('button', { class: 'btn small', onclick: () => say(line, 'option') }, 'Say it')] : ['No sentence this time.']));
    } catch {
      setText(repeatLine, 'Could not write it this time.');
    } finally {
      repeatBtn.disabled = false;
    }
  });
  function showAsk(r: Partial<AskResult>, final: boolean) {
    setText(meansBody, r.means ?? '');
    setText(askBody, r.ask ?? '');
    meansCard.classList.toggle('skeleton', !r.means);
    askCard.classList.toggle('skeleton', !r.ask);
    sayQuestion.disabled = !r.ask;
    repeatBtn.disabled = !final || !deps.helpers;
    if (final && r.flag && r.flag.kind !== 'none') {
      flagEl.hidden = false;
      flagEl.replaceChildren(h('span', {}, `Flagged: ${r.flag.kind}`), h('q', {}, r.flag.quote));
      if (!flags.some((f) => f.quote === r.flag!.quote)) {
        flags.push(r.flag);
        decisionsList.append(h('li', {}, h('strong', {}, `${r.flag.kind}: `), h('q', {}, r.flag.quote)));
        setText(decisionsCount, `Decisions and deadlines (${flags.length})`);
      }
    } else if (!final) flagEl.hidden = true;
    if (final) announce(r.means ? `Means: ${r.means}` : 'Ready.');
  }

  const userSide = h('section', { class: 'user-side', 'aria-label': 'For me' }, topbar, strip, sayPanel, askPanel, errorLine, h('div', { style: 'flex:1' }), quick, h('p', { class: 'note-line' }, 'Sotto restates and asks. It does not advise.'));
  const el = h('main', { class: 'session', id: 'main' }, userSide, partnerSide);

  // ---------- behaviour ----------
  function setMode(m: 'say' | 'ask') {
    state.mode = m;
    live.mode = m;
    sayBtn.setAttribute('aria-pressed', String(m === 'say'));
    askBtn.setAttribute('aria-pressed', String(m === 'ask'));
    sayPanel.hidden = m !== 'say';
    prevLine.hidden = lastLine.hidden = m === 'ask'; // Ask shows the line itself, larger
    askPanel.hidden = m !== 'ask';
    if (lastPartner(live.turns)) live.refresh();
  }

  function say(text: string, via: 'option' | 'quick' | 'typed') {
    live.user(text, 'tap');
    state.answers.push({ askedAt: askedAt || Date.now(), answeredAt: Date.now(), text, via });
    partnerSaid.classList.remove('empty');
    setText(partnerSaid, text);
    setText(partnerTyping, '');
    optionBtns.forEach((b) => b.classList.toggle('said', b.querySelector('.text')?.textContent === text));
    speakOut(text);
  }
  function hold() {
    state.answers.push({ askedAt: askedAt || Date.now(), answeredAt: Date.now(), text: HOLD_LINE, via: 'hold' });
    partnerSaid.classList.remove('empty');
    setText(partnerSaid, HOLD_LINE);
    setText(partnerTyping, 'Please wait: a reply is coming.');
    speakOut(HOLD_LINE);
  }
  /** Speaks a line. Listening pauses while Sotto speaks, so it never transcribes its own voice. */
  function speakOut(text: string) {
    const resume = listener?.listening;
    if (resume) stopListening();
    const ok = speak(text, { voiceName: state.settings.voiceName, rate: state.settings.rate, onEnd: () => resume && wantListening && !disposed && startListening() });
    if (!ok && resume) startListening();
  }

  function startListening() {
    if (state.speech !== 'available' || listener?.listening) return;
    try {
      const pack = state.pack;
      listener = listen(
        {
          onInterim: (t) => setText(interim, t),
          onFinal: (t) => {
            setText(interim, '');
            if (t) live.partner(t, 'speech');
          },
          onError: (code) => setText(errorLine, code === 'not-allowed' ? 'The microphone is blocked for this page. The other person can type instead.' : `Listening stopped (${code}). Press Listen to try again.`),
          onState: (on) => {
            pulse.classList.toggle('on', on);
            setText(listenLabel, on ? 'Listening on this device' : 'Not listening');
            setText(listenBtn, on ? 'Stop listening' : 'Listen');
            setNotice();
          },
        },
        { lang: 'en-US', phrases: packVocab(pack) },
      );
    } catch (e) {
      setText(errorLine, (e as Error).message);
    }
  }
  function stopListening() {
    listener?.stop();
    listener = null;
    pulse.classList.remove('on');
    setText(listenLabel, 'Not listening');
    setText(listenBtn, 'Listen');
    setNotice();
  }

  const off = live.on((e: LiveEvent) => {
    if (disposed) return;
    switch (e.type) {
      case 'turn':
        if (e.turn.who === 'P') {
          askedAt = e.turn.at;
          renderStrip();
          setText(askLast, e.turn.text);
          setText(errorLine, '');
          setText(repeatLine, '');
        }
        break;
      case 'thinking':
        if (e.mode === 'say') skeleton();
        else showAsk({}, false);
        break;
      case 'say-partial':
        showOptions(e.texts, [], false);
        break;
      case 'say':
        showOptions(
          e.options.map((o) => o.text),
          e.options.map((o) => o.kind),
          true,
        );
        break;
      case 'ask-partial':
        showAsk({ means: e.means, ask: e.ask }, false);
        break;
      case 'ask':
        showAsk(e.result, true);
        break;
      case 'error':
        setText(errorLine, `No suggestions for that line (${e.message.slice(0, 80)}). The quick phrases still work.`);
        if (e.mode === 'say') paintOptions([], [], false);
        break;
    }
    refreshReceipt();
  });

  function refreshReceipt() {
    setText(receiptBtn, `Receipt · ${formatBytes(state.receipt.bytesOut)} sent`);
  }

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (document.querySelector('dialog[open]')) return;
    if (state.mode === 'say' && ['1', '2', '3'].includes(e.key)) {
      const b = optionBtns[Number(e.key) - 1];
      if (!b.disabled) {
        e.preventDefault();
        b.click();
      }
    } else if (e.key === 'h' || e.key === 'H') {
      e.preventDefault();
      hold();
    } else if (e.key === '/') {
      e.preventDefault();
      steerInput.focus();
    }
  };
  document.addEventListener('keydown', onKey);

  const scanner = createScanner({
    rateMs: state.settings.scanRateMs,
    items: () => [
      ...(state.mode === 'say' ? optionBtns : [sayQuestion, repeatBtn]),
      holdBtn,
      ...Array.from(quick.querySelectorAll<HTMLElement>('button')).filter((b) => b !== holdBtn),
      flipBtn,
      endBtn,
    ],
    announce: (label) => announce(label),
    onChange: (on) => {
      scanBtn.setAttribute('aria-pressed', String(on));
      setText(scanBtn, on ? 'Scanning' : 'Scan');
      if (on !== state.settings.scan) saveSettings({ scan: on });
    },
  });
  scanBtn.addEventListener('click', () => scanner.toggle());
  if (state.settings.scan) scanner.start();

  setMode(state.mode);
  renderStrip();
  refreshReceipt();
  setNotice();
  if (wantListening) startListening();

  return {
    el,
    refreshReceipt,
    dispose() {
      disposed = true;
      off();
      stopListening();
      stopSpeaking();
      document.removeEventListener('keydown', onKey);
      scanner.dispose();
    },
  };
}

function packVocab(id: string): string[] {
  return packById(id)?.vocab ?? [];
}
