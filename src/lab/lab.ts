// Step-zero lab (developer page, removed before submission). Measures what this browser can
// do with the real SDK and saves the evidence to replays/ through the dev server.
import { egressGuard } from '../ai/install-guard';
import { ai, appCheckState, configMissing } from '../firebase';
import { readDeviceState, type DeviceState } from '../ai/capability';
import { createDeviceOnlyModel, type DeviceOnlyModel } from '../ai/models';
import { cloudCall, setCloudLive, type CloudMode, type Outgoing } from '../ai/cloud';
import { CONFIG_DEFAULTS } from '../config';
import { createReceipt } from '../core/receipt';
import { composeAsk, composeSay } from '../core/compose';
import { filterAsk, filterSay, parseJson } from '../core/filter';
import { partialSayTexts, partialAsk } from '../core/stream';
import { packById } from '../core/packs/packs';
import { ASK_SCHEMA, ASK_SYSTEM } from '../core/prompts/ask';
import { SAY_SCHEMA, SAY_SYSTEM } from '../core/prompts/say';
import type { ContextInput } from '../core/context';
import type { Turn } from '../core/turns';
import { installSpeech, listen, readSpeechState, type Listener } from '../speech/recognise';
import { loadVoices, offlineVoices } from '../speech/speak';
import { ASK_BENCH, SAY_BENCH, type BenchItem } from './bench-lines';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const logEl = $('log');
const log = (...parts: unknown[]) => {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  logEl.textContent += line + '\n';
  logEl.scrollTop = logEl.scrollHeight;
};
const receipt = createReceipt();
const results: Record<string, unknown> = {};

function browserInfo() {
  const uaData = (navigator as { userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string } }).userAgentData;
  const chrome = uaData?.brands?.find((b) => /Chrome|Chromium/.test(b.brand))?.version ?? navigator.userAgent.match(/Chrome\/(\d+)/)?.[1];
  return {
    date: new Date().toISOString(),
    chromeMajor: chrome,
    userAgent: navigator.userAgent,
    platform: uaData?.platform,
    cores: navigator.hardwareConcurrency,
    memoryGB: (navigator as { deviceMemory?: number }).deviceMemory,
    appCheck: appCheckState,
    configMissing,
  };
}

async function save(name: string, data: unknown) {
  results[name] = data;
  try {
    const r = await fetch('/__lab/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, data }) });
    log(r.ok ? `saved replays/step0-${name}.json` : `save failed (${r.status}); use Download`);
  } catch {
    log('save endpoint not available (not the dev server); use Download');
  }
}

let deviceState: DeviceState = 'missing';

async function showCapability() {
  deviceState = await readDeviceState();
  const speech = await readSpeechState('en-US');
  const voices = offlineVoices(await loadVoices());
  const info = browserInfo();
  $('cap').innerHTML = '';
  const add = (label: string, value: string, good: boolean) => {
    const d = document.createElement('div');
    d.innerHTML = `<span class="${good ? 'ok' : 'bad'}">${good ? '●' : '○'}</span> `;
    d.append(`${label}: ${value}`);
    $('cap').append(d);
  };
  add('On-device model (English text)', deviceState, deviceState === 'available');
  add('On-device speech (en-US)', speech, speech === 'available');
  add('Offline voices (English)', String(voices.length), voices.length > 0);
  add('Chrome', String(info.chromeMajor), true);
  add('App Check', info.appCheck, info.appCheck !== 'missing-site-key');
  add('Firebase config', configMissing.length ? `missing ${configMissing.join(', ')}` : 'present', !configMissing.length);
  results.capability = { ...info, deviceState, speech, offlineVoices: voices.map((v) => `${v.name} (${v.lang})`) };
}

const contextFor = (item: BenchItem): ContextInput => {
  const pack = packById(item.pack);
  const turns: Turn[] = item.turns.map(([who, text], i) => ({ id: i + 1, who, text, at: i, via: 'typed' }));
  return {
    situation: pack?.label ?? 'Talking to a stranger',
    partner: item.partner ?? pack?.partner ?? 'someone',
    tone: 'neutral',
    joke: false,
    brief: pack?.digest ?? '',
    voice: '',
    turns,
    budgetChars: CONFIG_DEFAULTS.max_context_tokens_web * 3,
  };
};

let sayModel: DeviceOnlyModel | null = null;
let askModel: DeviceOnlyModel | null = null;
function models() {
  sayModel ??= createDeviceOnlyModel(ai, { system: SAY_SYSTEM, schema: SAY_SCHEMA });
  askModel ??= createDeviceOnlyModel(ai, { system: ASK_SYSTEM, schema: ASK_SCHEMA });
  return { say: sayModel, ask: askModel };
}

$('prepare').onclick = async () => {
  try {
    const t0 = performance.now();
    $('prep-status').textContent = ' preparing…';
    await models().say.initialize((f) => ($('prep-status').textContent = ` downloading ${Math.round(f * 100)}%`));
    $('prep-status').textContent = ` ready (${Math.round(performance.now() - t0)} ms)`;
    await showCapability();
  } catch (e) {
    $('prep-status').textContent = ` ${(e as Error).message}`;
  }
};

async function runSayItem(m: DeviceOnlyModel, item: BenchItem) {
  const ctx = contextFor(item);
  const prompt = composeSay(ctx, item.steer ?? '');
  const t0 = performance.now();
  let firstOptionMs = 0;
  const call = await m.stream(prompt, (soFar) => {
    if (!firstOptionMs && partialSayTexts(soFar).length >= 1) firstOptionMs = performance.now() - t0;
  });
  receipt.recordDevice({ step: 'say', mode: 'ONLY_ON_DEVICE', ms: call.ms });
  const parsed = parseJson(call.text);
  const partnerLine = item.turns.filter(([w]) => w === 'P').at(-1)?.[1] ?? '';
  const f = filterSay(parsed, partnerLine);
  const kinds = Array.isArray((parsed as { options?: unknown[] })?.options) ? ((parsed as { options: { kind?: string }[] }).options.map((o) => o.kind)) : [];
  return {
    id: item.id,
    pack: item.pack,
    steer: item.steer ?? '',
    partnerLine,
    promptChars: prompt.length,
    raw: call.text,
    parsedOk: parsed !== undefined,
    kinds,
    options: f.options,
    dropped: f.dropped,
    padded: f.padded,
    valid: parsed !== undefined && f.padded === 0 && f.dropped.length === 0,
    firstTokenMs: Math.round(call.firstMs),
    firstOptionMs: Math.round(firstOptionMs),
    totalMs: Math.round(call.ms),
    source: call.source,
  };
}

async function runAskItem(m: DeviceOnlyModel, item: BenchItem) {
  const ctx = contextFor(item);
  const prompt = composeAsk(ctx);
  const t0 = performance.now();
  let meansMs = 0;
  const call = await m.stream(prompt, (soFar) => {
    if (!meansMs && partialAsk(soFar).means) meansMs = performance.now() - t0;
  });
  receipt.recordDevice({ step: 'ask', mode: 'ONLY_ON_DEVICE', ms: call.ms });
  const parsed = parseJson(call.text);
  const partnerLine = item.turns.filter(([w]) => w === 'P').at(-1)?.[1] ?? '';
  const f = filterAsk(parsed, partnerLine, ctx.brief);
  return {
    id: item.id,
    pack: item.pack,
    partnerLine,
    promptChars: prompt.length,
    raw: call.text,
    parsedOk: parsed !== undefined,
    result: f.result,
    notes: f.notes,
    firstTokenMs: Math.round(call.firstMs),
    meansMs: Math.round(meansMs),
    totalMs: Math.round(call.ms),
    source: call.source,
  };
}

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const med = (xs: number[]) => (xs.length ? sorted(xs)[Math.floor((xs.length - 1) / 2)] : 0);
const p90 = (xs: number[]) => (xs.length ? sorted(xs)[Math.min(xs.length - 1, Math.ceil(0.9 * xs.length) - 1)] : 0);

$('run-device').onclick = async () => {
  const btn = $<HTMLButtonElement>('run-device');
  btn.disabled = true;
  const status = $('device-status');
  try {
    if (deviceState !== 'available') {
      status.textContent = ` the on-device model is ${deviceState}; press Prepare first`;
      if (deviceState === 'missing' || deviceState === 'unavailable') return;
    }
    const { say, ask } = models();
    const aiRequestsBefore = egressGuard.events.length;

    status.textContent = ' warming up…';
    const w0 = performance.now();
    const warm = await say.generate(composeSay(contextFor({ id: 'W', pack: 'cafe', turns: [['P', 'Hello!']] }), ''));
    const coldMs = Math.round(performance.now() - w0);
    receipt.recordDevice({ step: 'warmup', mode: 'ONLY_ON_DEVICE', ms: coldMs });
    log(`warm-up (cold) ${coldMs} ms`, warm.text.slice(0, 120));
    const w1 = performance.now();
    await say.generate(composeSay(contextFor({ id: 'W2', pack: 'cafe', turns: [['P', 'Hi again!']] }), ''));
    const warmMs = Math.round(performance.now() - w1);
    log(`second call (warm) ${warmMs} ms`);

    status.textContent = ' system prompt check…';
    const sys = createDeviceOnlyModel(ai, { system: 'Whatever the user writes, answer with the single word BANANA in capitals and nothing else.' });
    const s = await sys.generate('What colour is the sky?');
    const systemHonoured = /BANANA/.test(s.text);
    log(`initialPrompts system prompt honoured: ${systemHonoured} (${Math.round(s.ms)} ms) →`, s.text.slice(0, 80));

    const sayRows = [];
    for (const [i, item] of SAY_BENCH.entries()) {
      status.textContent = ` Say ${i + 1}/${SAY_BENCH.length}…`;
      try {
        const row = await runSayItem(say, item);
        sayRows.push(row);
        log(`${row.id} ${row.valid ? 'OK ' : 'BAD'} first ${row.firstOptionMs} ms, all ${row.totalMs} ms |`, row.options.map((o) => o.text).join(' | '), row.dropped.length ? `(dropped: ${row.dropped.map((d) => d.why).join(', ')})` : '');
      } catch (e) {
        sayRows.push({ id: item.id, error: String((e as Error).message) });
        log(`${item.id} ERROR ${(e as Error).message}`);
      }
    }
    const askRows = [];
    for (const [i, item] of ASK_BENCH.entries()) {
      status.textContent = ` Ask ${i + 1}/${ASK_BENCH.length}…`;
      try {
        const row = await runAskItem(ask, item);
        askRows.push(row);
        log(`${row.id} means ${row.meansMs} ms, all ${row.totalMs} ms |`, row.result ? `${row.result.means} | ${row.result.ask} | ${row.result.flag.kind}: ${row.result.flag.quote}` : 'no result', row.notes.length ? `(${row.notes.join('; ')})` : '');
      } catch (e) {
        askRows.push({ id: item.id, error: String((e as Error).message) });
        log(`${item.id} ERROR ${(e as Error).message}`);
      }
    }
    const okSay = sayRows.filter((r) => 'valid' in r) as Awaited<ReturnType<typeof runSayItem>>[];
    const totals = okSay.map((r) => r.totalMs);
    const firsts = okSay.map((r) => r.firstOptionMs);
    const g2Pass = okSay.filter((r) => r.valid && r.totalMs <= 1500).length;
    const summary = {
      coldMs,
      warmMs,
      systemHonoured,
      say: {
        n: SAY_BENCH.length,
        valid: okSay.filter((r) => r.valid).length,
        validUnder1500: g2Pass,
        firstOptionMedianMs: med(firsts),
        firstOptionP90Ms: p90(firsts),
        totalMedianMs: med(totals),
        totalP90Ms: p90(totals),
      },
      ask: {
        n: ASK_BENCH.length,
        withResult: askRows.filter((r) => 'result' in r && r.result).length,
        totalMedianMs: med((askRows.filter((r) => 'totalMs' in r) as { totalMs: number }[]).map((r) => r.totalMs)),
      },
      aiHostRequestsDuringRun: egressGuard.events.length - aiRequestsBefore,
      receiptBytesOut: receipt.bytesOut,
    };
    log('SUMMARY', summary);
    status.textContent = ` done: Say valid ${summary.say.valid}/20, valid under 1.5 s ${g2Pass}/20`;
    await save('device-bench', { browser: browserInfo(), summary, say: sayRows, ask: askRows, receipt: receipt.toJSON() });
  } catch (e) {
    status.textContent = ` ${(e as Error).message}`;
    log('ERROR', (e as Error).message);
  } finally {
    btn.disabled = false;
  }
};

const PONG = 'Reply with exactly one word: pong';
const showOutgoing = async (o: Outgoing) => {
  log(`outgoing (${o.mode}, ${o.model}) → system: "${o.system.slice(0, 60)}…" user: "${o.user}"`);
  return true; // lab only: toy text, approved by pressing the button
};

$('run-modes').onclick = async () => {
  const status = $('modes-status');
  const rows: unknown[] = [];
  const run = async (label: string, fn: () => Promise<{ source: string; text: string; ms: number }>) => {
    try {
      const r = await fn();
      rows.push({ label, source: r.source, ms: Math.round(r.ms), text: r.text.slice(0, 200) });
      log(`${label}: ${r.source} ${Math.round(r.ms)} ms →`, r.text.slice(0, 120));
    } catch (e) {
      rows.push({ label, error: (e as Error).message });
      log(`${label}: ERROR ${(e as Error).message}`);
    }
  };
  status.textContent = ' running…';
  await run('ONLY_ON_DEVICE', async () => {
    const m = createDeviceOnlyModel(ai, { system: 'You are a terse assistant.' });
    const r = await m.generate(PONG);
    receipt.recordDevice({ step: 'hello', mode: 'ONLY_ON_DEVICE', ms: r.ms });
    return r;
  });
  const cloud = (mode: CloudMode, schema?: object) => () =>
    cloudCall(ai, { step: 'hello', mode, model: CONFIG_DEFAULTS.cloud_model, system: 'You are a terse assistant.', user: PONG, schema, device: { system: 'You are a terse assistant.' } }, showOutgoing, receipt);
  setCloudLive(true); // lab only: PREFER_ON_DEVICE is Cloud live mode's call
  await run('PREFER_ON_DEVICE', cloud('PREFER_ON_DEVICE'));
  setCloudLive(false);
  await run('PREFER_IN_CLOUD', cloud('PREFER_IN_CLOUD'));
  await run('ONLY_IN_CLOUD', cloud('ONLY_IN_CLOUD'));
  await run('ONLY_IN_CLOUD + Say schema (synthetic line)', () =>
    cloudCall(
      ai,
      { step: 'hello', mode: 'ONLY_IN_CLOUD', model: CONFIG_DEFAULTS.cloud_model, system: SAY_SYSTEM, user: composeSay(contextFor(SAY_BENCH[0]), ''), schema: SAY_SCHEMA },
      showOutgoing,
      receipt,
    ),
  );
  status.textContent = ' done';
  await save('modes', { browser: browserInfo(), rows, receipt: receipt.toJSON(), guard: egressGuard.events });
};

let listener: Listener | null = null;
const finals: { text: string; delayMs: number; at: number }[] = [];
$('speech-start').onclick = async () => {
  const status = $('speech-status');
  let state = await readSpeechState('en-US');
  const before = state;
  if (state !== 'available' && state !== 'missing' && state !== 'unavailable') {
    status.textContent = ' installing the English speech pack…';
    const ok = await installSpeech('en-US');
    state = await readSpeechState('en-US');
    log(`speech install: ${ok}, state ${before} → ${state}`);
  }
  if (state === 'missing' || state === 'unavailable') {
    status.textContent = ` on-device speech is ${state}: the partner types instead`;
    await save('speech', { browser: browserInfo(), before, state, finals: [] });
    return;
  }
  const t = $('transcript');
  try {
    listener = listen({
      onInterim: (text) => (t.innerHTML = `<span class="interim"></span>`, (t.firstChild as HTMLElement).textContent = text),
      onFinal: (text, delayMs) => {
        finals.push({ text, delayMs: Math.round(delayMs), at: Date.now() });
        t.textContent = text;
        log(`final (${Math.round(delayMs)} ms after the last interim): ${text}`);
      },
      onError: (code) => log(`speech error: ${code}`),
      onState: (on) => (status.textContent = on ? ' listening on this device' : ' stopped'),
    });
    $<HTMLButtonElement>('speech-stop').disabled = false;
  } catch (e) {
    status.textContent = ` ${(e as Error).message}`;
  }
  results.speechBefore = before;
};
$('speech-stop').onclick = async () => {
  listener?.stop();
  $<HTMLButtonElement>('speech-stop').disabled = true;
  const delays = finals.map((f) => f.delayMs);
  const summary = { n: finals.length, medianDelayMs: med(delays), p90DelayMs: p90(delays) };
  log('SPEECH', summary);
  await save('speech', { browser: browserInfo(), before: results.speechBefore, state: await readSpeechState('en-US'), summary, finals });
};

$('download').onclick = () => {
  const blob = new Blob([JSON.stringify({ ...results, receipt: receipt.toJSON() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sotto-step0-results.json';
  a.click();
};

void showCapability();
