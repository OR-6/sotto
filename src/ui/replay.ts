// Replay: plays a session recorded on a laptop with the on-device model, with its real timings.
// Nothing runs live here; the label says so on every screen.
import { isReplay, REPLAY_SCRIPTS, type Replay, type ReplayStep } from '../core/replay';
import { formatMs, h, setText } from './dom';
import type { Nav } from './nav';

const nodes = (...xs: (Node | null)[]) => xs.filter((x): x is Node => x !== null);
const KIND = { answer: 'Answer', alternative: 'Another way', question: 'Question' } as const;

/** Loads the replays shipped with the app (same origin, static JSON). Invalid files are ignored. */
export async function loadReplays(): Promise<Replay[]> {
  const out: Replay[] = [];
  await Promise.all(
    REPLAY_SCRIPTS.map(async (s) => {
      try {
        const r = await fetch(`/replays/${s.id}.json`, { cache: 'no-cache' });
        if (!r.ok) return;
        const j: unknown = await r.json();
        if (isReplay(j)) out.push(j);
      } catch {
        /* not shipped */
      }
    }),
  );
  return REPLAY_SCRIPTS.map((s) => out.find((r) => r.id === s.id)).filter((r): r is Replay => !!r);
}

export function renderReplayList(root: HTMLElement, nav: Nav, replays: Replay[]): void {
  root.replaceChildren(
    h(
      'main',
      { class: 'choose', id: 'main' },
      h('h1', {}, 'Replay a real session'),
      h('p', { class: 'lede' }, 'These conversations were run through Sotto on a laptop with the on-device model. You see what it showed, when it showed it. Nothing runs live in a replay, and nothing is sent.'),
      h(
        'div',
        { class: 'modes' },
        replays.map((r) =>
          h(
            'button',
            { class: 'mode-card', 'data-replay': r.id, onclick: () => playReplay(root, nav, r) },
            h('span', { class: 'name' }, r.title),
            h('span', { class: 'for' }, r.mode === 'say' ? 'Say: for someone who cannot speak' : 'Ask: for someone out of their depth'),
            h('span', { class: 'what' }, `${r.steps.length} lines · ${r.browser} · ${r.machine} · ${r.recordedAt.slice(0, 10)}`),
          ),
        ),
      ),
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => nav.go('start') }, 'Back')),
    ),
  );
}

function playReplay(root: HTMLElement, nav: Nav, r: Replay): void {
  let i = -1;
  let timer = 0;
  let stopped = false;
  const label = h('div', { class: 'replay-label', role: 'note' }, `Recorded on-device session · ${r.browser} · ${r.machine} · ${r.recordedAt.slice(0, 10)} · nothing runs live`);
  const said = h('p', { class: 'last', id: 'replay-partner' });
  const steer = h('p', { class: 'note-line' });
  const timing = h('p', { class: 'note-line tabular', id: 'replay-timing' });
  const body = h('div', { id: 'replay-body' });
  const nextBtn = h('button', { class: 'btn primary', id: 'replay-next' }, 'Next line');
  const backBtn = h('button', { class: 'btn', onclick: () => ((stopped = true), window.clearTimeout(timer), nav.go('replay')) }, 'Other replays');

  const renderStep = (s: ReplayStep, phase: 'thinking' | 'first' | 'done') => {
    if (r.mode === 'say') {
      const opts = s.options ?? [];
      const show = phase === 'thinking' ? 0 : phase === 'first' ? 1 : 3;
      body.replaceChildren(
        ...nodes(h(
          'div',
          { class: 'options' },
          [0, 1, 2].map((k) => {
            const o = opts[k];
            const visible = o && k < show;
            return h('div', { class: `option${visible ? ' fresh' : ' skeleton'}${visible && phase === 'done' && s.chose === k ? ' said' : ''}` }, h('span', { class: 'key', 'aria-hidden': 'true' }, String(k + 1)), h('span', { class: 'kind' }, visible ? KIND[o.kind] : ''), h('span', { class: 'text' }, visible ? o.text : ''));
          }),
        ), phase === 'done' && s.chose !== undefined && opts[s.chose] ? h('p', { class: 'note-line' }, `Chosen and spoken: “${opts[s.chose].text}”`) : null),
      );
    } else {
      const a = s.ask;
      const ready = phase !== 'thinking' && a;
      body.replaceChildren(
        ...nodes(h('div', { class: `ask-card means${ready ? '' : ' skeleton'}` }, h('span', { class: 'label' }, 'Means'), h('p', { class: 'body' }, ready ? a!.means : '')),
        h('div', { class: `ask-card ask${ready && phase === 'done' ? '' : ' skeleton'}` }, h('span', { class: 'label' }, 'Ask'), h('p', { class: 'body' }, ready && phase === 'done' ? a!.ask : '')),
        ready && phase === 'done' && a!.flag.kind !== 'none' ? h('div', { class: 'flag' }, h('span', {}, `Flagged: ${a!.flag.kind}`), h('q', {}, a!.flag.quote)) : null),
      );
    }
  };

  const step = () => {
    window.clearTimeout(timer);
    i++;
    if (i >= r.steps.length) {
      setText(said, 'End of the recorded conversation.');
      body.replaceChildren(h('p', {}, `Bytes sent during the recording: ${r.bytesOut}.`));
      setText(timing, '');
      setText(steer, '');
      nextBtn.textContent = 'Play again';
      i = -1;
      return;
    }
    nextBtn.textContent = 'Next line';
    const s = r.steps[i];
    setText(said, s.partner);
    setText(steer, s.steer ? `Steered with “${s.steer}”` : '');
    setText(timing, '');
    renderStep(s, 'thinking');
    timer = window.setTimeout(() => {
      if (stopped) return;
      renderStep(s, 'first');
      timer = window.setTimeout(() => {
        if (stopped) return;
        renderStep(s, 'done');
        setText(timing, `First suggestion after ${formatMs(s.firstMs)}, all of it after ${formatMs(s.totalMs)}, on the device.`);
      }, Math.max(0, s.totalMs - s.firstMs));
    }, s.firstMs);
  };
  nextBtn.addEventListener('click', step);

  root.replaceChildren(
    h(
      'main',
      { class: 'choose replay', id: 'main' },
      label,
      h('h1', {}, r.title),
      h('section', { class: 'strip', 'aria-live': 'polite' }, h('span', { class: 'who' }, `${r.partner} said`), said, steer),
      body,
      timing,
      h('div', { class: 'row', style: 'margin-top:20px' }, nextBtn, backBtn),
    ),
  );
  step();
}
