// The receipt drawer, the Cloud live confirmation and the session stats.
import { computeStats } from '../core/stats';
import { formatBytes, formatMs, h } from './dom';
import { state } from './state';
import { save, load } from './store';
import { egressGuard } from '../ai/install-guard';
import { percentile } from '../core/stats';

function dialog(id: string, title: string, body: (HTMLElement | null)[], onClose?: () => void): HTMLDialogElement {
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

const MODE_LABEL: Record<string, string> = { ONLY_ON_DEVICE: 'Device only', PREFER_ON_DEVICE: 'Device first', PREFER_IN_CLOUD: 'Cloud first', ONLY_IN_CLOUD: 'Cloud only' };

export function openReceipt(): void {
  const r = state.receipt;
  const hasHash = r.steps.some((s) => s.sha256);
  const rows = r.steps.map((s) =>
    h(
      'tr',
      {},
      h('td', { class: 'tabular' }, String(s.n)),
      h('td', {}, s.step),
      h('td', {}, s.where === 'on_device' ? 'On this device' : s.where === 'in_cloud' ? 'In the cloud' : s.where === 'blocked' ? 'Blocked' : 'Failed'),
      h('td', {}, MODE_LABEL[s.mode] ?? s.mode),
      h('td', { class: 'tabular' }, formatMs(s.ms)),
      h('td', { class: 'tabular' }, formatBytes(s.bytesOut)),
      hasHash ? h('td', { class: 'hash' }, s.sha256 ? s.sha256.slice(0, 16) + '…' : '') : null,
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
    h('p', { class: 'big-number tabular', id: 'bytes-sent' }, r.bytesOut ? `Sent this session: ${formatBytes(r.bytesOut)}` : 'Nothing sent this session'),
    h(
      'p',
      { class: 'muted' },
      state.cloudLive
        ? 'Cloud live mode is on: every line said here is sent to Google. Each one is listed below with its size and hash.'
        : 'In Private mode every live step runs on this device. Cloud steps happen only when you approve the exact text, and are listed here with what was sent.',
    ),
    r.steps.length
      ? h('div', { class: 'table-scroll' }, h('table', { class: 'receipt' }, h('thead', {}, h('tr', {}, ...['#', 'Step', 'Where', 'Mode', 'Time', 'Sent', ...(hasHash ? ['SHA-256'] : [])].map((x) => h('th', { scope: 'col' }, x)))), h('tbody', {}, rows)))
      : h('p', {}, 'Nothing has run yet.'),
    ...cloudSteps.map((s) => h('details', {}, h('summary', {}, `What step ${s.n} sent (${formatBytes(s.bytesOut)})`), h('pre', { style: 'white-space:pre-wrap' }, s.outgoing ?? ''))),
    otherRequests(),
    state.cloudLive ? h('p', { class: 'muted' }, 'In Cloud live mode the receipt holds what was said. A download puts that on this device as a file.') : null,
    h('p', { class: 'muted' }, 'The receipt stays in this tab. It is never uploaded and is gone when you close the page, unless you download it.'),
    h('div', { class: 'row' }, download),
  ]);
}

const PURPOSE: Record<string, string> = {
  'firebaseinstallations.googleapis.com': 'an app instance id, needed by Remote Config',
  'firebaseremoteconfig.googleapis.com': 'settings: the cloud model name and the cloud on/off switch',
  'content-firebaseappcheck.googleapis.com': 'App Check: proves this is the real app before any cloud step',
  'www.google.com': 'reCAPTCHA, used by App Check',
  'www.gstatic.com': 'reCAPTCHA script, used by App Check',
};

/** Every other request this page made, so "nothing you hear is sent" can be checked, not trusted. */
function otherRequests(): HTMLElement {
  const rows = [...egressGuard.others.entries()];
  return h(
    'details',
    { id: 'other-requests' },
    h('summary', {}, `Other requests this page made: ${rows.reduce((n, [, v]) => n + v.count, 0)} (none carry anything said)`),
    rows.length
      ? h('table', { class: 'receipt' }, h('tbody', {}, rows.map(([host, v]) => h('tr', {}, h('td', {}, host), h('td', {}, PURPOSE[host] ?? 'app infrastructure'), h('td', { class: 'tabular' }, `${v.count} ${v.count === 1 ? 'request' : 'requests'}, ${formatBytes(v.bytes)}`)))))
      : h('p', {}, 'None.'),
  );
}

export function confirmCloudLive(deviceCanRun: boolean, onYes: () => void): void {
  const yes = h('button', { class: 'btn danger', id: 'cloud-yes' }, 'Turn on for this session');
  const no = h('button', { class: 'btn primary', id: 'cloud-no' }, 'Keep Private mode');
  const d = dialog('cloud-confirm', 'Cloud live mode', [
    h('p', {}, deviceCanRun ? 'This browser can make suggestions on its own. Private mode is the better choice here.' : 'This browser cannot make suggestions on its own, so they would have to come from Google.'),
    h('p', {}, 'With Cloud live mode on, everything said in this conversation is sent to Google\'s Gemini service, for this session only. Google\'s terms decide how long it is kept. A red banner stays on both sides of the screen.'),
    h('p', { class: 'muted' }, 'Tell the other person before you turn it on. Do not use it for health details you would not email. Prepare and the summary never need it.'),
    h('div', { class: 'row' }, no, yes),
  ]);
  yes.addEventListener('click', () => {
    d.close();
    onYes();
  });
  no.addEventListener('click', () => d.close());
}

export function openStats(onAgain: () => void, onHome: () => void, onSummary?: () => void, onBack?: () => void): void {
  const s = computeStats(state.answers);
  const times = state.answers.filter((a) => a.via !== 'hold').map((a) => a.answeredAt - a.askedAt);
  const p90 = percentile(times, 90);
  // A words-per-minute figure from a handful of taps is noise; show it only with enough data.
  const enough = s.answers >= 5 && times.reduce((a, b) => a + b, 0) >= 20_000;
  const saved = h('p', { class: 'muted', role: 'status' });
  const saveBtn = h('button', { class: 'btn small' }, 'Save these numbers');
  saveBtn.addEventListener('click', () => {
    const all = load<object[]>('stats', []);
    all.push({ date: new Date().toISOString().slice(0, 10), answers: s.answers, medianMs: s.medianMs, wpm: s.wpm });
    saved.textContent = save('stats', all.slice(-50)) ? 'Saved on this device (numbers only, no words).' : 'This browser would not save it.';
  });
  const again = h('button', { class: 'btn primary', id: 'again' }, 'Clear and start again');
  const summary = onSummary ? h('button', { class: 'btn', id: 'to-summary' }, 'Write a summary') : null;
  const home = h('button', { class: 'btn small' }, 'Clear and go home');
  const back = onBack ? h('button', { class: 'btn small', id: 'keep-talking' }, 'Keep talking') : null;
  const stat = (n: string, l: string) => h('div', { class: 'stat' }, h('div', { class: 'n tabular' }, n), h('div', { class: 'l' }, l));
  const d = dialog('stats', 'This conversation', [
    s.answers
      ? h('p', { style: 'font-size:22px;margin-top:0' }, `You answered ${s.answers} ${s.answers === 1 ? 'time' : 'times'}. Half your answers came within ${formatMs(s.medianMs)}${enough ? `, about ${s.wpm} words a minute while answering` : ''}.`)
      : h('p', {}, 'No answers this time.'),
    s.answers
      ? h('div', { class: 'stats-grid' }, stat(String(s.answers), 'answers'), stat(formatMs(s.medianMs), 'median time to answer'), times.length >= 3 ? stat(formatMs(p90), '9 in 10 answers within') : null, enough ? stat(String(s.wpm), 'words a minute while answering') : null, stat(formatBytes(state.receipt.bytesOut), 'sent by Sotto this session'))
      : null,
    enough ? h('p', { class: 'muted' }, 'For context: typing on a communication device is often 8 to 15 words a minute, and speech 120 to 150.') : h('p', { class: 'muted' }, 'Words a minute appear after five answers and twenty seconds of answering.'),
    onSummary ? h('p', { class: 'muted' }, 'Ending clears what was said. Write a summary first to keep it.') : null,
    h('div', { class: 'row' }, back, summary, again, saveBtn, home),
    saved,
  ]);
  again.addEventListener('click', () => (d.close(), onAgain()));
  summary?.addEventListener('click', () => (d.close(), onSummary!()));
  home.addEventListener('click', () => (d.close(), onHome()));
  back?.addEventListener('click', () => (d.close(), onBack!()));
}
