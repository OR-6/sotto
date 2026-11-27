// Gallery images for the submission (3:2, 1500 × 1000 CSS px at 2×), from the live site.
// Only real on-device output (the recorded replays) and screens that need no model are used;
// screens with the test stand-in model are never gallery material.
//   node scripts/gallery.mjs [baseUrl] [outDir]
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'https://sotto.web.app';
const OUT = process.argv[3] ?? 'gallery';
mkdirSync(OUT, { recursive: true });
const W = 1500;
const H = 1000;

const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });
const page = await ctx.newPage();
const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('  ', join(OUT, `${name}.png`));
};
const open = async () => {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForSelector('#start');
};

// 1. The first screen: what it is and the stance.
await open();
await shot('1-start');

// 2 and 3. Real on-device sessions, replayed with their timings.
const replay = async (id, steps, name) => {
  await open();
  await page.click('#replay');
  await page.click(`[data-replay=${id}]`);
  for (let i = 0; i < steps; i++) {
    await page.waitForFunction(() => document.querySelector('#replay-timing')?.textContent, null, { timeout: 20000 });
    if (i < steps - 1) await page.click('#replay-next');
  }
  await page.waitForTimeout(300);
  await shot(name);
};
await replay('clinic', 1, '2-ask-clinic-replay');
await replay('cafe', 2, '3-say-cafe-replay');
await replay('landlord', 3, '4-ask-landlord-flag');

// 5. The safety rules, tested in any browser.
await open();
await page.click('#open-safety');
await page.waitForSelector('#case-R3');
await page.evaluate(() => document.getElementById('case-R2')?.scrollIntoView({ block: 'start' }));
await page.waitForTimeout(200);
await shot('5-safety');

// Composed images are drawn on a blank page (the site's CSP would block their inline fonts).
const canvas = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })).newPage();

// 6. The hybrid split as one picture.
const font = (w) => 'data:font/woff2;base64,' + readFileSync(resolve(`node_modules/@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-${w}-normal.woff2`)).toString('base64');
const col = (when, where, cls, title, steps, mode, leaves) => `
  <section class="col ${cls}">
    <div class="when">${when}</div>
    <div class="where">${where}</div>
    <h2>${title}</h2>
    <ul>${steps.map((s) => `<li>${s}</li>`).join('')}</ul>
    <div class="mode">${mode}</div>
    <div class="leaves">${leaves}</div>
  </section>`;
await canvas.setContent(`<!doctype html><html><head><style>
  @font-face { font-family: A; src: url(${font(400)}) format('woff2'); font-weight: 400; }
  @font-face { font-family: A; src: url(${font(700)}) format('woff2'); font-weight: 700; }
  body { margin: 0; width: ${W}px; height: ${H}px; background: #0f1419; color: #f3efe7; font-family: A, sans-serif; box-sizing: border-box; padding: 64px 72px; display: flex; flex-direction: column; justify-content: center; }
  h1 { font-size: 52px; margin: 0 0 8px; } .sub { font-size: 24px; color: #a7adb3; margin: 0 0 40px; }
  .cols { display: grid; grid-template-columns: 1fr 1.25fr 1fr; gap: 24px; }
  h1 { font-size: 56px; } .col { padding: 32px; } ul { font-size: 23px; } .guards { font-size: 22px; }
  .col { border-radius: 18px; padding: 28px; border: 2px solid rgb(243 239 231 / 18%); background: #161d24; }
  .col.device { border-color: #6fd08c; background: rgb(111 208 140 / 8%); }
  .when { font-size: 18px; letter-spacing: .1em; text-transform: uppercase; color: #a7adb3; }
  .where { font-size: 30px; font-weight: 700; margin: 6px 0 14px; }
  .device .where { color: #6fd08c; } .cloud .where { color: #8fb6ff; }
  h2 { font-size: 26px; margin: 0 0 10px; }
  ul { margin: 0 0 18px; padding-left: 22px; font-size: 21px; line-height: 1.45; }
  .mode { font-family: ui-monospace, Menlo, monospace; font-size: 17px; background: rgb(243 239 231 / 8%); border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; }
  .leaves { font-size: 21px; font-weight: 700; }
  .device .leaves { color: #6fd08c; }
  .guards { margin-top: 32px; font-size: 20px; color: #a7adb3; line-height: 1.5; }
  .guards b { color: #f3efe7; }
</style></head><body>
  <h1>Sotto: the live part never leaves the device</h1>
  <p class="sub">Firebase AI Logic hybrid inference, split by when it is needed, not by fallback.</p>
  <div class="cols">
    ${col('Before', 'Cloud', 'cloud', 'Prepare and your voice', ['A brief from one line you type', 'A voice pack from phrases you choose'], 'PREFER_IN_CLOUD · ONLY_IN_CLOUD', 'Only the text you approved on screen')}
    ${col('During', 'This device', 'device', 'Say and Ask, live', ['Three things to say, about a second after their line', 'What it meant, and the question to ask', 'Deadlines, costs and decisions flagged'], 'ONLY_ON_DEVICE · Gemini Nano in Chrome', 'Nothing. Measured: 0 bytes, 0 requests')}
    ${col('After', 'Cloud or device', 'cloud', 'Summary', ['Decisions and next steps', 'A message you could send'], 'PREFER_IN_CLOUD · or on device', 'Only the lines you tick')}
  </div>
  <p class="guards"><b>Three guards on the live path:</b> the on-device runtime must be the browser's own before every call · every result must report it ran on the device · a network guard blocks any model request without a one-shot permit for its exact text.</p>
</body></html>`);
await canvas.waitForTimeout(400);
await canvas.screenshot({ path: join(OUT, '6-hybrid-split.png') });
console.log('  ', join(OUT, '6-hybrid-split.png'));

// 7. On a phone: a real replay at 390 px, centred on the 3:2 canvas.
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: 'dark', reducedMotion: 'reduce' });
const pp = await phone.newPage();
await pp.goto(BASE + '/', { waitUntil: 'networkidle' });
await pp.waitForSelector('#start');
await pp.click('#replay');
await pp.click('[data-replay=cafe]');
await pp.waitForFunction(() => document.querySelector('#replay-timing')?.textContent, null, { timeout: 20000 });
const phonePng = (await pp.screenshot()).toString('base64');
await canvas.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;background:#0f1419;display:grid;place-items:center">
  <img src="data:image/png;base64,${phonePng}" style="height:${H - 80}px;border-radius:36px;border:10px solid #2a333c">
</body></html>`);
await canvas.waitForTimeout(300);
await canvas.screenshot({ path: join(OUT, '7-phone-replay.png') });
console.log('  ', join(OUT, '7-phone-replay.png'));

await browser.close();
