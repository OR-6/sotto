// Test doubles. The fake LanguageModel below is a stand-in for Chrome's API so the SDK's
// device path can run in Node; it is not a call to the real Prompt API.
import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAI, GoogleAIBackend, type AI } from 'firebase/ai';

/** A synthetic live line (something the partner said). It must never reach the network. */
export const LIVE = 'The MRI shows a partial tear of the medial meniscus, Mr Example.';

export type Sent = { url: string; body: string };

export function cloudReply(text = 'cloud-reply', stream = false): Response {
  if (stream) {
    const chunk = JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, index: 0 }] });
    return new Response(`data: ${chunk}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function fakeNetwork(reply = 'cloud-reply') {
  const sent: Sent[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), body: typeof init?.body === 'string' ? init.body : '' });
    return cloudReply(reply, String(input).includes('streamGenerateContent'));
  }) as typeof globalThis.fetch;
  return { sent, fetch };
}

export type PromptRecord = { contents: unknown; options: { responseConstraint?: object; signal?: AbortSignal } | undefined; createOptions: unknown };

/**
 * A fake Chrome LanguageModel. `reply` may be a function of the prompt; `chunks` splits the
 * streaming reply; `delayMs` makes prompt() slow and abortable via the signal.
 */
export function fakeLanguageModel(availability = 'available', reply: string | ((text: string) => string) = 'device-reply', opts: { delayMs?: number; chunks?: number } = {}) {
  const calls: PromptRecord[] = [];
  const textOf = (contents: unknown) => JSON.stringify(contents);
  const answer = (contents: unknown) => (typeof reply === 'function' ? reply(textOf(contents)) : reply);
  const wait = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (!opts.delayMs) return resolve();
      const t = setTimeout(resolve, opts.delayMs);
      signal?.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('aborted', 'AbortError'))), { once: true });
    });
  const lm = {
    calls,
    availability: async () => availability,
    create: async (createOptions: unknown) => ({
      prompt: async (contents: unknown, options?: PromptRecord['options']) => {
        calls.push({ contents, options: options ? { ...options } : undefined, createOptions });
        await wait(options?.signal);
        return answer(contents);
      },
      promptStreaming: (contents: unknown, options?: PromptRecord['options']) => {
        calls.push({ contents, options: options ? { ...options } : undefined, createOptions });
        const full = answer(contents);
        const n = Math.max(1, opts.chunks ?? 3);
        const size = Math.ceil(full.length / n);
        let i = 0;
        return new ReadableStream<string>({
          async pull(controller) {
            await wait(options?.signal);
            if (i >= full.length) return controller.close();
            controller.enqueue(full.slice(i, i + size));
            i += size;
          },
        });
      },
      destroy() {},
    }),
  };
  return lm;
}

let n = 0;
export function makeAI(): { app: FirebaseApp; ai: AI; dispose: () => Promise<void> } {
  const app = initializeApp({ apiKey: 'fake-key', projectId: 'fake-project', appId: '1:1:web:1' }, `test-${n++}`);
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  return { app, ai, dispose: () => deleteApp(app) };
}

/** Sets the `window` the SDK inspects when a model is created. */
export function setWindow(w: object): void {
  (globalThis as { window?: object }).window = w;
}
