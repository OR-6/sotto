# Sotto's privacy model: what is enforced, how, and where it stops

Sotto hears conversations: medical appointments, rent negotiations, a hospital room. This page states what it does with that, how the code enforces it, and the limits we know of. Every claim links to the code or test that backs it.

## What exists where

| Data | Where it lives | How long | Leaves the device? |
|---|---|---|---|
| Audio | the browser's own speech recogniser | milliseconds | Sotto never touches audio. It only starts recognition with `processLocally = true` and refuses a browser without local recognition ([src/speech/recognise.ts](../src/speech/recognise.ts)) |
| What was said (turns) | page memory | until the conversation ends | **never in Private mode**; in Cloud live mode, by your choice, for that session |
| Suggestions, Means, Ask, flags | page memory | until the conversation ends | only the lines you tick for a Summary |
| The line you type for Prepare; your voice-pack phrases | what you typed | until you send or leave | yes, shown to you first, exactly |
| Settings, phrases, kept briefs, voice pack, kept summaries, session numbers | this browser's storage | until you clear them | no |
| The receipt | page memory | until the conversation ends | never (you can download it) |

## The invariants and their enforcement

**I1. In Private mode, live text only ever enters an on-device model.**
- The Firebase AI Logic Web SDK in firebase 13.4.0 routes `ONLY_ON_DEVICE` to the cloud when the browser has no `LanguageModel` global ([tests/sdk-fail-open.canary.test.ts](../tests/sdk-fail-open.canary.test.ts)).
- Pre-check: the device-only factory refuses to build a model, and every call refuses to run, without the runtime ([src/ai/models.ts](../src/ai/models.ts), [src/ai/capability.ts](../src/ai/capability.ts)). The app also refuses a `LanguageModel` that is not the browser's native object.
- Post-check: every result and every streamed chunk must report `inferenceSource === on_device` before any text is used.
- Network: an egress guard wraps `fetch` and rejects any request to a model host unless a one-shot permit for its exact text is armed; only the cloud module arms permits ([src/ai/egress-guard.ts](../src/ai/egress-guard.ts)). Tested layer by layer in [tests/device-only.regression.test.ts](../tests/device-only.regression.test.ts).
- In Private mode the page makes **no request to any other site**: Firebase App Check, Installations and Remote Config start only on a separate Firebase app when you open a cloud step ([src/firebase.ts](../src/firebase.ts)). The end-to-end test asserts zero requests to model hosts at two sizes and two themes, and that suggestions keep coming with the network switched off.

**I2. Only one module can create a cloud-capable model, and it needs your approval of the exact text.**
- `check:ai` fails the build if any other file uses a cloud-capable inference mode or creates a model ([scripts/check-ai.mjs](../scripts/check-ai.mjs)).
- `cloudCall` asks for approval of the exact outgoing text before anything is built ([src/ai/cloud.ts](../src/ai/cloud.ts)). For Prepare, the voice pack and the Summary, the approval compares the request with the text shown in the outgoing pane on screen. For Cloud live mode, the approval is the per-session switch, with a red banner on every screen, including the side the other person sees.

**I3. The user decides what leaves.** Prepare sends the one line you typed. The Summary sends only the lines you tick. Ticked by default: your own lines and the flagged items, which quote the other person's exact words; their other lines only if you tick them. The voice pack sends only your phrases and five answers.

**I4. Everything that leaves is recorded.** The receipt counts bytes at the network (after a response came back), keeps the exact text and its SHA-256 for every cloud step, and lists every other request the page made, with its purpose ([src/core/receipt.ts](../src/core/receipt.ts), [src/ui/dialogs.ts](../src/ui/dialogs.ts)).

**I5. Cloud output is untrusted.** Every model output is validated against its schema, capped, and rendered as text only, never as markup ([src/ui/dom.ts](../src/ui/dom.ts)).

**I6. Nothing is kept that you did not save.** The conversation itself, the audio and the receipt are never stored; a summary you choose to keep holds the quotes you ticked. One module may touch storage, with an allow-list of keys that excludes transcripts and receipts ([src/ui/store.ts](../src/ui/store.ts), `check:storage`). "Clear everything" also deletes the identifiers and tokens the Firebase SDKs store once a cloud step ran.

## Browser features that could leak typed text

Enhanced spell check, writing suggestions and page translation can send text to a server. Every text field Sotto creates switches them off, the page says `translate="no"`, and `check:copy` fails on a field that does not ([src/ui/dom.ts](../src/ui/dom.ts)).

## Limits we know of

- **The native check is a hint, not proof.** It catches a page script or a careless extension defining `LanguageModel`; a determined extension can fake it. A browser extension with access to the page can read anything on screen anyway.
- **The egress guard wraps `fetch`, which is the only transport the AI Logic SDK uses for these calls.** It does not wrap XHR, `sendBeacon` or WebSocket. The Content Security Policy in [firebase.json](../firebase.json) limits `connect-src` to this origin and the named Firebase hosts, which also limits those.
- **On-device speech recognition is the browser's.** Sotto asks for local processing and refuses otherwise; it cannot inspect what the browser does inside.
- **Cloud live mode sends what is said** through Firebase AI Logic to the Gemini Developer API. Google's terms for that API decide how long it is kept. It is never the default, and the consent screen says so.
- **The partner did not install Sotto.** Sotto shows a listening state and a notice on the partner's side, records no audio, and asks the user to tell the other person, every visit. Recording-consent law varies; this is a product stance, not legal advice.

Sotto restates and asks. It does not advise.
