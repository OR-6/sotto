// The receipt drawer, the Cloud live confirmation and the session stats.
import { computeStats } from '../core/stats';
import { formatBytes, formatMs, h } from './dom';
import { state } from './state';
import { save, load } from './store';

function dialog(id: string, title: string, body: HTMLElement[], onClose?: () => void): HTMLDialogElement {
  document.getElementById(id)?.remove();
  const close = h('button', { class: 'btn small', 'data-close': '' }, 'Close');
  const d = h('dialog', { id, 'aria-labelledby': `${id}-title` }, h('div', { class: 'dialog-head' }, h('h2', { id: `${id}-title` }, title), close), h('div', { class: 'dialog-body' }, ...body));
  close.addEventListener('click', () => d.close());
  d.addEventListener('close', () => {
    onClose?.();
    d.remove();
  });
  document.body.append(d);
  d.showModal();
  return d;
}

export function openReceipt(): void {
  const r = state.receipt;
  const rows = r.steps.map((s) =>
    h(
      'tr',
      {},
      h('td', { class: 'tabular' }, String(s.n)),
      h('td', {}, s.step),
      h('td', {}, s.where === 'on_device' ? 'On this device' : s.where === 'in_cloud' ? 'In the cloud' : s.where === 'blocked' ? 'Blocked' : 'Failed'),
      h('td', { class: 'tabular' }, s.mode),
      h('td', { class: 'tabular' }, formatMs(s.ms)),
      h('td', { class: 'tabular' }, formatBytes(s.bytesOut)),
      h('td', { class: 'hash' }, s.sha256 ? s.sha256.slice(0, 16) + '…' : ''),
    ),
  );
  const cloudSteps = r.steps.filter((s) => s.outgoing);
  const download = h('button', { class: 'btn small' }, 'Download the receipt');
  download.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(r.toJSON(), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `sotto-receipt-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  });
  dialog('receipt', 'Receipt', [
    h('p', { class: 'big-number tabular', id: 'bytes-sent' }, `Bytes sent this session: ${r.bytesOut}`),
    h(
      'p',
      { class: 'muted' },
      state.cloudLive
        ? 'Cloud live mode is on: live lines may be sent. Each one that left is listed below with its size and hash.'
        : 'In Private mode every live step runs on this device. Cloud steps happen only when you approve the exact text, and are listed here with what was sent.',
    ),
    r.steps.length
      ? h('table', { class: 'receipt' }, h('thead', {}, h('tr', {}, ...['#', 'Step', 'Where', 'Mode', 'Time', 'Sent', 'SHA-256'].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, rows))
      : h('p', {}, 'Nothing has run yet.'),
    ...cloudSteps.map((s) => h('details', {}, h('summary', {}, `What step ${s.n} sent (${formatBytes(s.bytesOut)})`), h('pre', { style: 'white-space:pre-wrap' }, s.outgoing ?? ''))),
    h('p', { class: 'muted' }, 'The receipt stays in this tab. It is never uploaded and is gone when you close the page, unless you download it.'),
    h('div', { class: 'row' }, download),
  ]);
}

export function confirmCloudLive(onYes: () => void): void {
  const yes = h('button', { class: 'btn danger', id: 'cloud-yes' }, 'Turn on for this session');
  const no = h('button', { class: 'btn primary', id: 'cloud-no' }, 'Keep Private mode');
  const d = dialog('cloud-confirm', 'Cloud live mode', [
    h('p', {}, 'This browser cannot run the on-device model, so live help would have to use the cloud.'),
    h('p', {}, 'With Cloud live mode on, what is said in this conversation is sent to Google\'s Gemini, for this session only. A red banner stays on every screen, including the side the other person sees.'),
    h('p', { class: 'muted' }, 'Tell the other person before you turn it on. Prepare and the summary never need it.'),
    h('div', { class: 'row' }, no, yes),
  ]);
  yes.addEventListener('click', () => {
    d.close();
    onYes();
  });
  no.addEventListener('click', () => d.close());
}

export function openStats(onAgain: () => void, onHome: () => void): void {
  const s = computeStats(state.answers);
  const saved = h('p', { class: 'muted', role: 'status' });
  const saveBtn = h('button', { class: 'btn small' }, 'Save these numbers');
  saveBtn.addEventListener('click', () => {
    const all = load<object[]>('stats', []);
    all.push({ date: new Date().toISOString().slice(0, 10), answers: s.answers, medianMs: s.medianMs, wpm: s.wpm });
    saved.textContent = save('stats', all.slice(-50)) ? 'Saved on this device (numbers only, no words).' : 'This browser would not save it.';
  });
  const again = h('button', { class: 'btn primary', id: 'again' }, 'New conversation');
  const home = h('button', { class: 'btn small' }, 'Start screen');
  const stat = (n: string, l: string) => h('div', { class: 'stat' }, h('div', { class: 'n tabular' }, n), h('div', { class: 'l' }, l));
  const d = dialog('stats', 'This conversation', [
    s.answers
      ? h('p', { style: 'font-size:22px;margin-top:0' }, `You answered ${s.answers} ${s.answers === 1 ? 'time' : 'times'}, in ${formatMs(s.medianMs)} on average, about ${s.wpm} words a minute.`)
      : h('p', {}, 'No answers this time.'),
    h('div', { class: 'stats-grid' }, stat(String(s.answers), 'answers'), stat(formatMs(s.medianMs), 'median time to answer'), stat(String(s.wpm), 'words a minute'), stat(formatBytes(state.receipt.bytesOut), 'sent from this device')),
    h('p', { class: 'muted' }, 'For comparison: people typing on a communication device usually manage about 8 to 15 words a minute; conversation runs at 120 to 150.'),
    h('div', { class: 'row' }, again, saveBtn, home),
    saved,
  ]);
  again.addEventListener('click', () => (d.close(), onAgain()));
  home.addEventListener('click', () => (d.close(), onHome()));
}
