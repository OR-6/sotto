// The app shell: boot, capability, screens, the Cloud live switch.
import { deviceRuntimeNative, readDeviceState, setRequireNative } from '../ai/capability';
import { createCloudLiveBackend, setCloudLive, cloudState } from '../ai/cloud';
import { createLive, type Live, type LiveBackend } from '../ai/live';
import { createPrivateBackend, type PrivateBackend } from '../ai/private-backend';
import { loadConfig } from '../config';
import { packById } from '../core/packs/packs';
import { ASK_SCHEMA, ASK_SYSTEM } from '../core/prompts/ask';
import { SAY_SCHEMA, SAY_SYSTEM } from '../core/prompts/say';
import { cloudStarted, deviceAI, getCloud } from '../firebase';
import { installSpeech, readSpeechState } from '../speech/recognise';
import { loadVoices, offlineVoices } from '../speech/speak';
import { confirmCloudLive, openReceipt, openStats } from './dialogs';
import { h } from './dom';
import type { Nav, Screen } from './nav';
import { renderChoose } from './choose';
import { renderSession, type SessionView } from './session';
import { renderStart } from './start';
import { renderPrepare } from './prepare';
import { renderSummary } from './summary';
import { loadVoice, renderVoice } from './voice';
import { renderSafety } from './safety';
import { composeAsk } from '../core/compose';
import { filterAsk } from '../core/filter';
import type { RedCase } from '../core/redteam';
import { parseJson } from '../core/filter';
import { voiceDigest } from '../core/prompts/voice';
import { loadReplays, renderReplayList } from './replay';
import type { Replay } from '../core/replay';
import { applyTheme, state } from './state';
import { load, save, WARD } from './store';
import type { Brief } from '../core/prompts/prepare';
type ResumeState = { pack: string; mode: 'say' | 'ask'; situationText: string; partnerLabel: string; brief: Brief | null; consent: boolean; at: number };

let root: HTMLElement;
let banner: HTMLElement;
let privateBackend: PrivateBackend | null = null;
let live: Live | null = null;
let view: SessionView | null = null;
let replays: Replay[] = [];

/** Device for device steps; the cloud app (App Check, Installations) only when a cloud step runs. */
// The cloud app (App Check, Installations, Remote Config) starts only when the user presses Send.
const cloudAI = async () => {
  await ensureConfig();
  return getCloud().ai;
};
const aiPair = { device: deviceAI, cloud: cloudAI };

let configLoaded: Promise<void> | null = null;
/** Remote Config (cloud model name, kill switch), fetched on the first cloud screen. */
function ensureConfig(): Promise<void> {
  configLoaded ??= loadConfig(getCloud().app).then((c) => {
    state.config = c;
    cloudState.enabled = c.cloudEnabled;
  });
  return configLoaded;
}

function getPrivate(): PrivateBackend {
  privateBackend ??= createPrivateBackend(deviceAI, state.receipt);
  return privateBackend;
}

const nav: Nav = {
  go,
  async prepareDevice(onProgress) {
    await getPrivate().initialize(onProgress);
    state.device = await readDeviceState();
  },
  askCloudLive() {
    confirmCloudLive(state.device === 'available', async () => {
      await ensureConfig();
      resetSession(false); // turns heard in Private mode never become Cloud live prompts
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
    resetSession(false); // Cloud live turns do not carry into Private mode either (the receipt stays)
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
  else if (screen === 'prepare') renderPrepare(root, nav, aiPair);
  else if (screen === 'session') startSession();
  else if (screen === 'replay') renderReplayList(root, nav, replays);
  else if (screen === 'safety') renderSafety(root, nav, { live: hasDevice() ? runRedLive : undefined });
  else if (screen === 'voice') (renderVoice(root, nav, { cloud: cloudAI, compare: hasDevice() ? compareVoice : undefined }));
  else if (screen === 'summary') (renderSummary(root, aiPair, { turns: live?.turns ?? [], flags: state.flags }, () => (resetSession(), go('choose'))));
  const main = root.querySelector('main');
  if (main) {
    main.setAttribute('tabindex', '-1');
    main.focus({ preventScroll: true });
  }
}

/**
 * A cloud step loads Google's App Check script into this page. Before a Private-mode conversation
 * the page reloads, so nothing from a cloud step is running beside what is said. The setup
 * (situation, who, mode, the brief in use, the consent tick) is carried across once.
 */
function reloadForPrivate(): boolean {
  if (state.cloudLive || !cloudStarted()) return false;
  save('resume', { pack: state.pack, mode: state.mode, situationText: state.situationText, partnerLabel: state.partnerLabel, brief: state.useBrief ? state.brief : null, consent: state.settings.consent, at: Date.now() });
  location.replace(`${location.pathname}?resume`);
  return true;
}

async function begin() {
  if (reloadForPrivate()) return;
  // A user gesture: install the speech pack if it is downloadable (never server recognition).
  if (state.speech === 'downloadable') {
    await installSpeech('en-US');
    state.speech = await readSpeechState('en-US');
  }
  go('session');
}

/** Private mode on a browser without the model: phrases, Hold on and typing still speak; no suggestions. */
const NO_MODEL: LiveBackend = {
  mode: 'NONE',
  say: () => Promise.reject(new Error('this browser cannot make suggestions')),
  ask: () => Promise.reject(new Error('this browser cannot explain lines')),
};

const hasDevice = () => state.device === 'available';

function startSession() {
  const backend = state.cloudLive
    ? createCloudLiveBackend(getCloud().ai, state.config.cloudModel, state.receipt, { saySystem: SAY_SYSTEM, saySchema: SAY_SCHEMA, askSystem: ASK_SYSTEM, askSchema: ASK_SCHEMA })
    : hasDevice()
      ? getPrivate()
      : NO_MODEL;
  live ??= createLive({ backend, receipt: state.receipt, budgetChars: state.config.maxContextTokens * 3 });
  live.setBackend(backend);
  const pack = packById(state.pack);
  live.chips = {
    situation: state.situationText || pack?.label || 'a conversation',
    partner: state.partnerLabel || pack?.partner || 'someone',
    tone: state.settings.tone,
    joke: state.settings.joke,
    brief: [state.useBrief && state.brief ? state.brief.digest : '', state.situationText ? '' : (pack?.digest ?? '')].filter(Boolean).join(' '),
    voice: state.useVoice && state.voicePack ? voiceDigest(state.voicePack) : '',
  };
  view = renderSession({
    live,
    helpers: state.cloudLive || !hasDevice() ? undefined : getPrivate(),
    suggestions: state.cloudLive || hasDevice(),
    phrases: state.phrases,
    openReceipt: () => openReceipt(),
    onEnd: () =>
      openStats(
        () => (resetSession(), go('choose')),
        () => (resetSession(), go('start')),
        live && live.turns.length ? () => go('summary') : undefined,
        () => go('session'), // nothing was cleared: back to the same conversation
      ),
  });
  root.replaceChildren(view.el);
  if (!state.cloudLive && state.device === 'available' && !state.warmMs) {
    // Warm the model so the first real suggestion is not cold (measured: about 13 s for the first
    // call of a session). Runs on device; sends nothing. The screen says it is getting ready.
    view.setReady(false);
    getPrivate()
      .warm()
      .then((ms) => ((state.warmMs = ms), view?.refreshReceipt()))
      .catch(() => undefined)
      .finally(() => view?.setReady(true));
  }
}

/** The voice pack's before/after: the same line, Say on device without and with the digest. */
async function compareVoice(voice: string) {
  const line = 'So what did you get up to this weekend?';
  const ctx = { situation: 'Family', partner: 'my sister', tone: state.settings.tone, joke: false, brief: '', voice: '', turns: [{ id: 1, who: 'P' as const, text: line, at: 0, via: 'typed' as const }], budgetChars: 3000 };
  const run = async (v: string) => {
    const b = getPrivate();
    const r = await b.say(b.sayFormat.compose({ ...ctx, voice: v }, ''), () => undefined, new AbortController().signal);
    state.receipt.recordDevice({ step: v ? 'voice after' : 'voice before', mode: 'ONLY_ON_DEVICE', ms: r.ms });
    return b.sayFormat.final(r.text, line).options.map((o) => o.text);
  };
  const before = await run('');
  const after = await run(voice);
  return { line, before, after };
}

/** A red-team line through the real on-device model and the same filters. Nothing is sent. */
async function runRedLive(c: RedCase) {
  const ctx = { situation: 'a conversation', partner: 'someone', tone: 'neutral' as const, joke: false, brief: '', voice: '', turns: [{ id: 1, who: 'P' as const, text: c.line, at: 0, via: 'typed' as const }], budgetChars: 3000 };
  const b = getPrivate();
  const signal = new AbortController().signal;
  if (c.mode === 'say') {
    const r = await b.say(b.sayFormat.compose(ctx, ''), () => undefined, signal);
    state.receipt.recordDevice({ step: `safety ${c.id}`, mode: 'ONLY_ON_DEVICE', ms: r.ms });
    const f = b.sayFormat.final(r.text, c.line);
    return { kept: f.options.map((o) => (o.filler ? `${o.text} (quick reply)` : o.text)), dropped: f.dropped.map((d) => `${d.text} (${d.why})`), ms: r.ms };
  }
  const r = await b.ask(composeAsk(ctx), () => undefined, signal);
  state.receipt.recordDevice({ step: `safety ${c.id}`, mode: 'ONLY_ON_DEVICE', ms: r.ms });
  const f = filterAsk(parseJson(r.text), c.line);
  const x = f.result;
  return { kept: x ? [x.means && `Means: ${x.means}`, x.ask && `Ask: ${x.ask}`, x.flag.kind !== 'none' ? `Flag (${x.flag.kind}): ${x.flag.quote}` : ''].filter(Boolean) : [], dropped: f.notes, ms: r.ms };
}

/** The Settings latency check: three warm Say calls on one line, timed to first option and to all three. */
async function measureLatency() {
  const ctx = { situation: 'Café', partner: 'the barista', tone: state.settings.tone, joke: false, brief: '', voice: '', turns: [{ id: 1, who: 'P' as const, text: 'What can I get you?', at: 0, via: 'typed' as const }], budgetChars: 3000 };
  const b = getPrivate();
  if (!state.warmMs) state.warmMs = await b.warm();
  const first: number[] = [];
  const total: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    let f = 0;
    const r = await b.say(b.sayFormat.compose(ctx, ''), (soFar) => {
      if (!f && b.sayFormat.partial(soFar).length) f = performance.now() - t0;
    }, new AbortController().signal);
    state.receipt.recordDevice({ step: 'latency check', mode: 'ONLY_ON_DEVICE', ms: r.ms });
    first.push(f || r.ms);
    total.push(performance.now() - t0);
  }
  return { first, total };
}

/** Ends a conversation: what was said is dropped from memory. */
function resetSession(clearReceipt = true) {
  live?.clear();
  state.answers = [];
  state.flags.length = 0;
  if (clearReceipt) {
    state.receipt.clear();
    if (WARD) {
      // A shared device: nothing about this conversation carries into the next person's.
      Object.assign(state, { brief: null, useBrief: false, situationText: '', partnerLabel: '' });
    }
    // Cloud live mode is per conversation: the next one starts in Private mode and asks again.
    if (state.cloudLive) {
      state.cloudLive = false;
      setCloudLive(false);
      renderBanner();
    }
  }
}

export async function boot(container: HTMLElement): Promise<void> {
  applyTheme();
  loadVoice();
  const resume = new URLSearchParams(location.search).has('resume') ? load<ResumeState | null>('resume', null) : null;
  save('resume', null);
  if (resume) history.replaceState(null, '', location.pathname);
  banner = h('div', { class: 'cloud-banner', id: 'cloud-banner', role: 'alert', hidden: true });
  root = h('div', { id: 'screen' });
  container.replaceChildren(banner, root, h('div', { id: 'announcer', class: 'sr-only', 'aria-live': 'polite' }));
  const [device, speech, voices] = await Promise.all([readDeviceState(), readSpeechState('en-US'), loadVoices()]);
  // A LanguageModel defined by a page script or extension would receive every live prompt: refuse it,
  // now and at every later call.
  setRequireNative(true);
  state.device = device !== 'missing' && !deviceRuntimeNative() ? 'unavailable' : device;
  state.speech = speech;
  if (state.device === 'available') state.measure = measureLatency;
  state.voices = offlineVoices(voices).length;
  replays = await loadReplays();
  state.replays = replays.length;
  if (resume && Date.now() - resume.at < 60_000) {
    Object.assign(state, { pack: resume.pack, mode: resume.mode, situationText: resume.situationText, partnerLabel: resume.partnerLabel });
    state.settings.consent = resume.consent;
    if (resume.brief) ((state.brief = resume.brief), (state.useBrief = true));
    return void begin();
  }
  go('start');
  // Remote Config is fetched only when a cloud step is opened (ensureConfig), so Private mode
  // makes no request at all.
}
