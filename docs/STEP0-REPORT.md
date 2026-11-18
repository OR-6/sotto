# Step zero: can Sotto work at all? (18 Nov 2026)

Four gates decide whether the live part of Sotto is real on the reference machine. Every number here is measured, with the machine and browser named; nothing is estimated.

| Gate | Question | Result |
|---|---|---|
| **G0** | Does the on-device model answer through Firebase AI Logic (`ONLY_ON_DEVICE`, `inferenceSource === on_device`), with the system prompt in `initialPrompts`, structured output through `responseConstraint`, and streaming? | **Pending**: needs the lab run in desktop Chrome with the model |
| **G1** | Is speech recognition local (`processLocally = true`, `SpeechRecognition.available()` → `available` after `install()`), and how long after the speaker stops does the final text arrive? | **Pending**: needs the lab run with a microphone |
| **G2** | Does the Say prompt return three valid options within 1.5 s (warm) on at least 16 of 20 partner lines? | **Pending**: the 20-line bench is ready in the lab |
| **G3** | Does App Check, enforced, let the hosted site call the cloud from a fresh browser, and refuse a call without a token? | **Pending**: needs the Firebase project and hosting site |

**Decision: pending G0 to G3.** Whatever the result, the typed partner already works, so a failed G1 moves speech to a later step and keeps the product.

## What is already verified (in code and tests, no model needed)

- **The SDK fail-open is real in firebase 13.4.0 (`@firebase/ai` 3.1.0).** With no `window.LanguageModel`, a model created with `InferenceMode.ONLY_ON_DEVICE` sends the request to the cloud anyway and reports `inferenceSource: in_cloud` (`tests/sdk-fail-open.canary.test.ts`, against the SDK's browser bundle). Sotto guards it three ways: a property pre-check before the model is built and before every call, the `inferenceSource` post-check before any text is used (also on every streamed chunk), and a network egress guard that rejects any request to an AI host unless a one-shot permit for its exact text is armed (`tests/device-only.regression.test.ts`).
- **Cancellation reaches the on-device prompt.** The SDK passes `onDeviceParams.promptOptions` by reference to Chrome's on-device prompt call, so a per-call `AbortSignal` set there really cancels a superseded call (tested).
- **`PREFER_IN_CLOUD` falls back to the device on a network failure**, as the docs say; Prepare relies on it offline (`tests/prepare.test.ts`).
- **A browser without the model gets no live help and sends nothing.** In an embedded Chromium 156 on the same Mac, which exposes `LanguageModel` but reports `unavailable`, `ONLY_ON_DEVICE` threw `API_NOT_ENABLED` and no request reached an AI host (`replays/step0-modes-browser-without-nano.json`).
- **The headless shell of Chromium crashes on `SpeechRecognition.available()`**; the end-to-end tests use full Chromium.

## The bench (what the lab measures)

- Warm-up: the first on-device call (session creation and model load), then a second call.
- The system prompt check: a system prompt that forces one word, to prove `initialPrompts` is honoured on device.
- Say: 20 partner lines across café, doctor, family, interview, landlord, bank, pharmacy, municipality and two strangers, two of them with a steer word, one an injection attempt. For each: time to the first complete option, time to all three, whether all three passed the filter without padding.
- Ask: 8 lines with deadlines, costs, decisions and a pressure question. For each: Means, Ask, the flag, and what the filter changed.
- The four modes on toy text ("Reply with exactly one word: pong"), each with its `inferenceSource`.
- Speech: six fixed sentences read aloud; the delay from the last interim result to the final one.

Results are written to `replays/step0-*.json` with the Chrome version and date.
