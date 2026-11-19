// The live loop: partner turn in → cancel the stale call → compose → stream → filter → emit.
// The engine never decides where a call runs: it is handed a `LiveBackend`. In Private mode
// that backend is built only from device-only models (models.ts); Cloud live mode's backend
// comes from cloud.ts and exists only after the user's explicit per-session switch.
// Receipts: the engine records device steps; cloud.ts records every cloud-capable call itself.
import { composeAsk } from '../core/compose';
import { JSON_FORMAT, type SayFormat } from '../core/say-format';
import type { ContextInput, Tone } from '../core/context';
import { filterAsk, parseJson, sayOptionOk } from '../core/filter';
import type { AskResult } from '../core/prompts/ask';
import type { SayOption } from '../core/prompts/say';
import type { Receipt } from '../core/receipt';
import { partialAsk } from '../core/stream';
import { cleanLine, lastPartner, type Speaker, type Turn } from '../core/turns';

export type LiveMode = 'say' | 'ask';

/** One streamed call. `onText` gets the text so far; resolves with the full text and where it ran. */
export type StreamFn = (prompt: string, onText: (soFar: string) => void, signal: AbortSignal) => Promise<{ text: string; ms: number; source: string }>;

export type LiveBackend = {
  /** 'ONLY_ON_DEVICE' in Private mode, 'PREFER_ON_DEVICE' in Cloud live mode. Shown in the receipt. */
  readonly mode: string;
  /** How Say prompts are written and read for this backend (JSON when absent). */
  readonly sayFormat?: SayFormat;
  say: StreamFn;
  ask: StreamFn;
};

export type Chips = { situation: string; partner: string; tone: Tone; joke: boolean; brief: string; voice: string };

export type LiveEvent =
  | { type: 'turn'; turn: Turn }
  | { type: 'thinking'; mode: LiveMode; forTurn: number }
  | { type: 'say-partial'; texts: string[]; forTurn: number }
  | { type: 'say'; options: SayOption[]; forTurn: number; ms: number; source: string; padded: number }
  | { type: 'ask-partial'; means?: string; ask?: string; forTurn: number }
  | { type: 'ask'; result: AskResult; forTurn: number; ms: number; source: string }
  | { type: 'error'; mode: LiveMode; message: string; forTurn: number }
  /** A guard fired (leak, missing or non-native runtime, blocked request): live help stops for good. */
  | { type: 'stopped'; reason: string };

export type LiveOptions = {
  backend: LiveBackend;
  receipt: Receipt;
  budgetChars: number;
  now?: () => number;
};

export type Live = {
  readonly turns: readonly Turn[];
  mode: LiveMode;
  chips: Chips;
  /** A finished partner utterance (spoken or typed). Starts a call for the current mode. */
  partner(text: string, via?: Turn['via']): Turn | undefined;
  /** Something the user said (a tapped option, a quick phrase, typed text). No call is made. */
  user(text: string, via?: Turn['via']): Turn | undefined;
  /** Re-runs Say for the last partner turn with a steer word or two. */
  steer(words: string): void;
  /** Re-runs the current mode for the last partner turn. */
  refresh(): void;
  cancel(): void;
  on(fn: (e: LiveEvent) => void): () => void;
  clear(): void;
  setBackend(b: LiveBackend): void;
};


/** Speech finals this close together are one turn (a pause mid-sentence is not a new turn). */
export const MERGE_MS = 1500;

const GUARD_ERRORS = new Set(['LeakDetectedError', 'DeviceRuntimeMissingError', 'DeviceRuntimeNotNativeError', 'EgressBlockedError']);

export function createLive(opts: LiveOptions): Live {
  const now = opts.now ?? (() => Date.now());
  let backend = opts.backend;
  let turns: Turn[] = [];
  let id = 0;
  let inflight: AbortController | null = null;
  let steerWords = '';
  let stopped = false;
  const listeners = new Set<(e: LiveEvent) => void>();
  const emit = (e: LiveEvent) => listeners.forEach((fn) => fn(e));

  const live: Live = {
    get turns() {
      return turns;
    },
    mode: 'say',
    chips: { situation: '', partner: '', tone: 'neutral', joke: false, brief: '', voice: '' },
    partner(text, via = 'typed') {
      // Speech that resumes within 1.5 s of a final result is the same sentence: merge, do not start a new turn.
      const prev = turns.at(-1);
      if (via === 'speech' && prev && prev.who === 'P' && prev.via === 'speech' && now() - prev.at < MERGE_MS) {
        const merged: Turn = { ...prev, text: cleanLine(`${prev.text} ${text}`).slice(0, 1200), at: now() };
        turns = [...turns.slice(0, -1), merged];
        emit({ type: 'turn', turn: merged });
        run();
        return merged;
      }
      const t = add('P', text, via);
      if (t) {
        steerWords = '';
        run();
      }
      return t;
    },
    user(text, via = 'tap') {
      return add('Y', text, via);
    },
    steer(words) {
      steerWords = cleanLine(words).slice(0, 60);
      if (live.mode === 'say') run();
    },
    refresh() {
      run();
    },
    cancel() {
      inflight?.abort();
      inflight = null;
    },
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    clear() {
      live.cancel();
      turns = [];
      steerWords = '';
    },
    setBackend(b) {
      live.cancel();
      backend = b;
    },
  };

  function add(who: Speaker, text: string, via: Turn['via']): Turn | undefined {
    const clean = cleanLine(text);
    if (!clean) return undefined;
    const t: Turn = { id: ++id, who, text: clean.slice(0, 1200), at: now(), via };
    turns = [...turns, t];
    emit({ type: 'turn', turn: t });
    return t;
  }

  function context(): ContextInput {
    return { ...live.chips, turns, budgetChars: opts.budgetChars };
  }

  function run(): void {
    const last = lastPartner(turns);
    if (!last || stopped) return;
    inflight?.abort(); // one call in flight per session: the newest turn wins
    const ac = new AbortController();
    inflight = ac;
    const mode = live.mode;
    const forTurn = last.id;
    const b = backend;
    emit({ type: 'thinking', mode, forTurn });
    const current = () => inflight === ac && !ac.signal.aborted;

    if (mode === 'say') {
      const fmt = b.sayFormat ?? JSON_FORMAT;
      const prompt = fmt.compose(context(), steerWords);
      let shown = 0;
      b.say(
        prompt,
        (soFar) => {
          if (!current()) return;
          // Partials pass the same per-option rules as the final result before they are shown.
          const texts = fmt.partial(soFar).filter((t) => sayOptionOk(t, last.text));
          if (texts.length > shown) {
            shown = texts.length;
            emit({ type: 'say-partial', texts, forTurn });
          }
        },
        ac.signal,
      ).then(
        (r) => {
          if (b.mode === 'ONLY_ON_DEVICE') opts.receipt.recordDevice({ step: steerWords ? 'say (steered)' : 'say', mode: b.mode, ms: r.ms });
          if (!current()) return;
          const f = fmt.final(r.text, last.text);
          inflight = null;
          emit({ type: 'say', options: f.options, forTurn, ms: r.ms, source: r.source, padded: f.padded });
        },
        (e) => fail(e, mode, forTurn, ac),
      );
    } else {
      const prompt = composeAsk(context());
      b.ask(
        prompt,
        (soFar) => {
          if (!current()) return;
          const p = partialAsk(soFar);
          if (!p.means) return;
          // A partial Means passes the same rules as the final one (numbers, advice, length).
          const f = filterAsk({ means: p.means, ask: '', flag: { kind: 'none', quote: '' } }, last.text, live.chips.brief);
          if (f.result?.means) emit({ type: 'ask-partial', means: f.result.means, forTurn });
        },
        ac.signal,
      ).then(
        (r) => {
          if (b.mode === 'ONLY_ON_DEVICE') opts.receipt.recordDevice({ step: 'ask', mode: b.mode, ms: r.ms });
          if (!current()) return;
          inflight = null;
          const f = filterAsk(parseJson(r.text), last.text, live.chips.brief);
          if (f.result) emit({ type: 'ask', result: f.result, forTurn, ms: r.ms, source: r.source });
          else emit({ type: 'error', mode, message: 'No clear answer for that line. Ask them to say it another way.', forTurn });
        },
        (e) => fail(e, mode, forTurn, ac),
      );
    }
  }

  function fail(e: unknown, mode: LiveMode, forTurn: number, ac: AbortController) {
    if (GUARD_ERRORS.has(String((e as Error)?.name))) {
      // Never carry on after a guard fired: stop live help for the rest of this session.
      stopped = true;
      inflight = null;
      opts.receipt.recordDevice({ step: mode, mode: backend.mode, ms: 0, where: 'blocked', note: String((e as Error)?.name) });
      emit({ type: 'stopped', reason: String((e as Error)?.message ?? e) });
      return;
    }
    if (ac.signal.aborted || inflight !== ac) return; // superseded by a newer call: say nothing
    inflight = null;
    if (backend.mode === 'ONLY_ON_DEVICE') opts.receipt.recordDevice({ step: mode, mode: backend.mode, ms: 0, where: 'failed', note: String((e as Error)?.name ?? 'Error') });
    emit({ type: 'error', mode, message: String((e as Error)?.message ?? e), forTurn });
  }

  return live;
}
