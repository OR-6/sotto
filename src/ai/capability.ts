// On-device model capability detection. Feature detection only: nothing here runs inference.
//
// Why this file touches `LanguageModel` at all: in @firebase/ai 3.1.0 (firebase 13.4.0),
// `getGenerativeModel` only attaches its on-device adapter when `window.LanguageModel` is
// truthy. With no adapter, `callCloudOrDevice` sends the request to the cloud even in
// ONLY_ON_DEVICE mode (tests/sdk-fail-open.canary.test.ts). So before any live text goes near
// a device-only model, we confirm the global exists. This is a property check, not a call.

export class DeviceRuntimeMissingError extends Error {
  readonly code = 'sotto/device-runtime-missing';
  constructor() {
    super(
      'This browser does not expose the on-device model API (LanguageModel). ' +
        'Live help is off so that nothing said here can fall back to the cloud.',
    );
    this.name = 'DeviceRuntimeMissingError';
  }
}

/** True when the browser exposes the Prompt API global the SDK needs for on-device inference. */
export function deviceRuntimePresent(env: object = globalThis): boolean {
  const lm = (env as { LanguageModel?: { availability?: unknown } }).LanguageModel;
  // Stricter than the SDK's own `if (languageModel && mode)` condition.
  return typeof lm?.availability === 'function';
}

/** Throws unless the on-device runtime is present. Call before creating any device-only model. */
export function assertDeviceRuntime(env: object = globalThis): void {
  if (!deviceRuntimePresent(env)) throw new DeviceRuntimeMissingError();
}

// `LanguageModel.availability()` is the one direct Prompt API call allowed in this repo, and
// only in this file (check:ai enforces it). It runs no model and sends nothing. We ask only
// about English text in and out: asking about a language Chrome does not support aborts with
// a console error.

export type DeviceState = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'missing';

type LanguageModelLike = { availability: (o?: object) => Promise<string> };

export const EN_TEXT_ONLY = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

/** Reads the device model state without running inference. Never throws. */
export async function readDeviceState(env: object = globalThis): Promise<DeviceState> {
  if (!deviceRuntimePresent(env)) return 'missing';
  try {
    const a = await Promise.race([
      (env as { LanguageModel: LanguageModelLike }).LanguageModel.availability(EN_TEXT_ONLY),
      new Promise<string>((resolve) => setTimeout(() => resolve('unavailable'), 4000)),
    ]);
    return a === 'available' || a === 'downloadable' || a === 'downloading' ? a : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

/** What the app may offer, given the device state and the Remote Config kill switch. */
export type LivePlan = {
  /** Private-mode live help can run (possibly after a download the user starts). */
  privateLive: boolean;
  /** A click must first download the on-device model. */
  needsDownload: boolean;
  /** Cloud live mode can be offered (explicit, red banner). */
  cloudLive: boolean;
  /** Prepare, voice pack and summary can use the cloud. */
  cloudPrep: boolean;
};

export function planFor(state: DeviceState, cloudEnabled: boolean): LivePlan {
  const local = state === 'available' || state === 'downloadable' || state === 'downloading';
  return {
    privateLive: local,
    needsDownload: state === 'downloadable' || state === 'downloading',
    cloudLive: cloudEnabled,
    cloudPrep: cloudEnabled,
  };
}
