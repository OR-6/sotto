// Screen 1: what Sotto is, the stance, what this browser can do, and one way forward.
import { h } from './dom';
import { state, saveSettings } from './state';
import type { Nav } from './nav';
import { openSettings } from './settings';

export function capabilityLines(): HTMLElement {
  const line = (ok: 'yes' | 'wait' | 'no', text: string) => h('div', { class: 'cap-line' }, h('span', { class: `cap-dot ${ok}`, 'aria-hidden': 'true' }), h('span', {}, text));
  const d = state.device;
  const model =
    d === 'available'
      ? line('yes', 'This browser can run the on-device model.')
      : d === 'downloadable' || d === 'downloading'
        ? line('wait', 'This browser can run the on-device model after a one-time download.')
        : line('no', 'This browser cannot run the on-device model.');
  const s = state.speech;
  const speech =
    s === 'available'
      ? line('yes', 'On-device speech: English installed.')
      : s === 'downloadable' || s === 'downloading'
        ? line('wait', 'On-device speech: English, installs when you start.')
        : line('no', 'No on-device speech here. The other person can type instead.');
  const voices = state.voices > 0 ? line('yes', `Offline voices: ${state.voices}.`) : line('no', 'No offline voice. Chosen lines are shown in large type instead.');
  return h('section', { class: 'cap', 'aria-labelledby': 'cap-title' }, h('h2', { id: 'cap-title' }, 'On this device'), model, speech, voices);
}

export function renderStart(root: HTMLElement, nav: Nav): void {
  const canPrivate = state.device === 'available' || state.device === 'downloadable' || state.device === 'downloading';
  const consent = h('input', { type: 'checkbox', id: 'consent', checked: state.settings.consent });
  const status = h('p', { class: 'note-line', role: 'status' });
  const startBtn = h('button', { class: 'btn primary', id: 'start', disabled: !state.settings.consent }, state.device === 'available' ? 'Start' : canPrivate ? 'Get ready and start' : 'Start with phrases and typing');
  consent.addEventListener('change', () => {
    saveSettings({ consent: consent.checked });
    startBtn.disabled = !consent.checked;
    cloudBtn.disabled = !consent.checked;
  });
  startBtn.addEventListener('click', async () => {
    if (canPrivate && state.device !== 'available') {
      startBtn.disabled = true;
      status.textContent = 'Getting the on-device model ready. This happens once.';
      try {
        await nav.prepareDevice((f) => (status.textContent = `Downloading the on-device model: ${Math.round(f * 100)} %`));
      } catch (e) {
        status.textContent = `The on-device model could not be prepared: ${(e as Error).message}`;
        startBtn.disabled = false;
        return;
      }
    }
    nav.go('choose');
  });

  const cloudBtn = h('button', { class: 'path cloud', id: 'cloud-live', disabled: !state.settings.consent || !state.config.cloudEnabled }, h('strong', {}, 'Cloud live mode'), h('span', {}, state.config.cloudEnabled ? 'For a device without the on-device model. What is said is sent to the cloud, with a red banner on every screen.' : 'Switched off right now.'));
  cloudBtn.addEventListener('click', () => nav.askCloudLive());

  const paths = h(
    'div',
    { class: 'paths' },
    state.replays > 0
      ? h('button', { class: 'path', id: 'replay', onclick: () => nav.go('replay') }, h('strong', {}, 'Replay a real session'), h('span', {}, 'Recorded on a laptop with the on-device model, with its real timings.'))
      : null,
    cloudBtn,
  );

  root.replaceChildren(
    h(
      'main',
      { class: 'start', id: 'main' },
      h('h1', { class: 'wordmark' }, 'Sotto', h('span', {}, '.')),
      h('p', { class: 'tagline' }, 'The quiet voice beside you.'),
      h(
        'ul',
        { class: 'stance' },
        h('li', {}, 'Live help in any conversation, on your device: the words to say if you cannot speak, the meaning and the next question if you are out of your depth.'),
        h('li', {}, 'For the person who is the weaker party in the room. Never for cheating or recording anyone.'),
        h('li', {}, 'In Private mode, nothing said here leaves this device. The receipt lists every request the page makes.'),
      ),
      capabilityLines(),
      h('label', { class: 'consent', for: 'consent' }, consent, h('span', {}, 'I will tell the people I talk to that Sotto is listening on this device. It records nothing.')),
      h('div', { class: 'row' }, startBtn, !canPrivate ? h('span', { class: 'muted' }, 'Suggestions in Private mode need desktop Chrome with the on-device model. Phrases, Hold on and typing work anywhere.') : null),
      status,
      paths,
      h(
        'p',
        { class: 'footer-line' },
        h('span', {}, 'Sotto restates and asks. It does not advise.'),
        h('button', { class: 'linkish', id: 'open-settings', onclick: () => void openSettings(() => nav.go('start')) }, 'Settings'),
        h('button', { class: 'linkish', onclick: () => nav.openReceipt() }, 'Receipt'),
        h('a', { href: 'https://github.com/OR-6/sotto', rel: 'noopener' }, 'How it works'),
      ),
    ),
  );
}
