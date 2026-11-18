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
| [src/ai/capability.ts:95](../src/ai/capability.ts#L95) | `LanguageModel.availability()`: feature detection only, no inference (the one direct Prompt API call) |
| [src/ai/cloud.ts:18](../src/ai/cloud.ts#L18) | inference mode `InferenceMode.PREFER_IN_CLOUD` |
| [src/ai/cloud.ts:19](../src/ai/cloud.ts#L19) | inference mode `InferenceMode.ONLY_IN_CLOUD` |
| [src/ai/cloud.ts:20](../src/ai/cloud.ts#L20) | inference mode `InferenceMode.PREFER_ON_DEVICE` |
| [src/ai/cloud.ts:101](../src/ai/cloud.ts#L101) | `getGenerativeModel`: creates a model |
| [src/ai/cloud.ts:106](../src/ai/cloud.ts#L106) | cloud structured output (`responseSchema`) |
| [src/ai/cloud.ts:111](../src/ai/cloud.ts#L111) | on-device structured output (`responseConstraint`) |
| [src/ai/cloud.ts:125](../src/ai/cloud.ts#L125) | `generateContent`: **runs inference** |
| [src/ai/cloud.ts:126](../src/ai/cloud.ts#L126) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:57](../src/ai/models.ts#L57) | on-device structured output (`responseConstraint`) |
| [src/ai/models.ts:65](../src/ai/models.ts#L65) | `getGenerativeModel`: creates a model |
| [src/ai/models.ts:65](../src/ai/models.ts#L65) | inference mode `InferenceMode.ONLY_ON_DEVICE` |
| [src/ai/models.ts:92](../src/ai/models.ts#L92) | `generateContent`: **runs inference** |
| [src/ai/models.ts:93](../src/ai/models.ts#L93) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:95](../src/ai/models.ts#L95) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:102](../src/ai/models.ts#L102) | `generateContentStream`: **runs inference, streaming** |
| [src/ai/models.ts:108](../src/ai/models.ts#L108) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:116](../src/ai/models.ts#L116) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:117](../src/ai/models.ts#L117) | `inferenceSource` read (Receipt / post-check) |
| [src/ai/models.ts:121](../src/ai/models.ts#L121) | `initializeDeviceModel`: prepares / downloads the on-device model (on a user click) |
| [src/firebase.ts:36](../src/firebase.ts#L36) | `getAI`: creates the AI Logic service (Gemini Developer API backend, limited-use App Check tokens) |
| [src/firebase.ts:67](../src/firebase.ts#L67) | `getAI`: creates the AI Logic service (Gemini Developer API backend, limited-use App Check tokens) |
