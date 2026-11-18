// The app shell: boot, capability, screens, the Cloud live switch.
import { deviceRuntimeNative, readDeviceState } from '../ai/capability';
import { createCloudLiveBackend, setCloudLive, cloudState } from '../ai/cloud';
import { createLive, type Live, type LiveBackend } from '../ai/live';
import { createPrivateBackend, type PrivateBackend } from '../ai/private-backend';
import { loadConfig } from '../config';
import { packById } from '../core/packs/packs';
import { ASK_SCHEMA, ASK_SYSTEM } from '../core/prompts/ask';
import { SAY_SCHEMA, SAY_SYSTEM } from '../core/prompts/say';
import { deviceAI, getCloud } from '../firebase';
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
import { composeSay } from '../core/compose';
import { parseJson, filterSay } from '../core/filter';
import { voiceDigest } from '../core/prompts/voice';
import { loadReplays, renderReplayList } from './replay';
import type { Replay } from '../core/replay';
import { applyTheme, state } from './state';

let root: HTMLElement;
let banner: HTMLElement;
let privateBackend: PrivateBackend | null = null;
let live: Live | null = null;
let view: SessionView | null = null;
let replays: Replay[] = [];

/** Device for device steps; the cloud app (App Check, Installations) only when a cloud step runs. */
const aiPair = { device: deviceAI, cloud: () => getCloud().ai };

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
      resetSession(); // turns heard in Private mode never become Cloud live prompts
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
    resetSession(); // Cloud live turns do not carry into Private mode either
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
  else if (screen === 'prepare') (void ensureConfig(), renderPrepare(root, nav, aiPair));
  else if (screen === 'session') startSession();
  else if (screen === 'replay') renderReplayList(root, nav, replays);
  else if (screen === 'safety') renderSafety(root, nav, { live: hasDevice() ? runRedLive : undefined });
  else if (screen === 'voice') (void ensureConfig(), renderVoice(root, nav, { cloud: () => getCloud().ai, compare: hasDevice() ? compareVoice : undefined }));
  else if (screen === 'summary') (void ensureConfig(), renderSummary(root, aiPair, { turns: live?.turns ?? [], flags: state.flags }, () => (resetSession(), go('choose'))));
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
    // Warm the model so the first real suggestion is not cold. Runs on device; sends nothing.
    getPrivate()
      .warm()
      .then((ms) => ((state.warmMs = ms), view?.refreshReceipt()))
      .catch(() => undefined);
  }
}

/** The voice pack's before/after: the same line, Say on device without and with the digest. */
async function compareVoice(voice: string) {
  const line = 'So what did you get up to this weekend?';
  const ctx = { situation: 'Family', partner: 'my sister', tone: state.settings.tone, joke: false, brief: '', voice: '', turns: [{ id: 1, who: 'P' as const, text: line, at: 0, via: 'typed' as const }], budgetChars: 3000 };
  const run = async (v: string) => {
    const r = await getPrivate().say(composeSay({ ...ctx, voice: v }, ''), () => undefined, new AbortController().signal);
    state.receipt.recordDevice({ step: v ? 'voice after' : 'voice before', mode: 'ONLY_ON_DEVICE', ms: r.ms });
    return filterSay(parseJson(r.text), line).options.map((o) => o.text);
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
    const r = await b.say(composeSay(ctx, ''), () => undefined, signal);
    state.receipt.recordDevice({ step: `safety ${c.id}`, mode: 'ONLY_ON_DEVICE', ms: r.ms });
    const f = filterSay(parseJson(r.text), c.line);
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
    const r = await b.say(composeSay(ctx, ''), (soFar) => {
      if (!f && /"text"\s*:\s*"[^"]+"/.test(soFar)) f = performance.now() - t0;
    }, new AbortController().signal);
    state.receipt.recordDevice({ step: 'latency check', mode: 'ONLY_ON_DEVICE', ms: r.ms });
    first.push(f || r.ms);
    total.push(performance.now() - t0);
  }
  return { first, total };
}

/** Ends a conversation: what was said is dropped from memory. */
function resetSession() {
  live?.clear();
  state.answers = [];
  state.flags.length = 0;
  state.receipt.clear();
}

export async function boot(container: HTMLElement): Promise<void> {
  applyTheme();
  loadVoice();
  banner = h('div', { class: 'cloud-banner', id: 'cloud-banner', role: 'alert', hidden: true });
  root = h('div', { id: 'screen' });
  container.replaceChildren(banner, root, h('div', { id: 'announcer', class: 'sr-only', 'aria-live': 'polite' }));
  const [device, speech, voices] = await Promise.all([readDeviceState(), readSpeechState('en-US'), loadVoices()]);
  // A LanguageModel defined by a page script or extension would receive every live prompt: refuse it.
  state.device = device !== 'missing' && !deviceRuntimeNative() ? 'unavailable' : device;
  state.speech = speech;
  if (state.device === 'available') state.measure = measureLatency;
  state.voices = offlineVoices(voices).length;
  replays = await loadReplays();
  state.replays = replays.length;
  go('start');
  // Remote Config is fetched only when a cloud step is opened (ensureConfig), so Private mode
  // makes no request at all.
}
