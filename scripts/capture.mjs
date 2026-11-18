// Screenshots every screen and state of a Veil build, at desktop (1440) and phone (390)
// widths, in light and dark. Headless Chromium has no on-device model, so this is exactly
// what a judge without Gemini Nano sees (Manual Veil mode).
//   node scripts/capture.mjs [baseUrl] [outDir]
// Default: the live site → shots/. Every shot is a real page state: no DOM is faked.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.argv[2] ?? 'https://veil-123.web.app';
const OUT = process.argv[3] ?? 'shots';
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];
const THEMES = ['light', 'dark'];
const manifest = [];

async function waitFor(page, fn, timeout = 30_000) {
  await page.waitForFunction(fn, null, { timeout, polling: 200 });
}

async function shot(page, dir, name, opts = {}) {
  const file = join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? false, ...(opts.clip ? { clip: opts.clip } : {}) });
  manifest.push({ file, ...opts.meta });
  console.log('  ', file);
}

async function scrollTo(page, selector) {
  await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'start' }), selector);
  await page.waitForTimeout(150);
}

async function freshPage(browser, vp, theme, offline = false) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  if (offline) await context.setOffline(false);
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await waitFor(page, () => !/Checking what this browser/.test(document.getElementById('capability')?.textContent ?? ''));
  return { context, page };
}

async function runFlow(browser, vp, theme) {
  const dir = join(OUT, `${vp.name}-${theme}`);
  mkdirSync(dir, { recursive: true });
  console.log(`${vp.name} ${theme}`);
  const { context, page } = await freshPage(browser, vp, theme);

  await shot(page, dir, '01-start');
  await shot(page, dir, '02-start-full', { fullPage: true });

  // Error: find with an empty box.
  await page.click('#find');
  await page.waitForTimeout(200);
  await scrollTo(page, '#add');
  await shot(page, dir, '03-empty-error');

  // Sample loaded.
  await page.click('[data-sample=L01]');
  await scrollTo(page, '#add');
  await shot(page, dir, '04-sample-loaded');

  // Review.
  await page.click('#find');
  await waitFor(page, () => document.querySelectorAll('mark.v').length > 0);
  await page.waitForTimeout(300);
  await scrollTo(page, '#review');
  await shot(page, dir, '05-review-top');
  await shot(page, dir, '06-review-full', { fullPage: true });

  // Keyboard focus on a highlight.
  await page.focus('mark.v');
  await page.waitForTimeout(150);
  await shot(page, dir, '07-focus-highlight');

  // Click a rule-locked highlight (explains why it stays hidden).
  await page.click('mark.v.locked');
  await page.waitForTimeout(200);
  await scrollTo(page, '.tools');
  await shot(page, dir, '08-locked-note');

  // Hide typed text; the choice chip appears.
  await page.fill('#hide-input', 'Revenue Administration Act');
  await page.click('#hide-form button[type=submit]');
  await page.waitForTimeout(200);
  await scrollTo(page, '.tools');
  await shot(page, dir, '09-hidden-by-you');

  // Step 3 before confirming.
  await scrollTo(page, '#read');
  await shot(page, dir, '10-explain-unconfirmed');

  // Confirm and send: loading state, then the answer.
  await page.check('#confirm');
  await page.click('#explain');
  await page.waitForTimeout(150);
  await shot(page, dir, '11-explain-loading');
  await waitFor(page, () => !!document.querySelector('#answer .in-short') || /could not|stopped|Too many/.test(document.getElementById('explain-status')?.textContent ?? ''), 60_000);
  await page.waitForTimeout(300);
  await scrollTo(page, '#read');
  await shot(page, dir, '12-answer-top');
  await shot(page, dir, '13-answer-full', { fullPage: true });

  // Receipt open.
  await page.evaluate(() => {
    const r = document.getElementById('receipt');
    r.open = true;
    r.querySelectorAll('details').forEach((d) => (d.open = true));
  });
  await scrollTo(page, '#receipt');
  await shot(page, dir, '14-receipt-open');

  // Out-of-date answer after an edit.
  await page.fill('#hide-input', 'Assessments Unit');
  await page.click('#hide-form button[type=submit]');
  await page.waitForTimeout(200);
  await scrollTo(page, '#read');
  await shot(page, dir, '15-answer-out-of-date');
  await context.close();

  // Residence letter: "Possible names" suggestion (Manual Veil mode).
  {
    const { context: c2, page: p2 } = await freshPage(browser, vp, theme);
    await p2.click('[data-sample=L04]');
    await p2.click('#find');
    await waitFor(p2, () => document.querySelectorAll('mark.v').length > 0);
    await p2.waitForTimeout(300);
    await scrollTo(p2, '#review');
    await shot(p2, dir, '16-possible-names');
    await c2.close();
  }

  // Offline: chip and Step 3 hint, then the error after trying to send.
  {
    const { context: c3, page: p3 } = await freshPage(browser, vp, theme);
    await p3.click('[data-sample=L02]');
    await p3.click('#find');
    await waitFor(p3, () => document.querySelectorAll('mark.v').length > 0);
    await c3.setOffline(true);
    await p3.evaluate(() => window.dispatchEvent(new Event('offline')));
    await p3.waitForTimeout(300);
    await p3.check('#confirm');
    await scrollTo(p3, '#read');
    await shot(p3, dir, '17-offline');
    await p3.click('#explain');
    await waitFor(p3, () => !/Sending/.test(document.getElementById('explain-status')?.textContent ?? ''), 60_000);
    await p3.waitForTimeout(300);
    await shot(p3, dir, '18-offline-error');
    await c3.close();
  }

  // Long letter (four letters pasted together, near the 10,000-character cap).
  {
    const { context: c4, page: p4 } = await freshPage(browser, vp, theme);
    const long = await p4.evaluate(async () => {
      const texts = [];
      for (const id of ['L01', 'L02', 'L03', 'L04']) {
        document.querySelector(`[data-sample=${id}]`).click();
        texts.push(document.getElementById('letter').value);
      }
      return texts.join('\n\n');
    });
    await p4.fill('#letter', long);
    await p4.click('#find');
    await waitFor(p4, () => document.querySelectorAll('mark.v').length > 0);
    await p4.waitForTimeout(300);
    await scrollTo(p4, '#review');
    await shot(p4, dir, '19-long-letter');
    await c4.close();
  }

  // Leak tests page.
  {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme, reducedMotion: 'reduce' });
    const p5 = await context.newPage();
    await p5.goto(BASE + '/redteam/', { waitUntil: 'networkidle' });
    await shot(p5, dir, '20-redteam-before');
    await p5.click('#run');
    await waitFor(p5, () => /handled/.test(document.getElementById('summary')?.textContent ?? ''));
    await shot(p5, dir, '21-redteam-after');
    await shot(p5, dir, '22-redteam-full', { fullPage: true });
    await context.close();
  }
}

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) for (const theme of THEMES) await runFlow(browser, vp, theme);
} finally {
  await browser.close();
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), shots: manifest }, null, 2));
console.log(`capture: ${manifest.length} screenshots in ${OUT}/`);
