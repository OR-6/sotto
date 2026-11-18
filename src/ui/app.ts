// The app shell: boot, capability, screens, the Cloud live switch.
import { readDeviceState } from '../ai/capability';
import { createCloudLiveBackend, setCloudLive, cloudState } from '../ai/cloud';
import { createLive, type Live } from '../ai/live';
import { createPrivateBackend, type PrivateBackend } from '../ai/private-backend';
import { loadConfig } from '../config';
import { packById } from '../core/packs/packs';
import { ASK_SCHEMA, ASK_SYSTEM } from '../core/prompts/ask';
import { SAY_SCHEMA, SAY_SYSTEM } from '../core/prompts/say';
import { app as firebaseApp, ai } from '../firebase';
import { installSpeech, readSpeechState } from '../speech/recognise';
import { loadVoices, offlineVoices } from '../speech/speak';
import { confirmCloudLive, openReceipt, openStats } from './dialogs';
import { h } from './dom';
import type { Nav, Screen } from './nav';
import { renderChoose } from './choose';
import { renderSession, type SessionView } from './session';
import { renderStart } from './start';
import { renderPrepare } from './prepare';
import { applyTheme, state } from './state';

let root: HTMLElement;
let banner: HTMLElement;
let privateBackend: PrivateBackend | null = null;
let live: Live | null = null;
let view: SessionView | null = null;

function getPrivate(): PrivateBackend {
  privateBackend ??= createPrivateBackend(ai, state.receipt);
  return privateBackend;
}

const nav: Nav = {
  go,
  async prepareDevice(onProgress) {
    await getPrivate().initialize(onProgress);
    state.device = await readDeviceState();
  },
  askCloudLive() {
    confirmCloudLive(() => {
      state.cloudLive = true;
      setCloudLive(true);
      renderBanner();
      go('choose');
    });
  },
  openReceipt: () => openReceipt(),
};

function renderBanner() {
  banner.hidden = !state.cloudLive;
  if (!state.cloudLive) return banner.replaceChildren();
  const offBtn = h('button', { id: 'cloud-off' }, 'Turn off');
  offBtn.addEventListener('click', () => {
    state.cloudLive = false;
    setCloudLive(false);
    renderBanner();
    if (live && privateBackend) live.setBackend(privateBackend);
    go('start');
  });
  banner.replaceChildren(h('span', {}, 'Cloud live mode is on. What is said here is sent to Google\'s Gemini.'), offBtn);
}

function go(screen: Screen) {
  view?.dispose();
  view = null;
  window.scrollTo(0, 0);
  if (screen === 'start') renderStart(root, nav);
  else if (screen === 'choose') renderChoose(root, nav, begin);
  else if (screen === 'prepare') renderPrepare(root, nav, ai);
  else if (screen === 'session') startSession();
  const main = root.querySelector('main');
  if (main) {
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: true });
  }
}

async function begin() {
  // A user gesture: install the speech pack if it is downloadable (never server recognition).
  if (state.speech === 'downloadable') {
    await installSpeech('en-US');
    state.speech = await readSpeechState('en-US');
  }
  go('session');
}

function startSession() {
  const backend = state.cloudLive
    ? createCloudLiveBackend(ai, state.config.cloudModel, state.receipt, { saySystem: SAY_SYSTEM, saySchema: SAY_SCHEMA, askSystem: ASK_SYSTEM, askSchema: ASK_SCHEMA })
    : getPrivate();
  live ??= createLive({ backend, receipt: state.receipt, budgetChars: state.config.maxContextTokens * 3 });
  live.setBackend(backend);
  const pack = packById(state.pack);
  live.chips = {
    situation: state.situationText || pack?.label || 'a conversation',
    partner: state.partnerLabel || pack?.partner || 'someone',
    tone: state.settings.tone,
    joke: state.settings.joke,
    brief: [state.useBrief && state.brief ? state.brief.digest : '', state.situationText ? '' : (pack?.digest ?? '')].filter(Boolean).join(' '),
    voice: '',
  };
  view = renderSession({
    live,
    helpers: state.cloudLive ? undefined : getPrivate(),
    phrases: state.phrases,
    openReceipt: () => openReceipt(),
    onEnd: () =>
      openStats(
        () => {
          live?.clear();
          state.answers = [];
          go('choose');
        },
        () => {
          live?.clear();
          state.answers = [];
          go('start');
        },
      ),
  });
  root.replaceChildren(view.el);
  if (!state.cloudLive && state.device === 'available' && !state.warmMs) {
    // Warm the model so the first real suggestion is not cold. Runs on device; sends nothing.
    getPrivate()
      .warm()
      .then((ms) => ((state.warmMs = ms), view?.refreshReceipt()))
      .catch(() => undefined);
  }
}

export async function boot(container: HTMLElement): Promise<void> {
  applyTheme();
  banner = h('div', { class: 'cloud-banner', id: 'cloud-banner', role: 'alert', hidden: true });
  root = h('div', { id: 'screen' });
  container.replaceChildren(banner, root, h('div', { id: 'announcer', class: 'sr-only', 'aria-live': 'polite' }));
  const [device, speech, voices] = await Promise.all([readDeviceState(), readSpeechState('en-US'), loadVoices()]);
  state.device = device;
  state.speech = speech;
  state.voices = offlineVoices(voices).length;
  go('start');
  // Remote Config: the cloud model name and the kill switch. Never blocks the first screen.
  loadConfig(firebaseApp).then((c) => {
    state.config = c;
    cloudState.enabled = c.cloudEnabled;
  });
}
