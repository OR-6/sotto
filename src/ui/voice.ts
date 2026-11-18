// Screen 7: the voice pack. Phrases the user chooses and five answers go to the cloud, shown
// first; a style guide and phrases in their voice come back, kept on this device.
import { CloudDeclinedError, CloudOffError } from '../ai/cloud';
import { buildVoicePack, voiceOutgoing } from '../ai/voice-pack';
import { VOICE_GROUPS, voiceDigest, type VoiceAnswers, type VoicePack } from '../core/prompts/voice';
import { append, formatBytes, formatMs, h } from './dom';
import { state } from './state';
import { load, save } from './store';
import type { Nav } from './nav';

export type VoiceDeps = {
  cloud: () => Promise<Parameters<typeof buildVoicePack>[0]>;
  /** Runs Say on device for one line, without and with the voice digest. Undefined without a model. */
  compare?: (voice: string) => Promise<{ line: string; before: string[]; after: string[] }>;
};

const GROUP_LABEL: Record<string, string> = { greetings: 'Greetings', yes: 'Yes', no: 'No', maybe: 'Maybe', questions: 'Questions', thanks: 'Thanks', humour: 'Humour', needs: 'Needs', goodbye: 'Goodbye' };

export function loadVoice(): void {
  const saved = load<{ pack: VoicePack; on: boolean } | null>('voicePack', null);
  if (saved?.pack) {
    state.voicePack = saved.pack;
    state.useVoice = saved.on;
  }
}

export function renderVoice(root: HTMLElement, nav: Nav, deps: VoiceDeps): void {
  const phrases = h('textarea', { class: 'text-input', id: 'voice-phrases', rows: 8, 'aria-label': 'Phrases that sound like you, one per line', placeholder: 'Ten or more things you often say, one per line.\nAlright, go on then.\nNot a chance, mate.\nCan you give me a sec?' });
  const answers: VoiceAnswers = { register: 'casual', swearing: false, humour: 'dry', greeting: '', neverSay: '' };
  const chipGroup = <K extends keyof VoiceAnswers>(key: K, label: string, opts: [VoiceAnswers[K], string][]) => {
    const btns = opts.map(([v, t]) => {
      const b = h('button', { class: 'chip', 'aria-pressed': String(answers[key] === v) }, t);
      b.addEventListener('click', () => {
        answers[key] = v;
        btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        refresh();
      });
      return b;
    });
    return h('div', {}, h('span', { class: 'field-label' }, label), h('div', { class: 'row', role: 'group', 'aria-label': label }, btns));
  };
  const greeting = h('input', { class: 'text-input', id: 'voice-greeting', maxlength: 60, placeholder: 'Hiya', 'aria-label': 'How you greet people' });
  const never = h('input', { class: 'text-input', id: 'voice-never', maxlength: 100, placeholder: 'Words you never use', 'aria-label': 'What you never say' });
  const out = h('pre', { class: 'outgoing', id: 'voice-outgoing' });
  const status = h('p', { class: 'note-line', role: 'status' });
  const count = h('span', { class: 'muted' });
  const result = h('div', { id: 'voice-result' });
  const send = h('button', { class: 'btn primary', id: 'voice-send' }, 'Send these and build my voice');
  const lines = () => phrases.value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 30);
  const refresh = () => {
    answers.greeting = greeting.value.trim();
    answers.neverSay = never.value.trim();
    out.textContent = voiceOutgoing(lines(), answers, state.config.cloudModel).user;
    const n = lines().length;
    count.textContent = `${n} ${n === 1 ? 'phrase' : 'phrases'}${n < 10 ? ' (ten or more works best)' : ''}`;
    send.disabled = n < 3 || !state.config.cloudEnabled;
  };
  [phrases, greeting, never].forEach((el) => el.addEventListener('input', refresh));

  const show = (pack: VoicePack, meta?: { ms: number; bytesOut: number }) => {
    const use = h('input', { type: 'checkbox', id: 'use-voice', checked: state.useVoice });
    use.addEventListener('change', () => {
      state.useVoice = use.checked;
      save('voicePack', { pack, on: use.checked });
    });
    const cmpOut = h('div', { id: 'voice-compare' });
    const cmp = deps.compare ? h('button', { class: 'btn', id: 'voice-before-after' }, 'Before and after, on this device') : null;
    cmp?.addEventListener('click', async () => {
      cmp.disabled = true;
      cmpOut.replaceChildren(h('p', { class: 'muted' }, 'Asking the on-device model twice: without your voice, then with it…'));
      try {
        const r = await deps.compare!(voiceDigest(pack));
        cmpOut.replaceChildren(
          h('p', {}, h('strong', {}, 'They said: '), r.line),
          h('div', { class: 'brief' }, h('section', { class: 'brief-card' }, h('h3', {}, 'Without your voice'), h('ul', {}, r.before.map((t) => h('li', {}, t)))), h('section', { class: 'brief-card' }, h('h3', {}, 'With your voice'), h('ul', {}, r.after.map((t) => h('li', {}, t))))),
        );
      } catch (e) {
        cmpOut.replaceChildren(h('p', {}, `Could not compare: ${(e as Error).message}`));
      } finally {
        cmp.disabled = false;
      }
    });
    result.replaceChildren();
    append(result, [
      meta ? h('p', { class: 'where-line' }, `Built in the cloud in ${formatMs(meta.ms)}. Sent: ${formatBytes(meta.bytesOut)}, listed in the receipt. Kept on this device only.`) : null,
      h('section', { class: 'brief-card' }, h('h3', {}, 'How you talk'), h('p', {}, pack.style)),
      h('div', { class: 'brief' }, VOICE_GROUPS.filter((g) => pack.phrases[g].length).map((g) => h('section', { class: 'brief-card' }, h('h3', {}, GROUP_LABEL[g]), h('ul', {}, pack.phrases[g].map((p) => h('li', {}, p)))))),
      h('label', { class: 'consent', for: 'use-voice' }, use, h('span', {}, 'Use my voice for Say suggestions (a short version stays on this device).')),
      h('div', { class: 'row' }, cmp, h('button', { class: 'btn primary', onclick: () => nav.go('choose') }, 'Continue')),
      cmpOut,
    ]);
  };

  send.addEventListener('click', async () => {
    const list = lines();
    send.disabled = true;
    status.textContent = 'Sending the text above and building your voice…';
    try {
      const r = await buildVoicePack(await deps.cloud(), list, answers, state.config.cloudModel, async (o) => o.user === out.textContent, state.receipt);
      state.voicePack = r.pack;
      state.useVoice = true;
      save('voicePack', { pack: r.pack, on: true });
      status.textContent = '';
      show(r.pack, r);
    } catch (e) {
      status.textContent = e instanceof CloudOffError ? 'Cloud steps are switched off right now.' : e instanceof CloudDeclinedError ? 'Nothing was sent.' : (e as Error).message;
    } finally {
      refresh();
    }
  });

  root.replaceChildren(
    h(
      'main',
      { class: 'choose', id: 'main' },
      h('h1', {}, 'Your voice'),
      h('p', { class: 'lede' }, 'So suggestions sound like you, not like a phrasebook. Write things you often say; answer five quick questions. The cloud writes how you talk and about sixty phrases in your voice. They stay on this device.'),
      h('label', { class: 'field-label', for: 'voice-phrases' }, 'Things you often say'),
      phrases,
      h('div', { class: 'row' }, count),
      chipGroup('register', 'How do you usually talk?', [
        ['casual', 'Casual'],
        ['neutral', 'In between'],
        ['formal', 'Formal'],
      ]),
      chipGroup('swearing', 'Swearing?', [
        [false, 'Never'],
        [true, 'Sometimes'],
      ]),
      chipGroup('humour', 'Humour?', [
        ['none', 'Not really'],
        ['dry', 'Dry'],
        ['playful', 'Playful'],
      ]),
      h('label', { class: 'field-label', for: 'voice-greeting' }, 'How do you greet people?'),
      greeting,
      h('label', { class: 'field-label', for: 'voice-never' }, 'Anything you never say?'),
      never,
      h('div', { class: 'outgoing-pane' }, h('p', { class: 'outgoing-title' }, 'Exactly this will be sent to the cloud, with short instructions:'), out),
      h('div', { class: 'row' }, send, h('button', { class: 'btn', onclick: () => nav.go('choose') }, 'Back')),
      status,
      result,
    ),
  );
  refresh();
  if (state.voicePack) show(state.voicePack);
}
