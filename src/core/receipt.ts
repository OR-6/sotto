// The session receipt (invariant I4): every model step, where it ran, how many bytes left
// the device and, for cloud steps only, the exact outgoing text and its SHA-256.
// On-device steps record no text at all: nothing left, so there is nothing to show.
// Lives in memory; downloadable as JSON; never uploaded, never persisted (I6).

export type Where = 'on_device' | 'in_cloud' | 'blocked' | 'failed';

export type ReceiptStep = {
  n: number;
  at: string;
  /** What the step was for: say, ask, complete, repeat, jargon, warmup, prepare, voice, summary. */
  step: string;
  /** The inference mode requested, e.g. ONLY_ON_DEVICE. */
  mode: string;
  where: Where;
  ms: number;
  /** Bytes of request body that left the device for this step. 0 for every on-device step. */
  bytesOut: number;
  /** Present only for cloud steps: the exact text the user approved and sent. */
  outgoing?: string;
  sha256?: string;
  note?: string;
};

export type Receipt = {
  readonly steps: readonly ReceiptStep[];
  readonly bytesOut: number;
  recordDevice(s: { step: string; mode: string; ms: number; where?: Where; note?: string }): ReceiptStep;
  /** `bytes` is what actually left (counted at the network); defaults to the text's length if it ran in the cloud. */
  recordCloud(s: { step: string; mode: string; ms: number; where: Where; outgoing: string; bytes?: number; note?: string }): Promise<ReceiptStep>;
  clear(): void;
  toJSON(): object;
};

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const byteLength = (s: string) => new TextEncoder().encode(s).length;

export function createReceipt(now: () => Date = () => new Date()): Receipt {
  let steps: ReceiptStep[] = [];
  let n = 0;
  const push = (s: Omit<ReceiptStep, 'n' | 'at'>) => {
    const step: ReceiptStep = { n: ++n, at: now().toISOString(), ...s };
    steps = [...steps, step];
    return step;
  };
  return {
    get steps() {
      return steps;
    },
    get bytesOut() {
      return steps.reduce((a, s) => a + s.bytesOut, 0);
    },
    recordDevice({ step, mode, ms, where = 'on_device', note }) {
      // Deliberately takes no text argument: a device step can never carry live text into the receipt.
      return push({ step, mode, where, ms: Math.round(ms), bytesOut: 0, ...(note ? { note } : {}) });
    },
    async recordCloud({ step, mode, ms, where, outgoing, bytes, note }) {
      const out = bytes ?? (where === 'in_cloud' ? byteLength(outgoing) : 0);
      const sent = out > 0;
      return push({
        step,
        mode,
        where,
        ms: Math.round(ms),
        bytesOut: out,
        ...(sent ? { outgoing, sha256: await sha256Hex(outgoing) } : {}),
        ...(note ? { note } : {}),
      });
    },
    clear() {
      steps = [];
      n = 0;
    },
    toJSON() {
      return { kind: 'sotto-receipt', version: 1, bytesOut: this.bytesOut, steps };
    },
  };
}
