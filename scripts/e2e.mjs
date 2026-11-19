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
    const lastP = (p.split(String.fromCharCode(92) + 'n').filter((l) => /P: /.test(l)).at(-1) || '').replace(/^.*P: /, '');
    if (/Explain the last P line/.test(p)) return JSON.stringify({ means: 'The cartilage in your knee is partly torn; they want to try rest and physio first.', ask: 'How long before we know if physio is working?', flag: { kind: 'decision', quote: 'try conservative management first' } });
    if (/confirming sentence/.test(p)) return JSON.stringify({ line: 'So physio comes first, and surgery only if it does not help?' });
    if (/completions/.test(p)) { const t = (p.match(/I am typing: ([^\\n"]*)/) || [])[1] || ''; return JSON.stringify({ completions: [t + ' please', t + ' for now', t + ' later'] }); }
    const steer = (p.match(/Steer: ([^.\\n"]+)\\./) || [])[1];
    let o = /oat|milk/i.test(lastP) ? ['Oat is perfect, thanks', 'Regular milk is fine', 'Do you have almond?'] : ['A flat white, please', 'Just a tea for me', 'What do you recommend?'];
    if (steer === 'cold') o = ['An iced latte, please', 'Iced tea for me', 'Any cold brew today?'];
    if (/three lines/.test(p)) return 'A: ' + o[0] + '\\nB: ' + o[1] + '\\nQ: ' + o[2];
    return JSON.stringify({ options: [{ text: o[0], kind: 'answer' }, { text: o[1], kind: 'alternative' }, { text: o[2], kind: 'question' }] });
  };
  const wait = (ms, s) => new Promise((res, rej) => { const t = setTimeout(res, ms); s && s.addEventListener('abort', () => { clearTimeout(t); rej(new DOMException('aborted', 'AbortError')); }); });
  window.__prompts = 0;
  // Test-only disguise: patches Function.prototype.toString so these fakes report themselves as
  // native. It is exactly what a hostile extension could do, which is why the app's native check
  // is documented as a hint, not a proof.
  const names = new Map();
  const realToString = Function.prototype.toString;
  const toString = function toString() { return names.has(this) ? 'function ' + names.get(this) + '() { [native code] }' : realToString.call(this); };
  names.set(toString, 'toString');
  Function.prototype.toString = toString;
  const LM = function LanguageModel() {};
  names.set(LM, 'LanguageModel');
  const availability = async function availability() { return 'available'; };
  names.set(availability, 'availability');
  window.LanguageModel = Object.assign(LM, {
    availability,
    create: Object.assign(async function create() { return session; }, {}),
  });
  names.set(window.LanguageModel.create, 'create');
  var session = ({
      prompt: async (c, o) => { window.__prompts++; await wait(300, o && o.signal); return reply(JSON.stringify(c)); },
      promptStreaming: (c, o) => { window.__prompts++; const full = reply(JSON.stringify(c)); let i = 0; return new ReadableStream({ async pull(ctl) { await wait(i ? 30 : 200, o && o.signal); if (i >= full.length) return ctl.close(); ctl.enqueue(full.slice(i, i + 20)); i += 20; } }); },
      destroy() {},
    });
})();`;

// A scripted local recogniser (test-only): window.__hear(text) plays interim words, then a final.
const FAKE_SPEECH = `(() => {
  const live = [];
  class Rec {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this.onresult = null; this.onerror = null; this.onend = null; live.push(this); }
    start() {}
    stop() { const i = live.indexOf(this); if (i >= 0) live.splice(i, 1); this.onend && this.onend(); }
    abort() { const i = live.indexOf(this); if (i >= 0) live.splice(i, 1); }
    static async available() { return 'available'; }
    static async install() { return true; }
  }
  Object.defineProperty(Rec.prototype, 'processLocally', { value: false, writable: true });
  window.SpeechRecognition = Rec;
  window.webkitSpeechRecognition = Rec;
  window.__hear = async (text, pauseMs = 120) => {
    const words = text.split(' ');
    for (let i = 1; i <= words.length; i++) {
      const r = live.at(-1); if (!r || !r.onresult) return;
      const res = { isFinal: i === words.length, length: 1, 0: { transcript: words.slice(0, i).join(' '), confidence: 0.9 } };
      r.onresult({ resultIndex: 0, results: { length: 1, 0: res } });
      await new Promise((ok) => setTimeout(ok, pauseMs));
    }
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

async function context(browser, { width, height, theme, fake, speech }) {
  // bypassCSP only so the test can inject axe-core; the page's own CSP is checked separately.
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: 'reduce', bypassCSP: true });
  if (fake) await ctx.addInitScript(FAKE);
  if (speech) await ctx.addInitScript(FAKE_SPEECH);
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
  {
    const html = await (await fetch(BASE + '/')).text();
    check(/http-equiv="Content-Security-Policy"[^>]*connect-src 'self'/.test(html), 'the built page carries its Content Security Policy');
  }
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
          check((await page.textContent('#start')) === 'Start with phrases and typing', 'without the model, Start offers phrases and typing (no silent cloud fallback)');
          check(await page.isVisible('text=Never for cheating or recording anyone.'), 'the stance is on the first screen');
          await axe(page, `start (no model) ${tag}`);
        }
        await noHorizontalScroll(page, `start ${tag}`);
        if (full) {
          await page.click('#open-safety');
          await page.waitForSelector('#case-R8');
          check((await page.textContent('#case-R3')).includes('Removed'), 'the Safety page shows the rules at work in a browser without the model');
          await shot(page, dir, '11-safety', true);
          await axe(page, `safety ${tag}`);
          await page.click('#safety-back');
          await page.waitForSelector('#start');
        }
        if (full) {
          // Replay: real on-device sessions, played with their timings, in a browser without the model.
          check(await page.isVisible('#replay'), 'Replay is offered when the browser has no model');
          await page.click('#replay');
          await page.click('[data-replay=clinic]');
          await page.waitForSelector('.replay-label');
          check((await page.textContent('.replay-label')).includes('Recorded on-device session'), 'a replay is labelled as a recording, with browser and machine');
          await page.waitForFunction(() => !document.querySelector('#replay-body .ask-card.ask.skeleton'), null, { timeout: 15000 });
          check((await page.textContent('#replay-timing')).includes('on the device'), 'the replay shows the measured timing');
          await shot(page, dir, '01b-replay');
          await axe(page, `replay ${tag}`);
          await page.goto(BASE + '/', { waitUntil: 'networkidle' });
          await page.waitForSelector('#start');
        }
        await page.check('#consent');
        await page.click('#cloud-live');
        await page.waitForSelector('#cloud-confirm');
        await shot(page, dir, '02-cloud-live-confirm');
        if (full) await axe(page, `cloud confirm ${tag}`);
        await page.click('#cloud-no');
        if (full) {
          // A session with no model: phrases, Hold on and typing still speak; nothing is sent.
          await page.click('#start');
          await page.waitForSelector('#begin');
          check(await page.isDisabled('#mode-ask'), 'Ask is unavailable without a model');
          await page.click('#begin');
          await page.waitForSelector('#empty-say');
          check((await page.textContent('#empty-say')).includes('cannot make suggestions'), 'the no-model session says plainly that there are no suggestions');
          await page.click('#quick button:first-child');
          check((await page.textContent('#partner-said')) === 'Yes', 'a quick phrase speaks without any model');
          await shot(page, dir, '02b-no-model-session');
          await axe(page, `no-model session ${tag}`);
        }
        check(aiRequests.length === 0, `no AI request without consent to Cloud live (${tag})`);
        check(errors.length === 0, `no page errors (${tag}, no model)${errors.length ? ': ' + errors.join(' | ') : ''}`);
        await ctx.close();
      }

      // ---- World 1b: a script-defined LanguageModel without any disguise (a bound function) ----
      if (full) {
        const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height } });
        await ctx.addInitScript(`window.LanguageModel = Object.assign(Function.prototype.bind.call(function () {}, null), { availability: async () => 'available', create: async () => ({ prompt: async () => '{}' }) });`);
        const page = await ctx.newPage();
        await page.goto(BASE + '/', { waitUntil: 'networkidle' });
        await page.waitForSelector('#start');
        check(await page.isVisible('text=This browser cannot run the on-device model.'), 'a LanguageModel that is not the browser\'s own is refused');
        await ctx.close();
      }

      // ---- World 2: a stand-in for the on-device model ----
      {
        const { ctx, page, aiRequests, errors } = await context(browser, { ...size, theme, fake: true, speech: true });
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
        // Listening: the partner speaks; interim words show faintly, the final line becomes a turn.
        if (await page.isVisible('#listen')) {
          check((await page.textContent('#partner-notice')).includes('listening on this device only'), `the partner side says Sotto listens on this device only (${tag})`);
          await page.evaluate(() => window.__hear('Hi there, what can I get you?', 150).then(() => undefined));
          await page.waitForFunction(() => document.querySelectorAll('.option:not(.skeleton):not(:disabled)').length === 3);
          await page.evaluate(() => { window.__hear('So are you staying in or taking it with you', 400); });
          await page.waitForTimeout(900);
          await shot(page, dir, '05b-listening');
          if (full) check((await page.textContent('#interim')).length > 0, 'interim words show while they speak');
          await page.waitForFunction(() => document.querySelector('#last-line')?.textContent?.includes('taking it with you'), null, { timeout: 15000 });
        }
        await partnerSays(page, 'Hi there, what can I get you?');
        await page.waitForFunction(() => document.querySelectorAll('.option:not(.skeleton):not(:disabled)').length === 3);
        await page.mouse.move(0, 0);
        await page.waitForTimeout(250);
        await shot(page, dir, '06-say-options');
        if (full) {
          const texts = await page.$$eval('.option .text', (els) => els.map((e) => e.textContent));
          check(texts.join('|') === 'A flat white, please|Just a tea for me|What do you recommend?', 'three Say options appear for the partner line');
          await axe(page, `say ${tag}`);
          for (const w of [1024, 1280]) {
            await page.setViewportSize({ width: w, height: 800 });
            await page.waitForTimeout(150);
            const over = await page.evaluate(() => { const t = document.querySelector('.topbar'); return t.scrollWidth - t.clientWidth; });
            check(over <= 1, `the top bar fits at ${w} px (${over}px over)`);
            await shot(page, dir, `06c-say-${w}`);
          }
          await page.setViewportSize({ width: size.width, height: size.height });
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
          check((await page.textContent('#partner-said')) === 'Hold on, please.', 'H holds the floor');
          // Airplane mode: the network goes away mid-conversation; live help keeps working.
          await ctx.setOffline(true);
          await partnerSays(page, 'Is that for here or to go?');
          await page.waitForFunction(() => document.querySelectorAll('.option:not(.skeleton):not(:disabled)').length === 3 && !document.querySelector('.options.stale'));
          check((await page.textContent('#open-receipt')).includes('offline'), 'offline: the pill says offline');
          check((await page.textContent('#timing')).includes('on this device'), 'offline: suggestions still arrive, measured, on this device');
          await shot(page, dir, '06b-offline');
          await ctx.setOffline(false);
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
          check((await page.textContent('#bytes-sent')) === 'Nothing sent this session', 'the receipt shows nothing sent in Private mode');
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
  console.log('\nE2E: aborted by an error');
  process.exit(1); // do not hang on an open browser
});
