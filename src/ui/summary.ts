// Screen 8: Summary. The user ticks what may leave; the exact text is shown; then the cloud
// (or the device) writes the summary, the decisions, follow-ups and a message to send.
import { CloudDeclinedError, CloudOffError } from '../ai/cloud';
import { summariseInCloud, summariseOnDevice, summaryOutgoing, type SummaryResult } from '../ai/summary';
import type { SummaryLine } from '../core/prompts/summary';
import type { Turn } from '../core/turns';
import { append, formatBytes, formatMs, h } from './dom';
import { state } from './state';
import { load, save } from './store';

export type SummaryInput = { turns: readonly Turn[]; flags: readonly { kind: string; quote: string }[] };

export function renderSummary(root: HTMLElement, ai: Parameters<typeof summariseInCloud>[0], input: SummaryInput, done: () => void): void {
  type Item = { line: SummaryLine; on: boolean };
  const items: Item[] = [
    ...input.flags.map((f) => ({ line: { kind: 'Flagged' as const, text: `${f.kind}: ${f.quote}` }, on: true })),
    ...input.turns.map((t) => ({ line: { kind: t.who === 'P' ? ('They' as const) : ('Me' as const), text: t.text }, on: t.who === 'Y' })),
  ];
  const out = h('pre', { class: 'outgoing', id: 'summary-outgoing' });
  const count = h('span', { class: 'muted', id: 'summary-count' });
  const status = h('p', { class: 'note-line', role: 'status' });
  const result = h('div', { id: 'summary-result' });
  const send = h('button', { class: 'btn primary', id: 'summary-send' }, 'Send the ticked lines and summarise');
  const local = h('button', { class: 'btn', id: 'summary-local', disabled: state.device !== 'available' }, 'Summarise on this device instead');
  const picked = () => items.filter((i) => i.on).map((i) => i.line);
  const refresh = () => {
    const lines = picked();
    out.textContent = lines.length ? summaryOutgoing(lines, state.config.cloudModel).user : '(nothing ticked: nothing will be sent)';
    count.textContent = `${lines.length} of ${items.length} lines ticked`;
    send.disabled = !lines.length || !state.config.cloudEnabled;
    local.disabled = !lines.length || state.device !== 'available';
  };

  const list = h(
    'ul',
    { class: 'tick-list', id: 'summary-lines' },
    items.map((it, i) => {
      const box = h('input', { type: 'checkbox', id: `line-${i}`, checked: it.on });
      box.addEventListener('change', () => ((it.on = box.checked), refresh()));
      return h('li', {}, h('label', { for: `line-${i}`, class: 'consent' }, box, h('span', {}, h('strong', {}, `${it.line.kind}: `), it.line.text)));
    }),
  );

  const show = (r: SummaryResult) => {
    const email = h('textarea', { class: 'text-input', rows: 6, id: 'summary-email', 'aria-label': 'Message to send' });
    email.value = r.summary.email;
    const copied = h('span', { class: 'muted', role: 'status' });
    const copy = h('button', { class: 'btn small' }, 'Copy the message');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(email.value);
        copied.textContent = 'Copied.';
      } catch {
        email.select();
        copied.textContent = 'Select and copy it.';
      }
    });
    const share = typeof navigator.share === 'function' ? h('button', { class: 'btn small' }, 'Share') : null;
    share?.addEventListener('click', () => navigator.share({ title: 'Conversation summary', text: `${r.summary.summary}\n\n${email.value}` }).catch(() => undefined));
    const keep = h('button', { class: 'btn small' }, 'Keep on this device');
    keep.addEventListener('click', () => {
      const all = load<object[]>('summaries', []);
      all.unshift({ date: new Date().toISOString().slice(0, 10), summary: r.summary });
      copied.textContent = save('summaries', all.slice(0, 20)) ? 'Kept on this device.' : 'This browser would not keep it.';
    });
    result.replaceChildren();
    append(result, [
      h('p', { class: 'where-line' }, r.source === 'in_cloud' ? `Written in the cloud in ${formatMs(r.ms)}. Sent: ${formatBytes(r.bytesOut)}, listed in the receipt.` : `Written on this device in ${formatMs(r.ms)}. Nothing was sent.`),
      h('section', { class: 'brief-card' }, h('h3', {}, 'Summary'), h('p', {}, r.summary.summary)),
      r.summary.decisions.length
        ? h('section', { class: 'brief-card' }, h('h3', {}, 'Decisions'), h('table', { class: 'receipt' }, h('thead', {}, h('tr', {}, h('th', {}, 'What'), h('th', {}, 'Who'), h('th', {}, 'Said'))), h('tbody', {}, r.summary.decisions.map((d) => h('tr', {}, h('td', {}, d.what), h('td', {}, d.who), h('td', {}, h('q', {}, d.quote)))))))
        : null,
      r.summary.followups.length ? h('section', { class: 'brief-card' }, h('h3', {}, 'Next steps'), h('ul', {}, r.summary.followups.map((f) => h('li', {}, `${f.what} (${f.when})`)))) : null,
      h('section', { class: 'brief-card' }, h('h3', {}, 'A message you could send'), email, h('div', { class: 'row', style: 'margin-top:8px' }, copy, share, keep, copied)),
      h('p', { class: 'muted' }, 'Sotto restates and asks. It does not advise. Check the summary against what was said.'),
    ]);
  };

  const run = async (where: 'cloud' | 'device') => {
    const lines = picked();
    if (!lines.length) return;
    send.disabled = local.disabled = true;
    status.textContent = where === 'cloud' ? 'Sending the ticked lines above…' : 'Writing the summary on this device…';
    try {
      const shown = summaryOutgoing(lines, state.config.cloudModel);
      const r = where === 'cloud' ? await summariseInCloud(ai, lines, state.config.cloudModel, async (o) => o.user === shown.user && o.system === shown.system, state.receipt) : await summariseOnDevice(ai, lines, state.receipt);
      status.textContent = '';
      show(r);
    } catch (e) {
      status.textContent = e instanceof CloudOffError ? 'Cloud steps are switched off right now.' : e instanceof CloudDeclinedError ? 'Nothing was sent.' : (e as Error).message;
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
      h('h1', {}, 'Summary'),
      h('p', { class: 'lede' }, 'Tick what may leave this device. By default: what you said and what was flagged. What they said leaves only if you tick it.'),
      h('div', { class: 'row' }, count),
      list,
      h('div', { class: 'outgoing-pane' }, h('p', { class: 'outgoing-title' }, 'Exactly this will be sent to the cloud, with short instructions:'), out),
      h('div', { class: 'row' }, send, local, h('button', { class: 'btn', id: 'summary-done', onclick: done }, 'Done')),
      status,
      result,
    ),
  );
  refresh();
}
