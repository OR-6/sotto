// The Safety page: adversarial lines, outputs written to probe the rules, and what Sotto shows.
// With the on-device model, the same lines also run through the real model.
import { RED_CASES, runRedCase, type RedCase } from '../core/redteam';
import { append, h } from './dom';
import type { Nav } from './nav';

export type SafetyDeps = { live?: (c: RedCase) => Promise<{ kept: string[]; dropped: string[]; ms: number }> };

export function renderSafety(root: HTMLElement, nav: Nav, deps: SafetyDeps): void {
  const list = (xs: string[], empty: string) => (xs.length ? h('ul', {}, xs.map((x) => h('li', {}, x))) : h('p', { class: 'muted' }, empty));
  const rows = RED_CASES.map((c) => {
    const r = runRedCase(c);
    const liveOut = h('div', { class: 'red-live', id: `live-${c.id}` });
    return {
      c,
      liveOut,
      el: h(
        'section',
        { class: 'brief-card red-case', id: `case-${c.id}` },
        h('h2', { class: 'red-title' }, `${c.id} · ${c.mode === 'say' ? 'Say' : 'Ask'} · ${c.title}`),
        h('p', {}, h('strong', {}, 'They said: '), c.line),
        h('details', {}, h('summary', {}, 'The output used to probe the rules'), h('pre', { class: 'outgoing small' }, JSON.stringify(c.output, null, 1))),
        h('div', { class: 'red-cols' }, h('div', {}, h('strong', {}, 'Shown to the user'), list(r.kept, 'Nothing: the line gets no suggestion.')), h('div', {}, h('strong', {}, 'Removed'), list(r.dropped, 'Nothing removed.'))),
        h('p', { class: 'muted' }, c.expect),
        liveOut,
      ),
    };
  });
  const runBtn = deps.live ? h('button', { class: 'btn primary', id: 'red-run' }, 'Run these lines through the on-device model') : null;
  const status = h('p', { class: 'note-line', role: 'status' });
  runBtn?.addEventListener('click', async () => {
    runBtn.disabled = true;
    for (const row of rows) {
      status.textContent = `Running ${row.c.id} on this device…`;
      try {
        const r = await deps.live!(row.c);
        row.liveOut.replaceChildren();
        append(row.liveOut, [h('p', {}, h('strong', {}, `On-device model, ${(r.ms / 1000).toFixed(1)} s, after the filters:`)), list(r.kept, 'Nothing shown.'), r.dropped.length ? h('p', { class: 'muted' }, `Removed: ${r.dropped.join('; ')}`) : null]);
      } catch (e) {
        row.liveOut.replaceChildren(h('p', {}, `Could not run: ${(e as Error).message}`));
      }
    }
    status.textContent = 'Done. Nothing was sent.';
    runBtn.disabled = false;
  });

  root.replaceChildren(
    h(
      'main',
      { class: 'choose', id: 'main' },
      h('h1', {}, 'Safety rules, tested'),
      h(
        'p',
        { class: 'lede' },
        'Small models get things wrong. These are lines meant to make Sotto give advice, invent numbers, follow orders hidden in what someone says, or run code. Each comes with a bad output written to probe the rules, and what the user would actually see. The same cases run as automated tests.',
      ),
      runBtn ? h('div', { class: 'row' }, runBtn) : h('p', { class: 'muted' }, 'With the on-device model in this browser you could also run these lines through the real model here.'),
      status,
      h('div', { class: 'red-list' }, rows.map((r) => r.el)),
      h('div', { class: 'row', style: 'margin-top:20px' }, h('button', { class: 'btn', id: 'safety-back', onclick: () => nav.go('start') }, 'Back')),
    ),
  );
}
