# Where Firebase AI Logic is used

Every model call in Sotto goes through **Firebase AI Logic** (`firebase/ai`, hybrid inference). No other model API is called (enforced by `npm run check:ai`). This file is generated from the source by `npm run docs:ai`; `check:ai` fails if it is out of date.

## The split

| Step | Module | Inference mode | What the model sees | Where it runs |
|---|---|---|---|---|
| Live: Say, Ask, completions, repeat-back, jargon (Private mode) | [src/ai/models.ts](../src/ai/models.ts) `createDeviceOnlyModel` | `ONLY_ON_DEVICE` + runtime pre-check + `inferenceSource` post-check + egress guard | the last turns, chips, compact brief and voice digests | Gemini Nano in Chrome, on the device |
| Live in Cloud live mode (explicit, red banner) | [src/ai/cloud.ts](../src/ai/cloud.ts) `cloudCall` | `PREFER_ON_DEVICE` | the same | the device when it has the model, else the cloud; the receipt says which |
| Prepare (the brief) | [src/ai/cloud.ts](../src/ai/cloud.ts) `cloudCall` | `PREFER_IN_CLOUD`, falls back to a shorter on-device brief offline | the situation line the user typed, shown first | the cloud, or the device offline |
| Voice pack | [src/ai/cloud.ts](../src/ai/cloud.ts) `cloudCall` | `ONLY_IN_CLOUD` | the phrases and answers the user typed, shown first | the cloud |
| Summary | [src/ai/cloud.ts](../src/ai/cloud.ts) `cloudCall`, or on device | `PREFER_IN_CLOUD` or `ONLY_ON_DEVICE` | only the lines the user ticked, shown first | the cloud, or the device |
| Capability check | [src/ai/capability.ts](../src/ai/capability.ts) | none (no inference) | nothing | on the device |

Service setup: [src/firebase.ts](../src/firebase.ts) (`initializeApp`, App Check with reCAPTCHA Enterprise, `getAI` with `useLimitedUseAppCheckTokens: true`). Cloud model name and kill switch: Remote Config, [src/config.ts](../src/config.ts).

## Every call site (generated)

| Where | What |
|---|---|
| [src/ai/capability.ts:50](../src/ai/capability.ts#L50) | `LanguageModel.availability()`: feature detection only, no inference (the one direct Prompt API call) |
| [src/ai/cloud.ts:18](../src/ai/cloud.ts#L18) | inference mode `InferenceMode.PREFER_IN_CLOUD` |
| [src/ai/cloud.ts:19](../src/ai/cloud.ts#L19) | inference mode `InferenceMode.ONLY_IN_CLOUD` |
| [src/ai/cloud.ts:20](../src/ai/cloud.ts#L20) | inference mode `InferenceMode.PREFER_ON_DEVICE` |
| [src/ai/cloud.ts:100](../src/ai/cloud.ts#L100) | `getGenerativeModel`: creates a model |
| [src/ai/cloud.ts:105](../src/ai/cloud.ts#L105) | cloud structured output (`responseSchema`) |
| [src/ai/cloud.ts:110](../src/ai/cloud.ts#L110) | on-device structured output (`responseConstraint`) |
| [src/ai/cloud.ts:121](../src/ai/cloud.ts#L121) | `generateContent`: **runs inference** |
| [src/ai/cloud.ts:122](../src/ai/cloud.ts#L122) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:57](../src/ai/models.ts#L57) | on-device structured output (`responseConstraint`) |
| [src/ai/models.ts:65](../src/ai/models.ts#L65) | `getGenerativeModel`: creates a model |
| [src/ai/models.ts:65](../src/ai/models.ts#L65) | inference mode `InferenceMode.ONLY_ON_DEVICE` |
| [src/ai/models.ts:83](../src/ai/models.ts#L83) | `generateContent`: **runs inference** |
| [src/ai/models.ts:84](../src/ai/models.ts#L84) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:86](../src/ai/models.ts#L86) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:93](../src/ai/models.ts#L93) | `generateContentStream`: **runs inference, streaming** |
| [src/ai/models.ts:97](../src/ai/models.ts#L97) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:105](../src/ai/models.ts#L105) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:106](../src/ai/models.ts#L106) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:109](../src/ai/models.ts#L109) | `initializeDeviceModel`: prepares / downloads the on-device model (on a user click) |
| [src/firebase.ts:58](../src/firebase.ts#L58) | `getAI`: creates the AI Logic service (Gemini Developer API backend, limited-use App Check tokens) |
