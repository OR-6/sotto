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
import { state, saveSettings, savePhrases } from './state';
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
  /** False when this browser has no model and Cloud live mode is off: phrases and typing only. */
  suggestions: boolean;
  onEnd(): void;
  openReceipt(): void;
};

const KIND_LABEL: Record<SayOption['kind'], string> = { answer: 'Answer', alternative: 'Another way', question: 'Question' };
const HOLD_LINE = 'Hold on, please.';
const FLAG_LABEL: Record<string, string> = { deadline: 'Deadline', cost: 'Cost', consent: 'Consent asked', decision: 'Decision', risk: 'Risk' };
const MIC_ERRORS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked for this page. They can type on their side instead.',
  'service-not-allowed': 'This browser will not listen on the device here. They can type on their side instead.',
  'language-not-supported': 'On-device listening is not available for English here. They can type instead.',
  'audio-capture': 'No microphone was found. They can type on their side instead.',
  'restarting-too-often': 'Listening keeps stopping. Press Listen to try again, or let them type.',
};

export type SessionView = { el: HTMLElement; dispose(): void; refreshReceipt(): void };

export function renderSession(deps: SessionDeps): SessionView {
  const { live } = deps;
  live.mode = state.mode;
  let listener: Listener | null = null;
  /** Set from the recogniser's own state callback (it fires before listen() returns). */
  let listeningNow = false;
  let wantListening = state.speech === 'available';
  let askedAt = 0;
  let disposed = false;

  // ---------- partner side ----------
  const partnerNotice = h('p', { class: `partner-notice${state.cloudLive ? ' cloud' : ''}`, id: 'partner-notice' });
  const partnerSaid = h('p', { class: 'partner-said empty', id: 'partner-said', 'aria-live': 'off' }, 'Sotto will show what I say here.');
  const partnerTyping = h('p', { class: 'partner-typing', id: 'partner-typing' });
  let lastSpoken = '';
  const history = h('ol', { class: 'partner-history', id: 'partner-history', 'aria-label': 'What I said before' });
  const againBtn = h('button', { class: 'btn small', id: 'say-again', disabled: true }, 'Say again');
  const stopBtn = h('button', { class: 'btn small', id: 'stop-speaking', disabled: true }, 'Stop');
  againBtn.addEventListener('click', () => lastSpoken && speakOut(lastSpoken));
  const keepBtn = h('button', { class: 'btn small', id: 'keep-phrase', disabled: true }, 'Keep as a phrase');
  keepBtn.addEventListener('click', () => {
    const p = lastSpoken;
    if (!p || state.phrases.includes(p)) return;
    savePhrases([...state.phrases, p].slice(-24));
    quick.append(h('button', { class: 'chip', onclick: () => say(p, 'quick') }, p));
    keepBtn.disabled = true;
    announce('Kept as a quick phrase.');
  });
  stopBtn.addEventListener('click', () => stopSpeaking());
  const partnerInput = h('textarea', { id: 'partner-input', placeholder: 'Type here to talk to me', 'aria-label': 'Type a message to the Sotto user', maxlength: 600 });
  const partnerSend = h('button', { class: 'btn primary', id: 'partner-send' }, 'Send');
  const flipBtn = h('button', { class: 'btn small', id: 'flip', 'aria-pressed': String(state.settings.flipPartner) }, 'Show them');
  const partnerSide = h(
    'aside',
    { class: `partner-side${state.settings.flipPartner ? ' flipped' : ''}`, 'aria-label': 'For the other person', id: 'partner-side' },
    h('div', { class: 'partner-head' }, h('h2', {}, 'For the other person'), flipBtn),
    partnerNotice,
    partnerSaid,
    h('div', { class: 'row' }, againBtn, stopBtn, keepBtn),
    partnerTyping,
    history,
    h('form', { class: 'partner-form', id: 'partner-form' }, partnerInput, partnerSend),
  );
  const setNotice = () =>
    setText(
      partnerNotice,
      state.cloudLive
        ? 'Cloud live mode is on. What is said here is sent to Google\'s Gemini.'
        : listeningNow
          ? 'Sotto is listening on this device only. You can also type here.'
          : 'Sotto is not listening right now. You can type here.',
    );
  partnerSide.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = partnerInput.value.trim();
    if (!text) return;
    partnerInput.value = '';
    partnerInput.blur(); // the next key press belongs to the Sotto user (1, 2, 3, H)
    live.partner(text, 'typed');
  });
  partnerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      partnerSide.querySelector('form')!.requestSubmit();
    }
  });
  const turnTop = h('button', { class: 'btn small phone-only', id: 'turn-top', 'aria-label': 'Show the other person their side' }, 'Show them');
  const setFlip = (on: boolean) => {
    partnerSide.classList.toggle('flipped', on);
    el.classList.toggle('partner-open', on);
    flipBtn.setAttribute('aria-pressed', String(on));
    flipBtn.textContent = on ? 'Back to me' : 'Show them';
    saveSettings({ flipPartner: on });
    if (on && window.matchMedia('(max-width: 899px)').matches) flipBtn.focus();
  };
  flipBtn.addEventListener('click', () => setFlip(!partnerSide.classList.contains('flipped')));
  turnTop.addEventListener('click', () => setFlip(true));

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
  const listenBtn = h('button', { class: 'btn small wide-only', id: 'listen' }, 'Listen');
  const listenMenuBtn = h('button', { class: 'btn small compact-only', id: 'listen-menu' }, 'Listen');
  listenMenuBtn.addEventListener('click', () => listenBtn.click());
  const receiptBtn = h('button', { class: 'btn small', id: 'open-receipt' }, 'Receipt');
  const scanBtn = h('button', { class: 'btn small', id: 'scan-toggle', 'aria-pressed': 'false', title: 'Switch scanning: or hold Space for one second' }, 'Scan');
  const endBtn = h('button', { class: 'btn small wide-only', id: 'end' }, 'End');
  const endMenuBtn = h('button', { class: 'btn small compact-only', id: 'end-menu' }, 'End the conversation');
  const earBtn = h('button', { class: 'btn small', id: 'earpiece', 'aria-pressed': String(state.settings.earpiece), title: 'Ask mode: Means and Ask are read to you. Use earphones.' }, state.settings.earpiece ? 'Reading to me: on' : 'Read Ask to me');
  earBtn.addEventListener('click', () => {
    saveSettings({ earpiece: !state.settings.earpiece });
    earBtn.setAttribute('aria-pressed', String(state.settings.earpiece));
    setText(earBtn, state.settings.earpiece ? 'Reading to me: on' : 'Read Ask to me');
  });
  endMenuBtn.addEventListener('click', () => endBtn.click());
  const settingsBtn = h('button', { class: 'btn small', id: 'session-settings', 'aria-label': 'Settings' }, 'Settings');
  settingsBtn.addEventListener('click', () => void openSettings(() => {
    scanner.setRate(state.settings.scanRateMs);
    live.chips.tone = state.settings.tone;
    live.chips.joke = state.settings.joke;
  }));
  // The privacy pill is the receipt button: where live help runs and what has been sent, one tap away.
  receiptBtn.className = `where-pill${state.cloudLive ? ' cloud' : ''}`;
  receiptBtn.title = state.cloudLive ? 'Every line said here is sent to Google this session. Open the receipt.' : 'Live help runs on this device. Open the receipt.';
  const situation = state.situationText || packById(state.pack)?.label || 'Conversation';
  const more = h(
    'details',
    { class: 'more', id: 'more' },
    h('summary', { class: 'btn small', 'aria-label': 'More' }, 'More'),
    h(
      'div',
      { class: 'more-menu' },
      h('p', { class: 'muted' }, `${situation} · with ${live.chips.partner || 'someone'}${state.useBrief && state.brief ? ' · brief on' : ''}`),
      state.speech === 'available' ? listenMenuBtn : null,
      earBtn,
      scanBtn,
      settingsBtn,
      endMenuBtn,
    ),
  );
  more.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.more-menu button')) more.open = false;
  });
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('h1', { class: 'brand' }, 'Sotto'),
    h('span', { class: 'mode-switch', role: 'group', 'aria-label': 'Mode' }, sayBtn, askBtn),
    receiptBtn,
    h('span', { class: 'spacer' }),
    state.speech === 'available' ? h('span', { class: 'listen-state wide-only', role: 'status' }, pulse, listenLabel) : null,
    state.speech === 'available' ? listenBtn : null,
    turnTop,
    more,
    endBtn,
  );
  receiptBtn.addEventListener('click', deps.openReceipt);
  endBtn.addEventListener('click', () => {
    stopListening();
    stopSpeaking();
    deps.onEnd();
  });
  listenBtn.addEventListener('click', () => (listeningNow ? (wantListening = false, stopListening()) : ((wantListening = true), startListening())));

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
    const b = h('button', { class: 'option skeleton', 'data-i': String(i), id: `option-${i + 1}`, disabled: true, 'aria-label': 'Waiting for their line' }, h('span', { class: 'key', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'kind' }), h('span', { class: 'text' }));
    b.addEventListener('click', () => {
      const t = b.querySelector('.text')!.textContent ?? '';
      if (t) say(t, 'option');
    });
    optionsEl.append(b);
    return b;
  });
  // The stability rule: options do not change under a resting pointer or keyboard/scan focus.
  // A tap ends the hold (the choice is made), and nothing is held for more than 2.5 s.
  let hovering = false;
  let queued: { texts: string[]; kinds: (SayOption['kind'] | '')[]; final: boolean } | null = null;
  let queuedTimer = 0;
  const holdsFocus = () => hovering || !!optionsEl.querySelector(':focus-visible, .scan');
  optionsEl.addEventListener('pointermove', (e) => (hovering = e.pointerType === 'mouse'));
  optionsEl.addEventListener('pointerleave', () => ((hovering = false), flushQueue()));
  optionsEl.addEventListener('focusout', () => window.setTimeout(flushQueue, 0));
  function flushQueue(force = false) {
    if (queued && (force || !holdsFocus())) {
      window.clearTimeout(queuedTimer);
      const q = queued;
      queued = null;
      paintOptions(q.texts, q.kinds, q.final);
    }
  }
  /** The stability rule: never change an option under the pointer or focus; queue it instead. */
  function showOptions(texts: string[], kinds: (SayOption['kind'] | '')[], final: boolean) {
    if (holdsFocus() && optionBtns.some((b) => !b.classList.contains('skeleton'))) {
      queued = { texts, kinds, final };
      window.clearTimeout(queuedTimer);
      queuedTimer = window.setTimeout(() => flushQueue(true), 2500);
      return;
    }
    paintOptions(texts, kinds, final);
  }
  let fillers: boolean[] = [];
  function paintOptions(texts: string[], kinds: (SayOption['kind'] | '')[], final: boolean, keepRest = false) {
    if (final || !keepRest) {
      optionsEl.classList.remove('stale');
      setText(updating, '');
    }
    optionBtns.forEach((b, i) => {
      if (keepRest && !texts[i]) return; // streaming: later slots keep the previous turn's option until replaced
      const t = texts[i] ?? '';
      const textEl = b.querySelector('.text')!;
      const changed = textEl.textContent !== t;
      setText(textEl, t);
      setText(b.querySelector('.kind'), t ? (final && fillers[i] ? 'Quick reply' : KIND_LABEL[(kinds[i] || (['answer', 'alternative', 'question'] as const)[i]) as SayOption['kind']]) : '');
      b.classList.toggle('skeleton', !t);
      b.classList.remove('said');
      b.disabled = !t || !final; // a streamed option is visible at once, tappable once checked
      b.classList.toggle('pending', !!t && !final);
      b.setAttribute('aria-label', t ? `${i + 1}: ${t}` : 'Thinking');
      emptySay.hidden = true;
      if (changed && t) {
        b.classList.remove('fresh');
        void b.offsetWidth;
        b.classList.add('fresh');
      }
    });
    if (final) announce('Three things to say are ready.');
  }
  /** A new line is being answered: the old options stay, dimmed and still usable, until new ones arrive. */
  function skeleton() {
    if (optionBtns.some((b) => !b.classList.contains('skeleton'))) {
      optionsEl.classList.add('stale');
      setText(updating, 'New suggestions coming. These still work.');
    } else paintOptions([], [], false);
  }

  const steerInput = h('input', { class: 'text-input', id: 'steer', placeholder: 'One word to steer, or a sentence to speak', maxlength: 200, autocomplete: 'off', 'aria-label': 'One or two words to steer the suggestions, or a sentence to speak' });
  const steerGo = h('button', { class: 'btn small', id: 'steer-go' }, 'Steer');
  const sendTyped = h('button', { class: 'btn small', id: 'say-typed', title: 'Say exactly what I typed' }, 'Speak');
  const completions = h('div', { class: 'row completions', id: 'completions', role: 'group', 'aria-label': 'Ways to finish what you typed' });
  const steerHint = h('p', { class: 'muted steer-hint', id: 'steer-hint' }, 'Enter: one or two words change the suggestions; a longer line is spoken.');
  steerInput.setAttribute('aria-describedby', 'steer-hint');
  const steer = h('div', { class: 'steer' }, h('div', { class: 'row' }, steerInput, steerGo, sendTyped), steerHint, completions);
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
      // One or two words steer the suggestions; a longer line is what I want to say.
      if (steerInput.value.trim().split(/\s+/).length <= 2) doSteer();
      else sendTyped.click();
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

  const holdBtn = h('button', { class: 'btn hold-btn', id: 'hold', title: 'Says: Hold on, please. (H)' }, 'Hold on');
  holdBtn.addEventListener('click', hold);
  const quick = h('div', { class: 'quick', id: 'quick', role: 'group', 'aria-label': 'Quick phrases' }, ...deps.phrases.filter((p) => !/hold on/i.test(p)).map((p) => h('button', { class: 'chip', onclick: () => say(p, 'quick') }, p)));
  const thumbbar = h('footer', { class: 'thumbbar' }, quick, holdBtn);

  const errorLine = h('p', { class: 'note-line', id: 'live-note', role: 'status' });
  /** Measured, per suggestion: from the end of their line to the suggestions, and where they ran. */
  const timing = h('p', { class: 'timing tabular', id: 'timing' });
  const updating = h('p', { class: 'updating', id: 'updating', 'aria-live': 'off' });
  const emptySay = h(
    'p',
    { class: 'empty-say', id: 'empty-say' },
    !deps.suggestions
      ? 'This browser cannot make suggestions. Type below and press Speak, or use Hold on and the quick phrases at the bottom.'
      : state.speech === 'available'
        ? 'When they speak, three things to say appear here. They can also type on their side.'
        : 'When they type on their side, three things to say appear here.',
    deps.suggestions ? h('br', {}) : null,
    deps.suggestions ? h('span', { class: 'muted' }, 'Hold on and the quick phrases are always at the bottom.') : null,
  );
  // Openers: the user can start a conversation, not only answer one.
  const OPENERS = ['Hello!', 'Excuse me, can I say something?', 'I have a question.', 'I use this to talk. Please give me a moment.'];
  const openers = h('div', { class: 'row openers', id: 'openers', role: 'group', 'aria-label': 'Start the conversation' }, OPENERS.map((o) => h('button', { class: 'chip', onclick: () => say(o, 'quick') }, o)));
  emptySay.append(openers);
  const sayPanel = h('section', { id: 'say-panel', 'aria-label': 'Say' }, emptySay, updating, optionsEl, timing, steer);

  // ---------- Ask ----------
  const askLast = h('p', { class: 'ask-last', id: 'ask-last' });
  const meansBody = h('p', { class: 'body', id: 'means' });
  const askBody = h('p', { class: 'body', id: 'ask' });
  const meansCard = h('div', { class: 'ask-card means skeleton' }, h('span', { class: 'label' }, 'Means'), meansBody);
  const askCard = h('div', { class: 'ask-card ask skeleton' }, h('span', { class: 'label' }, 'Ask'), askBody);
  const flagEl = h('div', { class: 'flag', id: 'flag', hidden: true });
  const sayQuestion = h('button', { class: 'btn primary', id: 'say-question', disabled: true }, 'Say this question');
  const repeatBtn = h('button', { class: 'btn', id: 'repeat', disabled: true }, 'Check I understood');
  const repeatLine = h('div', { class: 'repeat-line', id: 'repeat-line', 'aria-live': 'polite' });
  const decisionsList = h('ol', { id: 'decisions-list' });
  const decisionsCount = h('span', {}, 'Deadlines, costs and decisions (0)');
  const decisions = h('details', { class: 'decisions', id: 'decisions' }, h('summary', {}, decisionsCount), decisionsList);
  const askPanel = h('section', { id: 'ask-panel', 'aria-label': 'Ask', hidden: true }, askLast, meansCard, askCard, flagEl, h('div', { class: 'row' }, sayQuestion, repeatBtn), repeatLine, decisions);
  const flags = state.flags;
  sayQuestion.addEventListener('click', () => askBody.textContent && say(askBody.textContent, 'option'));
  repeatBtn.addEventListener('click', async () => {
    if (!deps.helpers) return;
    repeatBtn.disabled = true;
    const forTurn = lastPartner(live.turns)?.id;
    repeatLine.replaceChildren(h('p', { class: 'muted' }, 'Writing it…'));
    try {
      const raw = await deps.helpers.repeat(composeRepeat({ ...live.chips, turns: live.turns, budgetChars: state.config.maxContextTokens * 3 }), new AbortController().signal);
      if (lastPartner(live.turns)?.id !== forTurn) return repeatLine.replaceChildren(); // a newer line arrived
      const line = String((parseJson(raw) as { line?: unknown })?.line ?? '').trim();
      repeatLine.replaceChildren(...(line ? [h('p', { class: 'body' }, line), h('button', { class: 'btn primary', onclick: () => say(line, 'option') }, 'Say it')] : [h('p', {}, 'No sentence this time.')]));
    } catch {
      repeatLine.replaceChildren(h('p', {}, 'Could not write it this time.'));
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
      flagEl.replaceChildren(h('span', {}, FLAG_LABEL[r.flag.kind] ?? 'Flagged'), h('q', {}, r.flag.quote));
      if (!flags.some((f) => f.quote === r.flag!.quote)) {
        flags.push(r.flag);
        decisionsList.append(h('li', {}, h('strong', {}, `${FLAG_LABEL[r.flag.kind] ?? 'Flagged'}: `), h('q', {}, r.flag.quote)));
        setText(decisionsCount, `Deadlines, costs and decisions (${flags.length})`);
      }
    } else if (!final) flagEl.hidden = true;
    if (final) announce(r.means ? `Means: ${r.means}` : 'Ready.');
    // Earpiece mode: read it quietly to the user, never to the partner side.
    if (final && state.settings.earpiece && (r.means || r.ask)) {
      const resume = listeningNow;
      if (resume) stopListening();
      const ok = speak([r.means && `Means: ${r.means}`, r.ask && `Ask: ${r.ask}`].filter(Boolean).join(' '), { voiceName: state.settings.voiceName, rate: Math.max(1, state.settings.rate), volume: 0.5, onEnd: () => resume && wantListening && !disposed && startListening() });
      if (!ok && resume) startListening();
    }
  }

  const middle = h('div', { class: 'middle' }, strip, sayPanel, askPanel, errorLine, h('p', { class: 'note-line disclaimer' }, 'Sotto restates and asks. It does not advise.'));
  const userSide = h('section', { class: 'user-side', 'aria-label': 'For me' }, topbar, middle, thumbbar);
  const el = h('main', { class: `session${state.settings.flipPartner ? ' partner-open' : ''}`, id: 'main' }, userSide, partnerSide);

  // ---------- behaviour ----------
  function setMode(m: 'say' | 'ask') {
    state.mode = m;
    live.mode = m;
    sayBtn.setAttribute('aria-pressed', String(m === 'say'));
    askBtn.setAttribute('aria-pressed', String(m === 'ask'));
    sayPanel.hidden = m !== 'say';
    prevLine.hidden = lastLine.hidden = m === 'ask'; // Ask shows the line itself, larger
    strip.classList.toggle('compact', m === 'ask');
    askPanel.hidden = m !== 'ask';
    if (lastPartner(live.turns)) live.refresh();
  }

  function say(text: string, via: 'option' | 'quick' | 'typed') {
    live.user(text, 'tap');
    state.answers.push({ askedAt: askedAt || Date.now(), answeredAt: Date.now(), text, via });
    if (!partnerSaid.classList.contains('empty') && partnerSaid.textContent && partnerSaid.textContent !== HOLD_LINE) {
      history.prepend(h('li', {}, partnerSaid.textContent));
      while (history.children.length > 3) history.lastElementChild!.remove();
    }
    partnerSaid.classList.remove('empty');
    setText(partnerSaid, text);
    setText(partnerTyping, '');
    optionBtns.forEach((b) => b.classList.toggle('said', b.querySelector('.text')?.textContent === text));
    hovering = false; // a choice was made: the next options may replace these
    if (optionsEl.contains(document.activeElement) && !optionsEl.querySelector(':focus-visible')) (document.activeElement as HTMLElement).blur();
    speakOut(text);
  }
  function hold() {
    state.answers.push({ askedAt: askedAt || Date.now(), answeredAt: Date.now(), text: HOLD_LINE, via: 'hold' });
    partnerSaid.classList.remove('empty');
    setText(partnerSaid, HOLD_LINE);
    setText(partnerTyping, 'A reply is coming.');
    speakOut(HOLD_LINE);
  }
  /** Speaks a line. Listening pauses while Sotto speaks, so it never transcribes its own voice. */
  function speakOut(text: string) {
    lastSpoken = text;
    againBtn.disabled = stopBtn.disabled = false;
    keepBtn.disabled = state.phrases.includes(text) || text === HOLD_LINE;
    const resume = listeningNow;
    if (resume) stopListening();
    const ok = speak(text, { voiceName: state.settings.voiceName, rate: state.settings.rate, onEnd: () => resume && wantListening && !disposed && startListening() });
    if (!ok && resume) startListening();
  }

  function startListening() {
    if (state.speech !== 'available' || listeningNow) return;
    try {
      const pack = state.pack;
      listener = listen(
        {
          onInterim: (t) => setText(interim, t),
          onFinal: (t) => {
            setText(interim, '');
            if (t) live.partner(t, 'speech');
          },
          onError: (code) => setText(errorLine, MIC_ERRORS[code] ?? 'Listening stopped. Press Listen to try again.'),
          onState: (on) => {
            listeningNow = on;
            receiptBtn.classList.toggle('listening', on);
            refreshReceipt();
            pulse.classList.toggle('on', on);
            setText(listenMenuBtn, on ? 'Stop listening' : 'Listen');
            setText(listenLabel, on ? 'Listening' : 'Not listening');
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
    listeningNow = false;
    pulse.classList.remove('on');
    setText(listenMenuBtn, 'Listen');
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
          setText(partnerTyping, ''); // they spoke again: the "reply is coming" notice is stale
          if (partnerSaid.textContent === HOLD_LINE) {
            partnerSaid.classList.add('empty');
            setText(partnerSaid, 'Sotto will show what I say here.');
          }
          renderStrip();
          setText(askLast, e.turn.text);
          setText(errorLine, '');
          repeatLine.replaceChildren();
        }
        break;
      case 'thinking':
        if (e.mode === 'say') skeleton();
        else showAsk({}, false);
        break;
      case 'say-partial':
        // Stream into an empty stack only; a stack being replaced swaps all three at once.
        if (!holdsFocus() && !optionsEl.classList.contains('stale')) paintOptions(e.texts, [], false, true);
        break;
      case 'say':
        fillers = e.options.map((o) => !!o.filler);
        showTiming(e.source);
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
        showTiming(e.source);
        break;
      case 'stopped':
        stopListening();
        el.classList.add('stopped');
        receiptBtn.classList.add('cloud');
        receiptBtn.replaceChildren('Live help stopped');
        partnerNotice.classList.add('cloud');
        setText(partnerNotice, 'Sotto stopped listening and suggesting on this device.');
        setText(errorLine, `Live help stopped: ${e.reason} Quick phrases and typing still work. The receipt shows what happened.`);
        paintOptions([], [], false);
        break;
      case 'error':
        if (!deps.suggestions) break; // expected: no model here; the empty state already says so
        setText(errorLine, 'No suggestions for that line. The quick phrases and typing still work.');
        optionsEl.classList.remove('stale');
        break;
    }
    refreshReceipt();
  });

  function showTiming(source: string) {
    const ms = askedAt ? Date.now() - askedAt : 0;
    setText(timing, ms ? `Ready ${(ms / 1000).toFixed(1)} s after their line · ${source === 'in_cloud' ? 'in the cloud' : 'on this device'}` : '');
    if (state.mode === 'ask') askPanel.append(timing);
    else optionsEl.after(timing);
  }

  // Offline is a feature: live help keeps working with the network gone (the airplane-mode test).
  const onNet = () => {
    el.classList.toggle('offline', !navigator.onLine);
    refreshReceipt();
    if (!navigator.onLine) announce('Offline. Live help keeps working on this device.');
  };
  window.addEventListener('online', onNet);
  window.addEventListener('offline', onNet);

  function refreshReceipt() {
    if (el.classList.contains('stopped')) return;
    const b = state.receipt.bytesOut;
    // Desktop: "Private mode · nothing sent". Phone: "On device", short enough for one row.
    receiptBtn.replaceChildren(
      h('span', { class: 'pill-full' }, state.cloudLive ? 'Cloud live mode' : 'Private mode'),
      h('span', { class: 'pill-short' }, state.cloudLive ? 'Cloud live' : listeningNow ? 'Listening' : 'On device'),
      h('span', { class: 'pill-detail' }, ` · ${b ? `${formatBytes(b)} sent` : 'nothing sent'}`),
    );
    if (!navigator.onLine) receiptBtn.append(h('span', { class: 'offline-tag pill-detail' }, ' · offline'));
    receiptBtn.setAttribute('aria-label', `${state.cloudLive ? 'Cloud live mode' : 'Private mode'}, ${b ? `${formatBytes(b)} sent` : 'nothing sent'}. Open the receipt.`);
  }

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (document.querySelector('dialog[open]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || e.isComposing || !state.settings.shortcuts) return;
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
    items: () => [],
    // Group scanning: Hold on is one step away; any option is at most four; any phrase about ten.
    groups: () => [
      [holdBtn],
      state.mode === 'say' ? optionBtns : [sayQuestion, repeatBtn],
      Array.from(quick.querySelectorAll<HTMLElement>('button')).slice(0, 7),
      Array.from(quick.querySelectorAll<HTMLElement>('button')).slice(7),
      [againBtn, flipBtn, steerInput],
    ],
    announce: (label) => announce(label),
    onChange: (on) => {
      scanBtn.setAttribute('aria-pressed', String(on));
      setText(scanBtn, on ? 'Scanning' : 'Scan');
      if (!disposed && on !== state.settings.scan) saveSettings({ scan: on });
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
      window.removeEventListener('online', onNet);
      window.removeEventListener('offline', onNet);
      scanner.dispose();
    },
  };
}

function packVocab(id: string): string[] {
  return packById(id)?.vocab ?? [];
}
