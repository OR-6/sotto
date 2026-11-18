// End-to-end run of the built app in headless Chromium, plus screenshots of every screen.
//   node scripts/e2e.mjs [baseUrl] [shotsDir]
// Without a baseUrl it builds nothing: start `npx vite preview --port 4173` first, or pass the
// live URL. Two worlds are tested:
//   1. A browser with no on-device model (what most judges have): honest paths, no live help.
//   2. A browser with a scripted stand-in for Chrome's LanguageModel API, injected by the test
//      before the page loads. The app's real SDK path runs against it. The fake is test-only
//      and is never part of the app.
// Every run asserts that no request reached an AI host, runs axe on every screen, and checks
// there is no horizontal scrolling at phone width.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:4173';
const OUT = process.argv[3] ?? 'shots';
const AXE = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const AI_HOST = /firebasevertexai|generativelanguage|aiplatform/;
const failures = [];
const results = [];
const check = (cond, what) => {
  results.push({ ok: !!cond, what });
  if (!cond) failures.push(what);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};

// The stand-in for Chrome's Prompt API (test-only). Replies depend on the prompt.
const FAKE = `(() => {
  const reply = (p) => {
    const lastP = [...p.matchAll(/P: ([^\\n"]*)/g)].at(-1)?.[1] ?? '';
    if (/Explain the last P line/.test(p)) return JSON.stringify({ means: 'The cartilage in your knee is partly torn; they want to try rest and physio first.', ask: 'How long before we know if physio is working?', flag: { kind: 'decision', quote: 'try conservative management first' } });
    if (/confirming sentence/.test(p)) return JSON.stringify({ line: 'So physio comes first, and surgery only if it does not help?' });
    if (/completions/.test(p)) { const t = (p.match(/I am typing: ([^\\n"]*)/) || [])[1] || ''; return JSON.stringify({ completions: [t + ' please', t + ' for now', t + ' later'] }); }
    const steer = (p.match(/Steer: ([^.\\n"]+)\\./) || [])[1];
    let o = /oat|milk/i.test(lastP) ? ['Oat is perfect, thanks', 'Regular milk is fine', 'Do you have almond?'] : ['A flat white, please', 'Just a tea for me', 'What do you recommend?'];
    if (steer === 'cold') o = ['An iced latte, please', 'Iced tea for me', 'Any cold brew today?'];
    return JSON.stringify({ options: [{ text: o[0], kind: 'answer' }, { text: o[1], kind: 'alternative' }, { text: o[2], kind: 'question' }] });
  };
  const wait = (ms, s) => new Promise((res, rej) => { const t = setTimeout(res, ms); s && s.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); }); });
  window.__prompts = 0;
  window.LanguageModel = {
    availability: async () => 'available',
    create: async () => ({
      prompt: async (c, o) => { window.__prompts++; await wait(300, o && o.signal); return reply(JSON.stringify(c)); },
      promptStreaming: (c, o) => { window.__prompts++; const full = reply(JSON.stringify(c)); let i = 0; return new ReadableStream({ async pull(ctl) { await wait(i ? 30 : 200, o && o.signal); if (i >= full.length) return ctl.close(); ctl.enqueue(full.slice(i, i + 20)); i += 20; } }); },
      destroy() {},
    }),
  };
})();`;

async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'], rules: { region: { enabled: false } } });
    return res.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.nodes[0]?.target?.join(' ')}`);
  });
  check(r.length === 0, `axe clean: ${label}${r.length ? ' → ' + r.join('; ') : ''}`);
}

async function noHorizontalScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 1, `no horizontal scroll: ${label} (${over}px)`);
}

async function context(browser, { width, height, theme, fake }) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce' });
  if (fake) await ctx.addInitScript(FAKE);
  const page = await ctx.newPage();
  const aiRequests = [];
  page.on('request', (r) => AI_HOST.test(new URL(r.url()).host) && aiRequests.push(r.url()));
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, aiRequests, errors };
}

/** The partner types a line: on a phone their side is opened first and turned back after. */
async function partnerSays(page, text) {
  const phone = await page.isVisible('#turn-top');
  if (phone) await page.click('#turn-top');
  await page.fill('#partner-input', text);
  await page.press('#partner-input', 'Enter');
  if (phone) await page.click('#flip');
}

async function shot(page, dir, name, fullPage = false) {
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage });
}

async function run() {
  // Full Chromium (headless): the headless shell crashes on SpeechRecognition.available().
  const browser = await chromium.launch({ channel: 'chromium' });
  const sizes = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'phone', width: 390, height: 844 },
  ];
  for (const size of sizes) {
    for (const theme of ['dark', 'light']) {
      const tag = `${size.name}-${theme}`;
      const dir = join(OUT, tag);
      const full = size.name === 'desktop' && theme === 'dark'; // the full functional run once; the rest capture

      // ---- World 1: no on-device model ----
      {
        const { ctx, page, aiRequests, errors } = await context(browser, { ...size, theme, fake: false });
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.waitForSelector('#start');
        await shot(page, dir, '01-start-no-model');
        if (full) {
          check(await page.isVisible('text=This browser cannot run the on-device model.'), 'no-model browser is told plainly');
          check(await page.isDisabled('#start'), 'Start is disabled without the model (no silent cloud fallback)');
          check(await page.isVisible('text=Never for cheating or recording anyone.'), 'the stance is on the first screen');
          await axe(page, `start (no model) ${tag}`);
        }
        await noHorizontalScroll(page, `start ${tag}`);
        await page.check('#consent');
        await page.click('#cloud-live');
        await page.waitForSelector('#cloud-confirm');
        await shot(page, dir, '02-cloud-live-confirm');
        if (full) await axe(page, `cloud confirm ${tag}`);
        await page.click('#cloud-no');
        check(aiRequests.length === 0, `no AI request without consent to Cloud live (${tag})`);
        check(errors.length === 0, `no page errors (${tag}, no model)${errors.length ? ': ' + errors.join(' | ') : ''}`);
        await ctx.close();
      }

      // ---- World 2: a stand-in for the on-device model ----
      {
        const { ctx, page, aiRequests, errors } = await context(browser, { ...size, theme, fake: true });
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.waitForSelector('#start');
        await page.check('#consent');
        await shot(page, dir, '03-start-model');
        await page.click('#start');
        await page.waitForSelector('#begin');
        await shot(page, dir, '04-choose', true);
        if (full) await axe(page, `choose ${tag}`);
        await noHorizontalScroll(page, `choose ${tag}`);
        await page.click('[data-pack=cafe]');
        await page.click('#mode-say');
        await page.click('#begin');
        await page.waitForSelector('#options', { state: 'attached' });
        await shot(page, dir, '05-say-empty');
        await partnerSays(page, 'Hi there, what can I get you?');
        await page.waitForFunction(() => document.querySelectorAll('.option:not(.skeleton):not(:disabled)').length === 3);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(250);
        await shot(page, dir, '06-say-options');
        if (full) {
          const texts = await page.$$eval('.option .text', (els) => els.map((e) => e.textContent));
          check(texts.join('|') === 'A flat white, please|Just a tea for me|What do you recommend?', 'three Say options appear for the partner line');
          await axe(page, `say ${tag}`);
          // stale-call cancellation: two lines quickly → only the second's options
          await partnerSays(page, 'Hi again');
          await partnerSays(page, 'Oat milk okay?');
          await page.waitForFunction(() => document.querySelector('#option-1 .text')?.textContent === 'Oat is perfect, thanks');
          check(true, 'a newer line supersedes the stale call');
          // steer
          await page.fill('#steer', 'cold');
          await page.press('#steer', 'Enter');
          await page.waitForFunction(() => document.querySelector('#option-1 .text')?.textContent === 'An iced latte, please' && !document.querySelector('#option-1').disabled);
          check(true, 'the steer word "cold" turns the options into iced drinks');
          await page.fill('#steer', '');
          // speak an option with the keyboard
          await page.click('body', { position: { x: 5, y: 5 } });
          await page.keyboard.press('1');
          check((await page.textContent('#partner-said')) === 'An iced latte, please', 'key 1 says option 1 on the partner side');
          await page.keyboard.press('h');
          check((await page.textContent('#partner-said')) === "One moment, I'm typing.", 'H holds the floor');
          await page.click(await page.isVisible('#turn-top') ? '#turn-top' : '#flip');
          await shot(page, dir, '07-partner-flipped');
          await page.click('#flip');
        }
        await noHorizontalScroll(page, `say ${tag}`);
        // Ask
        await page.click('#switch-ask');
        await partnerSays(page, 'The MRI shows a partial tear of the medial meniscus; we can try conservative management first.');
        await page.waitForFunction(() => document.querySelector('#ask')?.textContent?.endsWith('?'));
        await page.waitForTimeout(250);
        await shot(page, dir, '08-ask');
        if (full) {
          check((await page.textContent('#flag')).includes('try conservative management first'), 'Ask flags the decision with the exact quote');
          check((await page.textContent('#decisions summary')).includes('(1)'), 'the decision is pinned to the list');
          await page.click('#repeat');
          await page.waitForFunction(() => document.querySelector('#repeat-line')?.textContent?.startsWith('So '));
          check(true, 'Repeat it back writes a "So ..." sentence');
          await axe(page, `ask ${tag}`);
        }
        await noHorizontalScroll(page, `ask ${tag}`);
        // Receipt
        await page.click('#open-receipt');
        await page.waitForSelector('#receipt');
        await shot(page, dir, '09-receipt');
        if (full) {
          check((await page.textContent('#bytes-sent')) === 'Bytes sent this session: 0', 'the receipt shows zero bytes sent in Private mode');
          await axe(page, `receipt ${tag}`);
        }
        await page.click('#receipt [data-close]');
        // End → stats
        if (await page.isVisible('#end')) await page.click('#end');
        else {
          await page.click('#more > summary');
          await page.click('#end-menu');
        }
        await page.waitForSelector('#stats');
        await shot(page, dir, '10-stats');
        if (full) await axe(page, `stats ${tag}`);
        check(aiRequests.length === 0, `Private mode: zero requests to AI hosts (${tag}) ${aiRequests.join(' ')}`);
        check(errors.length === 0, `no page errors (${tag}, model)${errors.length ? ': ' + errors.join(' | ') : ''}`);
        await ctx.close();
      }
    }
  }
  await browser.close();
  writeFileSync(join(OUT, 'e2e-results.json'), JSON.stringify({ base: BASE, date: new Date().toISOString(), results }, null, 2));
  console.log(failures.length ? `\nE2E: ${failures.length} FAILED` : `\nE2E: all ${results.length} checks passed`);
  if (failures.length) process.exitCode = 1;
}

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
