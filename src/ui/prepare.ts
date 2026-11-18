// Screen 6: Prepare. One line goes to the cloud, shown first; a brief comes back.
import { CloudDeclinedError, CloudOffError } from '../ai/cloud';
import { prepareInCloud, prepareOnDevice, prepareOutgoing, type PrepareResult } from '../ai/prepare';
import type { Brief } from '../core/prompts/prepare';
import { formatBytes, formatMs, h } from './dom';
import { state } from './state';
import { load, save } from './store';
import type { Nav } from './nav';

export function briefCards(b: Brief): HTMLElement {
  const sec = (title: string, body: HTMLElement | null) => (body ? h('section', { class: 'brief-card' }, h('h3', {}, title), body) : null);
  const ul = (xs: string[]) => (xs.length ? h('ul', {}, xs.map((x) => h('li', {}, x))) : null);
  return h(
    'div',
    { class: 'brief', id: 'brief' },
    sec('What will probably happen', b.what ? h('p', {}, b.what) : null),
    sec('Words you may hear', b.terms.length ? h('dl', {}, b.terms.flatMap((t) => [h('dt', {}, t.term), h('dd', {}, t.meaning)])) : null),
    sec('Questions people wish they had asked', ul(b.questions)),
    sec('Bring or have ready', ul(b.bring)),
    sec('Watch for', ul(b.red_flags)),
    sec('If you freeze, say', ul(b.panic)),
  );
}

export function renderPrepare(root: HTMLElement, nav: Nav, ai: { device: Parameters<typeof prepareInCloud>[0]; cloud: () => Parameters<typeof prepareInCloud>[0] }): void {
  const input = h('input', { class: 'text-input', id: 'prepare-text', maxlength: 160, placeholder: 'knee MRI results, orthopaedist, tomorrow', value: state.situationText, 'aria-label': 'What are you walking into?' });
  const outUser = h('pre', { class: 'outgoing', id: 'outgoing-user' });
  const outSystem = h('pre', { class: 'outgoing small' });
  const status = h('p', { class: 'note-line', role: 'status', id: 'prepare-status' });
  const result = h('div', { id: 'prepare-result' });
  const send = h('button', { class: 'btn primary', id: 'prepare-send', disabled: !state.config.cloudEnabled }, 'Send this line and prepare');
  const local = h('button', { class: 'btn', id: 'prepare-local', disabled: state.device !== 'available' }, 'Prepare on this device instead');

  const refresh = () => {
    const o = prepareOutgoing(input.value.trim() || '…', state.config.cloudModel);
    outUser.textContent = o.user;
    outSystem.textContent = o.system;
    send.disabled = !input.value.trim() || !state.config.cloudEnabled;
    local.disabled = !input.value.trim() || state.device !== 'available';
  };
  input.addEventListener('input', refresh);

  const show = (r: PrepareResult, fresh = true) => {
    state.brief = r.brief;
    state.useBrief = true;
    state.situationText = input.value.trim();
    const all = load<{ situation: string; brief: Brief; date: string }[]>('briefs', []);
    const use = h('input', { type: 'checkbox', id: 'use-brief', checked: true });
    use.addEventListener('change', () => (state.useBrief = use.checked));
    const saved = h('span', { class: 'muted', role: 'status' });
    const keep = h('button', { class: 'btn small', id: 'keep-brief' }, 'Keep on this device');
    keep.addEventListener('click', () => {
      all.unshift({ situation: state.situationText, brief: r.brief, date: new Date().toISOString().slice(0, 10) });
      saved.textContent = save('briefs', all.slice(0, 20)) ? 'Kept.' : 'This browser would not keep it.';
    });
    result.replaceChildren(
      h(
        'p',
        { class: 'where-line', hidden: !fresh },
        r.source === 'in_cloud' ? `Written in the cloud in ${formatMs(r.ms)}. Sent: ${formatBytes(r.bytesOut)}, listed in the receipt.` : `Written on this device in ${formatMs(r.ms)}. Nothing was sent.`,
      ),
      briefCards(r.brief),
      h('label', { class: 'consent', for: 'use-brief' }, use, h('span', {}, 'Use this brief during the conversation (a short version stays on this device and shapes Ask and Say).')),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', id: 'prepare-begin', onclick: () => nav.go('choose') }, 'Continue'), keep, saved),
    );
  };

  const run = async (where: 'cloud' | 'device') => {
    const line = input.value.trim();
    if (!line) return;
    send.disabled = local.disabled = true;
    status.textContent = where === 'cloud' ? 'Sending the line above and writing the brief…' : 'Writing a short brief on this device…';
    try {
      // Pressing the button is the approval of exactly the text shown above (I3).
      const r = where === 'cloud' ? await prepareInCloud(ai.cloud(), line, state.config.cloudModel, async (o) => o.user === outUser.textContent && o.system === outSystem.textContent, state.receipt) : await prepareOnDevice(ai.device, line, state.receipt);
      status.textContent = '';
      show(r);
    } catch (e) {
      status.textContent =
        e instanceof CloudOffError
          ? 'Cloud steps are switched off right now. Prepare on this device instead.'
          : e instanceof CloudDeclinedError
            ? 'Nothing was sent.'
            : `${(e as Error).message}${state.device === 'available' ? ' You can prepare on this device instead.' : ''}`;
    } finally {
      refresh();
    }
  };
  send.addEventListener('click', () => run('cloud'));
  local.addEventListener('click', () => run('device'));

  root.replaceChildren(
    h(
      'main',
      { class: 'choose', id: 'main' },
      h('h1', {}, 'Prepare'),
      h('p', { class: 'lede' }, 'Before a conversation you are nervous about. Type one line about it. The cloud writes a brief: what will happen, the words you will hear, the questions people wish they had asked.'),
      h('label', { class: 'field-label', for: 'prepare-text' }, 'What are you walking into?'),
      input,
      h(
        'div',
        { class: 'outgoing-pane', 'aria-live': 'polite' },
        h('p', { class: 'outgoing-title' }, 'Exactly this will be sent to the cloud, and nothing else:'),
        outUser,
        h('details', {}, h('summary', {}, 'With these instructions'), outSystem),
      ),
      h('div', { class: 'row' }, send, local, h('button', { class: 'btn', onclick: () => nav.go('choose') }, 'Back')),
      status,
      result,
    ),
  );
  refresh();
  if (state.brief) show({ brief: state.brief, source: 'on_device', ms: 0, bytesOut: 0 }, false);
}
