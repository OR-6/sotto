// The only place device-only models are created (invariant I1).
// Cloud-capable models are created only in cloud.ts (I2). check:ai enforces both.
import {
  getGenerativeModel,
  InferenceMode,
  InferenceSource,
  type AI,
  type GenerateContentResult,
  type LanguageModelPromptOptions,
  type OnDeviceParams,
} from 'firebase/ai';
import { assertDeviceRuntime, EN_TEXT_ONLY } from './capability';

export class LeakDetectedError extends Error {
  readonly code = 'sotto/leak-detected';
  constructor(readonly inferenceSource: string | undefined) {
    super(
      `A device-only step reported inferenceSource=${String(inferenceSource)}, not on_device. ` +
        'The result was discarded. The egress guard blocks the network, so nothing left the device.',
    );
    this.name = 'LeakDetectedError';
  }
}

export type DeviceCall = { text: string; ms: number; firstMs: number; source: string };

export type DeviceOnlyModel = {
  /** Runs one prompt on device. Throws unless the SDK reports it ran on device. */
  generate(prompt: string, signal?: AbortSignal): Promise<DeviceCall>;
  /**
   * Streams one prompt on device. `onText` receives the accumulated text so far, and is only
   * ever called after the source was confirmed on device. Throws like `generate`.
   */
  stream(prompt: string, onText: (soFar: string) => void, signal?: AbortSignal): Promise<DeviceCall>;
  /** Starts or awaits the on-device model download. Must run on a user gesture. */
  initialize(onProgress?: (fraction: number) => void): Promise<void>;
};

export type DeviceModelSpec = {
  /** The system prompt. On device it must go in initialPrompts: a request-level systemInstruction is dropped. */
  system: string;
  /** JSON Schema for `responseConstraint`, or undefined for free text. */
  schema?: object;
};

export const abortError = () => new DOMException('The call was superseded.', 'AbortError');

/**
 * Creates a model that can only run on device.
 * 1. Pre-check: refuses to build the model when `LanguageModel` is missing, because the SDK
 *    would then silently route ONLY_ON_DEVICE to the cloud.
 * 2. Post-check: every result must report `inferenceSource === on_device`, before any text is used.
 * 3. The egress guard (egress-guard.ts) is the third layer, at the network.
 */
export function createDeviceOnlyModel(ai: AI, spec: DeviceModelSpec, env: object = globalThis): DeviceOnlyModel {
  assertDeviceRuntime(env);
  const promptOptions: { responseConstraint?: object; signal?: AbortSignal } = spec.schema ? { responseConstraint: spec.schema } : {};
  const onDeviceParams: OnDeviceParams = {
    createOptions: {
      ...EN_TEXT_ONLY,
      initialPrompts: [{ role: 'system', content: [{ type: 'text', value: spec.system }] }],
    },
    promptOptions: promptOptions as LanguageModelPromptOptions,
  };
  const model = getGenerativeModel(ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams });

  // The SDK passes `promptOptions` by reference to Chrome's on-device prompt call, so a per-call
  // signal set here really cancels the on-device call (tests/models.test.ts proves it).
  const withSignal = (signal?: AbortSignal) => {
    if (signal) promptOptions.signal = signal;
    else delete promptOptions.signal;
  };
  const check = (source: string | undefined) => {
    if (source !== InferenceSource.ON_DEVICE) throw new LeakDetectedError(source);
  };

  return {
    async generate(prompt, signal) {
      assertDeviceRuntime(env); // the global could disappear between creation and use
      if (signal?.aborted) throw abortError();
      withSignal(signal);
      const t0 = performance.now();
      const result: GenerateContentResult = await model.generateContent(prompt);
      check(result.response.inferenceSource);
      const ms = performance.now() - t0;
      return { text: result.response.text(), ms, firstMs: ms, source: String(result.response.inferenceSource) };
    },
    async stream(prompt, onText, signal) {
      assertDeviceRuntime(env);
      if (signal?.aborted) throw abortError();
      withSignal(signal);
      const t0 = performance.now();
      const { stream, response } = await model.generateContentStream(prompt);
      // If we stop early (superseded or post-check), the aggregate promise rejects unobserved.
      response.catch(() => undefined);
      let text = '';
      let firstMs = 0;
      for await (const chunk of stream) {
        check(chunk.inferenceSource);
        if (signal?.aborted) throw abortError();
        const piece = chunk.text();
        if (piece && !firstMs) firstMs = performance.now() - t0;
        text += piece;
        onText(text);
      }
      const final = await response;
      check(final.inferenceSource);
      return { text, ms: performance.now() - t0, firstMs: firstMs || performance.now() - t0, source: String(final.inferenceSource) };
    },
    initialize(onProgress) {
      return model.initializeDeviceModel(onProgress);
    },
  };
}
