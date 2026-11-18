# Sotto

**The quiet voice beside you: live help in English conversations, on your device.**

Sotto listens to the people talking to you and, on your own device, gives you the one thing you need right now:

- **Say**, for people who cannot speak, or not fast enough (ALS, cerebral palsy, stroke, laryngectomy, situational mutism, a patient who is intubated): three things to say next, spoken aloud in one tap, with a big **Hold on** button that tells the other person a reply is coming.
- **Ask**, for anyone out of their depth (at the doctor, the landlord, the municipality, the bank, a school meeting): what the last sentence meant in plain words, the question to ask next, and a flag on deadlines, costs and decisions, kept in a list.

**The stance.** Sotto is for the person with less power in the room: the patient, the tenant, the one who cannot speak fast enough. It is not for cheating in interviews, winning arguments or recording anyone. It shows a visible listening state, records no audio, keeps nothing you did not save, and asks you to tell the other person it is listening.

## Why it is hybrid by nature

A live conversation copilot runs a model on every sentence said to you, hundreds of times an hour. In the cloud that is too slow, too costly, and unacceptable in a medical appointment. On the device it is fast, free and stays in the room. The cloud has a different job: before and after.

| When | Step | Firebase AI Logic inference mode | What leaves the device |
|---|---|---|---|
| Before | **Prepare**: a brief from one line you type (what will happen, words you will hear, questions people regret not asking) | `PREFER_IN_CLOUD`; the SDK falls back to a shorter on-device brief when offline | the one line, shown to you first, and nothing else |
| During | **Say** and **Ask**, word completions, "Repeat it back" | `ONLY_ON_DEVICE` with three guards (below) | nothing |
| During, only if you choose it | **Cloud live mode**, for a device without the on-device model, with a red banner on every screen including the other person's side | `PREFER_ON_DEVICE` | the conversation, for that session only |
| After | **Summary**: decisions, next steps and a message you could send | `PREFER_IN_CLOUD`, or on the device | only the lines you tick, shown to you first |

Every call site is listed in [docs/WHERE-AI-LOGIC-IS-USED.md](docs/WHERE-AI-LOGIC-IS-USED.md), generated from the source and checked in CI.

## How Private mode is enforced, and where it stops

- **A finding about the SDK.** In firebase 13.4.0 (`@firebase/ai` 3.1.0), a model created with `InferenceMode.ONLY_ON_DEVICE` in a browser with no `LanguageModel` global sends the request to the cloud and reports `inferenceSource: in_cloud`. [tests/sdk-fail-open.canary.test.ts](tests/sdk-fail-open.canary.test.ts) shows it against the SDK's browser bundle and will fail when the SDK changes.
- **Three guards against it** ([src/ai/models.ts](src/ai/models.ts), [src/ai/egress-guard.ts](src/ai/egress-guard.ts)): a pre-check that the on-device runtime exists before a model is built and before every call; a post-check of `inferenceSource` on every result and every streamed chunk before any text is used; and a network guard that rejects any request to a model host unless a one-shot permit for its exact text is armed. Only [src/ai/cloud.ts](src/ai/cloud.ts) arms permits, and only after you approved the exact text (`check:ai` enforces both).
- **Nothing cloud-side starts in Private mode.** App Check (reCAPTCHA Enterprise), Installations and Remote Config start on a separate Firebase app only when you open a cloud step ([src/firebase.ts](src/firebase.ts)). Text fields switch off browser spell check, writing suggestions and translation, which could send typed text to a server. A Content Security Policy names every host the page may contact.
- **Limits, stated:** [docs/privacy-model.md](docs/privacy-model.md) lists what is enforced, how, and where it stops.
- **The receipt** lists every model step, where it ran, and the bytes that actually left, counted at the network, with the SHA-256 of any text that left. It also lists every other request the page made. It stays in the tab.

## Try it

- **Desktop Chrome with the on-device model** (Gemini Nano through the Prompt API): Private mode, Say and Ask live, on-device speech where Chrome offers it.
- **Any other browser:** Say with quick phrases, Hold on and typed speech still works with nothing sent; **Replay** shows real on-device sessions with their timings; **Cloud live mode** is there if you choose it.
- **Ward mode** for a shared tablet (add `?ward` to the address): Private mode only, no cloud step offered, nothing read from or written to storage.
- Hosted URL: being set up.

## Run it

```bash
npm ci
cp .env.example .env   # a Firebase web app config; on-device steps need none
npm run dev
```

`npm run typecheck`, `npm test` (unit, property and guard tests), `npm run check` (AI routing, storage, secrets, copy, attribution) and `npm run build` run in CI. `npm run e2e` drives the built app in Chromium in two worlds (no model, and a scripted stand-in for the on-device API that the test injects), runs axe on every screen at 1440 and 390 px in light and dark, and asserts that no request reaches a model host in Private mode.

## Status and numbers

Built from scratch for #BuildHybridAI 2026. On-device latency and quality numbers will appear here with the machine and Chrome version named, from the bench in [docs/STEP0-REPORT.md](docs/STEP0-REPORT.md), and nothing else.

Sotto restates and asks. It does not advise.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
