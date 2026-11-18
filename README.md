# Sotto

**The quiet voice beside you: live help in any conversation, on your device.**

Sotto listens to the people talking to you and, on your own device, gives you the one thing you need right now:

- **Say**, for people who cannot speak, or not fast enough (ALS, cerebral palsy, stroke, laryngectomy, situational mutism, an intubated patient): three sentences to say next, spoken aloud in one tap.
- **Ask**, for anyone out of their depth (at the doctor, the landlord, the municipality, the bank): what the last sentence meant in plain words, and the question to ask next.

**The stance.** Sotto is for the person who is the weaker party in the room. It is not for cheating in interviews, winning arguments or recording anyone. It shows a visible listening state, keeps nothing unless you save it, and in Private mode nothing it hears leaves your device.

## Why it is hybrid by nature

A live conversation copilot runs a model on every sentence said to you, hundreds of times an hour. In the cloud that is too slow, too costly and unacceptable for a medical appointment or a negotiation. On the device it is fast, free and stays in the room. So Sotto splits the work with Firebase AI Logic hybrid inference:

| Step | Inference mode | Where it runs |
|---|---|---|
| Live help (Say, Ask) in Private mode | `ONLY_ON_DEVICE`, plus a runtime pre-check, an `inferenceSource` post-check and a network egress guard | Gemini Nano in Chrome, on the device |
| Live help in Cloud live mode (explicit, per session, red banner) | `PREFER_ON_DEVICE` | the device when it has the model, else the cloud |
| Prepare: a brief before the conversation | `PREFER_IN_CLOUD`, shorter on-device brief when offline | the cloud, from the line you typed and saw first |
| Voice pack: suggestions that sound like you | `ONLY_IN_CLOUD` | the cloud, from phrases you chose |
| Summary after, only if you ask | `PREFER_IN_CLOUD` or on device | only the lines you tick |

Every call site is listed in [docs/WHERE-AI-LOGIC-IS-USED.md](docs/WHERE-AI-LOGIC-IS-USED.md), generated from the source.

## Status

Built from scratch for #BuildHybridAI 2026. This is early: the on-device engine, the guards and the measurement lab exist; the app screens are being built now. Measured numbers will appear here with the machine and browser named, and nothing else.

## Run it

```bash
npm ci
cp .env.example .env   # fill in a Firebase web app config; on-device runs need no config at all
npm run dev
```

Desktop Chrome with the on-device model (Gemini Nano through the Prompt API) is needed for live help in Private mode. `npm run typecheck`, `npm test`, `npm run check` and `npm run build` are what CI runs.

## Licence

Apache-2.0. See [LICENSE](LICENSE).
