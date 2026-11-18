// Private mode's live backend: built only from device-only models (models.ts). Nothing here
// can reach the cloud: the pre-check, the post-check and the egress guard all apply.
import type { AI } from 'firebase/ai';
import { ASK_SCHEMA, ASK_SYSTEM, JARGON_SCHEMA, JARGON_SYSTEM, REPEAT_SCHEMA, REPEAT_SYSTEM } from '../core/prompts/ask';
import { COMPLETE_SCHEMA, COMPLETE_SYSTEM, SAY_SCHEMA, SAY_SYSTEM } from '../core/prompts/say';
import type { Receipt } from '../core/receipt';
import { createDeviceOnlyModel, type DeviceOnlyModel } from './models';
import type { LiveBackend } from './live';

export type PrivateBackend = LiveBackend & {
  /** A short prompt on each model so the first real call is not cold. Returns the time taken. */
  warm(): Promise<number>;
  /** Starts or awaits the model download (user gesture). */
  initialize(onProgress?: (f: number) => void): Promise<void>;
  /** One-shot helpers: word completions, repeat-it-back, jargon. */
  complete(prompt: string, signal: AbortSignal): Promise<string>;
  repeat(prompt: string, signal: AbortSignal): Promise<string>;
  jargon(prompt: string, signal: AbortSignal): Promise<string>;
};

export function createPrivateBackend(ai: AI, receipt: Receipt, env: object = globalThis): PrivateBackend {
  const say = createDeviceOnlyModel(ai, { system: SAY_SYSTEM, schema: SAY_SCHEMA }, env);
  const ask = createDeviceOnlyModel(ai, { system: ASK_SYSTEM, schema: ASK_SCHEMA }, env);
  let complete: DeviceOnlyModel | null = null;
  let repeat: DeviceOnlyModel | null = null;
  let jargon: DeviceOnlyModel | null = null;
  const once = async (m: DeviceOnlyModel, step: string, prompt: string, signal: AbortSignal) => {
    const r = await m.generate(prompt, signal);
    receipt.recordDevice({ step, mode: 'ONLY_ON_DEVICE', ms: r.ms });
    return r.text;
  };
  return {
    mode: 'ONLY_ON_DEVICE',
    say: (prompt, onText, signal) => say.stream(prompt, onText, signal),
    ask: (prompt, onText, signal) => ask.stream(prompt, onText, signal),
    async warm() {
      const t0 = performance.now();
      const ac = new AbortController();
      await say.generate('Situation: a conversation\nConversation (oldest first):\nP: Hello!\n\nSteer: none. Write the three options for what I say next.', ac.signal);
      const ms = performance.now() - t0;
      receipt.recordDevice({ step: 'warm-up', mode: 'ONLY_ON_DEVICE', ms });
      return ms;
    },
    initialize: (p) => say.initialize(p),
    complete(prompt, signal) {
      complete ??= createDeviceOnlyModel(ai, { system: COMPLETE_SYSTEM, schema: COMPLETE_SCHEMA }, env);
      return once(complete, 'complete', prompt, signal);
    },
    repeat(prompt, signal) {
      repeat ??= createDeviceOnlyModel(ai, { system: REPEAT_SYSTEM, schema: REPEAT_SCHEMA }, env);
      return once(repeat, 'repeat-back', prompt, signal);
    },
    jargon(prompt, signal) {
      jargon ??= createDeviceOnlyModel(ai, { system: JARGON_SYSTEM, schema: JARGON_SCHEMA }, env);
      return once(jargon, 'jargon', prompt, signal);
    },
  };
}
