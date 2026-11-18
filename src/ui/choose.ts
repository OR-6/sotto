// Screen 2: Say or Ask, the situation, who you are talking to.
import { PACKS, packById } from '../core/packs/packs';
import { h } from './dom';
import { state } from './state';
import type { Nav } from './nav';
import { WARD } from './store';

const WHO = ['the barista', 'my doctor', 'the pharmacist', 'my landlord', 'the official', 'the bank adviser', 'the teacher', 'my family', 'a stranger'];

export function renderChoose(root: HTMLElement, nav: Nav, begin: () => void): void {
  const modeCard = (id: 'say' | 'ask', name: string, forWho: string, what: string) => {
    const b = h('button', { class: 'mode-card', 'aria-pressed': String(state.mode === id), id: `mode-${id}` }, h('span', { class: 'name' }, name), h('span', { class: 'for' }, forWho), h('span', { class: 'what' }, what));
    b.addEventListener('click', () => {
      state.mode = id;
      sayCard.setAttribute('aria-pressed', String(id === 'say'));
      askCard.setAttribute('aria-pressed', String(id === 'ask'));
    });
    return b;
  };
  const sayCard = modeCard('say', 'Say', 'I cannot speak, or not fast enough.', 'Three things to say next, spoken aloud in one tap.');
  const askCard = modeCard('ask', 'Ask', 'I am out of my depth.', state.device === 'available' || state.cloudLive ? 'What the last sentence meant, and the question to ask next.' : 'Needs the on-device model, or Cloud live mode, on this browser.');
  if (!(state.device === 'available' || state.cloudLive)) {
    askCard.disabled = true;
    askCard.classList.add('dim');
    state.mode = 'say';
    sayCard.setAttribute('aria-pressed', 'true');
  }
  const askAllowed = !askCard.disabled;

  const custom = h('input', { class: 'text-input', id: 'situation-text', placeholder: 'Or type it: knee results with the orthopaedist', maxlength: 120, value: state.situationText, 'aria-label': 'Describe the situation' });
  const whoInput = h('input', { class: 'text-input', id: 'who-text', placeholder: 'Someone else', maxlength: 60, 'aria-label': 'Who you are talking to' });

  const packChips = PACKS.map((p) => {
    const c = h('button', { class: 'chip', 'aria-pressed': String(state.pack === p.id && !state.situationText), 'data-pack': p.id }, p.label);
    c.addEventListener('click', () => {
      state.pack = p.id;
      state.situationText = '';
      custom.value = '';
      state.partnerLabel = p.partner;
      if (!touchedMode && (p.mode === 'say' || askAllowed)) {
        state.mode = p.mode;
        sayCard.setAttribute('aria-pressed', String(state.mode === 'say'));
        askCard.setAttribute('aria-pressed', String(state.mode === 'ask'));
      }
      packChips.forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      whoChips.forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.who === p.partner)));
    });
    return c;
  });
  let touchedMode = false;
  [sayCard, askCard].forEach((c) => c.addEventListener('click', () => (touchedMode = true)));
  custom.addEventListener('input', () => {
    state.situationText = custom.value;
    packChips.forEach((x) => x.setAttribute('aria-pressed', String(!custom.value && x.dataset.pack === state.pack)));
  });

  if (!state.partnerLabel) state.partnerLabel = packById(state.pack)?.partner ?? 'someone';
  const whoChips = WHO.map((w) => {
    const c = h('button', { class: 'chip', 'aria-pressed': String(state.partnerLabel === w), 'data-who': w }, w);
    c.addEventListener('click', () => {
      state.partnerLabel = w;
      whoInput.value = '';
      whoChips.forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
    });
    return c;
  });
  whoInput.addEventListener('input', () => {
    state.partnerLabel = whoInput.value.trim() || packById(state.pack)?.partner || 'someone';
    whoChips.forEach((x) => x.setAttribute('aria-pressed', String(!whoInput.value && x.dataset.who === state.partnerLabel)));
  });

  const prepareCard = h(
    'button',
    { class: 'path', id: 'go-prepare', onclick: () => nav.go('prepare') },
    h('strong', {}, state.brief ? 'Brief ready' : 'Prepare first (optional)'),
    h('span', {}, state.brief ? (state.useBrief ? 'Sotto will use it during the conversation. Open to read or change it.' : 'Not in use. Open to turn it on.') : 'A brief from the cloud before you go: what will happen, the words you will hear, the questions to ask.'),
  );
  const voiceCard = h(
    'button',
    { class: 'path', id: 'go-voice', onclick: () => nav.go('voice') },
    h('strong', {}, state.voicePack ? (state.useVoice ? 'Your voice is on' : 'Your voice is off') : 'Your voice (optional)'),
    h('span', {}, state.voicePack ? 'Say suggestions use how you talk. Open to see or change it.' : 'So Say suggestions sound like you: a few phrases you choose, built in the cloud, kept here.'),
  );
  const beginBtn = h('button', { class: 'btn primary', id: 'begin' }, 'Begin');
  beginBtn.addEventListener('click', begin);

  root.replaceChildren(
    h(
      'main',
      { class: 'choose', id: 'main' },
      h('h1', {}, 'What do you need right now?'),
      h('div', { class: 'modes' }, sayCard, askCard),
      h('span', { class: 'field-label', id: 'sit-label' }, 'Where are you?'),
      h('div', { class: 'row', role: 'group', 'aria-labelledby': 'sit-label' }, packChips),
      h('div', { style: 'margin-top:12px' }, custom),
      h('span', { class: 'field-label', id: 'who-label' }, 'Who are you talking to?'),
      h('div', { class: 'row', role: 'group', 'aria-labelledby': 'who-label' }, whoChips),
      h('div', { style: 'margin-top:12px' }, whoInput),
      WARD ? null : h('div', { class: 'paths' }, prepareCard, voiceCard),
      h('div', { class: 'row sticky-actions' }, beginBtn, h('button', { class: 'btn', onclick: () => nav.go('start') }, 'Back')),
    ),
  );
}
