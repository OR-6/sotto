// Recorded on-device sessions: what a judge without the on-device model can replay.
// Every output in a replay came from the real on-device model, with its real timings.
import type { AskResult } from './prompts/ask';
import type { SayOption } from './prompts/say';

export type ReplayStep = {
  /** ms from the start of the recording when the partner line was entered. */
  at: number;
  partner: string;
  steer?: string;
  /** Say: the three options as shown. */
  options?: SayOption[];
  /** Ask: Means, Ask and the flag as shown. */
  ask?: AskResult;
  /** Time from the partner line to the first visible suggestion, and to all of it. */
  firstMs: number;
  totalMs: number;
  /** Which option the user chose (index), if any: becomes their reply. */
  chose?: number;
};

export type Replay = {
  kind: 'sotto-replay';
  version: 1;
  id: string;
  title: string;
  mode: 'say' | 'ask';
  pack: string;
  partner: string;
  recordedAt: string;
  browser: string;
  machine: string;
  steps: ReplayStep[];
  bytesOut: number;
};

export type ReplayScript = { id: string; title: string; mode: 'say' | 'ask'; pack: string; partner: string; lines: { partner: string; steer?: string; chose?: number }[] };

export const REPLAY_SCRIPTS: ReplayScript[] = [
  {
    id: 'cafe',
    title: 'At the café counter',
    mode: 'say',
    pack: 'cafe',
    partner: 'the barista',
    lines: [
      { partner: 'Hi there, what can I get you?', chose: 0 },
      { partner: 'Sure. Oat milk okay?', steer: 'cold', chose: 0 },
      { partner: 'Anything to eat with that?', chose: 1 },
      { partner: 'Can I get a name for the cup?', chose: 2 },
    ],
  },
  {
    id: 'clinic',
    title: 'Knee results with the orthopaedist',
    mode: 'ask',
    pack: 'doctor',
    partner: 'my doctor',
    lines: [
      { partner: 'The MRI shows a partial tear of the medial meniscus; we can try conservative management first.' },
      { partner: 'That means six weeks of physiotherapy, and we see how the knee responds.' },
      { partner: 'If it does not improve, we would consider an arthroscopy, which is keyhole surgery.' },
      { partner: 'I can book the physio referral today if you agree.' },
    ],
  },
  {
    id: 'landlord',
    title: 'The rent conversation',
    mode: 'ask',
    pack: 'landlord',
    partner: 'my landlord',
    lines: [
      { partner: 'Your rent goes up by 45 euros from the first of March.' },
      { partner: 'The service costs are also being recalculated, so there may be an extra charge.' },
      { partner: 'I need you to sign the renewal by the fifteenth, otherwise we treat it as a refusal.' },
    ],
  },
];

/** Validates a replay file before it is played (it is fetched data, so it is checked, then rendered as text). */
export function isReplay(x: unknown): x is Replay {
  const r = x as Replay;
  return !!r && r.kind === 'sotto-replay' && r.version === 1 && typeof r.id === 'string' && Array.isArray(r.steps) && r.steps.every((s) => typeof s.partner === 'string' && typeof s.at === 'number');
}
