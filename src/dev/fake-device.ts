// DEV ONLY (never in a production build: main.ts imports this behind import.meta.env.DEV).
// Installs a scripted stand-in for Chrome's LanguageModel so the UI can be driven in a browser
// without the on-device model. A red "fake model" badge is always shown while it is active.

const say = (line: string) => {
  const l = line.toLowerCase();
  if (/oat|milk/.test(l)) return ['Oat is perfect, thanks', 'Regular milk is fine', 'Do you have almond?'];
  if (/get you|order|what can i/.test(l)) return ['A flat white, please', 'Just a tea for me', 'What do you recommend?'];
  if (/here or to go/.test(l)) return ['To go, please', 'For here, thanks', 'Is there a seat free?'];
  return ['Yes, that works for me', "No, I'd rather not", 'Can you tell me more?'];
};

function reply(prompt: string): string {
  const lastP = [...prompt.matchAll(/^P: (.*)$/gm)].at(-1)?.[1] ?? '';
  const steer = prompt.match(/Steer: ([^.\n]+)\./)?.[1];
  if (/Explain the last P line/.test(prompt)) {
    return JSON.stringify({ means: 'They found a small tear in the knee cartilage and want to try rest and physio first.', ask: 'How long before we know if physio is working?', flag: { kind: /first/.test(lastP) ? 'decision' : 'none', quote: /first/.test(lastP) ? 'try conservative management first' : '' } });
  }
  if (/confirming sentence/.test(prompt)) return JSON.stringify({ line: 'So physio comes first, and surgery only if it does not help?' });
  if (/completions/.test(prompt)) {
    const typed = prompt.match(/I am typing: (.*)/)?.[1] ?? '';
    return JSON.stringify({ completions: [`${typed} please`, `${typed} for now`, `${typed} later`] });
  }
  let opts = say(lastP);
  if (steer && steer !== 'none') opts = steer === 'cold' ? ['An iced latte, please', 'Iced tea for me', 'Any cold brew today?'] : opts.map((o) => `${o}, ${steer}`);
  return JSON.stringify({ options: [{ text: opts[0], kind: 'answer' }, { text: opts[1], kind: 'alternative' }, { text: opts[2], kind: 'question' }] });
}

const textOf = (contents: unknown) => JSON.stringify(contents).replace(/\\n/g, '\n');

export function installFakeDevice(delayMs = 700): void {
  const wait = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('aborted', 'AbortError'))), { once: true });
    });
  const LanguageModel = Object.assign(Function.prototype.bind.call(function () {}, null), {
    availability: async () => 'available',
    create: async () => ({
      prompt: async (contents: unknown, o?: { signal?: AbortSignal }) => (await wait(delayMs, o?.signal), reply(textOf(contents))),
      promptStreaming: (contents: unknown, o?: { signal?: AbortSignal }) => {
        const full = reply(textOf(contents));
        let i = 0;
        return new ReadableStream<string>({
          async pull(c) {
            await wait(i === 0 ? delayMs * 0.4 : 60, o?.signal);
            if (i >= full.length) return c.close();
            c.enqueue(full.slice(i, i + 24));
            i += 24;
          },
        });
      },
      destroy() {},
    }),
  });
  Object.defineProperty(window, 'LanguageModel', { value: LanguageModel, configurable: true });
  const badge = document.createElement('div');
  badge.textContent = 'DEV: fake on-device model';
  badge.setAttribute('style', 'position:fixed;bottom:8px;left:8px;z-index:99;background:#c62828;color:#fff;font:700 13px system-ui;padding:6px 10px;border-radius:8px');
  document.addEventListener('DOMContentLoaded', () => document.body.append(badge));
  if (document.body) document.body.append(badge);
}
