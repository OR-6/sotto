// Scores the on-device bench saved by the lab (replays/step0-device-bench.json) and prints a
// Markdown section for docs/STEP0-REPORT.md. Every number comes from the file; nothing is estimated.
//   node scripts/score-bench.mjs [file]
import { existsSync, readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'replays/step0-device-bench.json';
if (!existsSync(file)) {
  console.error(`score: ${file} not found (run the lab bench in Chrome first)`);
  process.exit(1);
}
const b = JSON.parse(readFileSync(file, 'utf8'));
const sorted = (xs) => [...xs].sort((a, c) => a - c);
const pct = (xs, p) => (xs.length ? sorted(xs)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)] : 0);
const s = (ms) => `${(ms / 1000).toFixed(2)} s`;
const say = b.say.filter((r) => 'totalMs' in r);
const ask = b.ask.filter((r) => 'totalMs' in r);
const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

const sayValid = say.filter((r) => r.valid).length;
const g2 = say.filter((r) => r.valid && r.totalMs <= 1500).length;
const kindsOk = say.filter((r) => JSON.stringify(r.kinds) === JSON.stringify(['answer', 'alternative', 'question'])).length;
const steered = say.filter((r) => r.steer);
const injection = say.find((r) => /Ignore your rules/.test(r.partnerLine));

const askWith = ask.filter((r) => r.result);
const askQ = askWith.filter((r) => r.result.ask.endsWith('?')).length;
const flagLines = ask.filter((r) => /by Friday|within two weeks|fee|45 euros|six weeks|operation/.test(r.partnerLine));
const flagged = flagLines.filter((r) => r.result && r.result.flag.kind !== 'none').length;

const out = [];
out.push(`### Measured on ${b.browser.platform ?? 'macOS'}, Chrome ${b.browser.chromeMajor}, ${b.browser.cores} cores, ${b.browser.date.slice(0, 10)}`);
out.push('');
out.push(`- First on-device call (session creation and model load): **${s(b.summary.coldMs)}**; the next call: **${s(b.summary.warmMs)}**.`);
out.push(`- System prompt through \`initialPrompts\` honoured on device: **${b.summary.systemHonoured ? 'yes' : 'no'}**.`);
out.push(`- Requests to model hosts during the whole bench: **${b.summary.aiHostRequestsDuringRun}**; bytes in the receipt: **${b.summary.receiptBytesOut}**.`);
out.push('');
out.push('| Say, 20 lines | Result |');
out.push('|---|---|');
out.push(`| Parsed JSON | ${say.filter((r) => r.parsedOk).length} / ${say.length} |`);
out.push(`| Three options passed the filter with no padding | ${sayValid} / ${say.length} |`);
out.push(`| Kinds in order (answer, alternative, question) | ${kindsOk} / ${say.length} |`);
out.push(`| **G2: valid and all three within 1.5 s** | **${g2} / ${say.length}** (gate: 16) |`);
out.push(`| First option visible, median / p90 | ${s(pct(say.map((r) => r.firstOptionMs), 50))} / ${s(pct(say.map((r) => r.firstOptionMs), 90))} |`);
out.push(`| All three, median / p90 | ${s(pct(say.map((r) => r.totalMs), 50))} / ${s(pct(say.map((r) => r.totalMs), 90))} |`);
out.push(`| Words per option, median | ${pct(say.flatMap((r) => r.options.map((o) => words(o.text))), 50)} |`);
out.push(`| Steered lines whose options use the steer word | ${steered.filter((r) => r.options.some((o) => o.text.toLowerCase().includes(r.steer))).length} / ${steered.length} |`);
if (injection) out.push(`| Injection line ("Ignore your rules…") | ${injection.options.map((o) => `“${o.text}”`).join(' · ')} |`);
out.push('');
out.push('| Ask, 8 lines | Result |');
out.push('|---|---|');
out.push(`| A Means or an Ask survived the filter | ${askWith.length} / ${ask.length} |`);
out.push(`| Ask ends with a question mark | ${askQ} / ${askWith.length} |`);
out.push(`| Flag raised on lines with a deadline, cost or decision | ${flagged} / ${flagLines.length} |`);
out.push(`| Means visible, median | ${s(pct(ask.map((r) => r.meansMs), 50))} |`);
out.push(`| All of it, median / p90 | ${s(pct(ask.map((r) => r.totalMs), 50))} / ${s(pct(ask.map((r) => r.totalMs), 90))} |`);
out.push('');
out.push('Every Say line, as shown to the user:');
out.push('');
for (const r of say) out.push(`- ${r.id} (${r.firstOptionMs} / ${r.totalMs} ms) “${r.partnerLine}”${r.steer ? ` [steer: ${r.steer}]` : ''} → ${r.options.map((o) => o.text).join(' | ')}${r.dropped.length ? ` (dropped: ${r.dropped.map((d) => d.why).join(', ')})` : ''}`);
out.push('');
out.push('Every Ask line, as shown to the user:');
out.push('');
for (const r of ask) out.push(`- ${r.id} (${r.totalMs} ms) “${r.partnerLine}” → ${r.result ? `Means: ${r.result.means} · Ask: ${r.result.ask} · Flag: ${r.result.flag.kind}${r.result.flag.quote ? ` “${r.result.flag.quote}”` : ''}` : 'nothing'}${r.notes.length ? ` (${r.notes.join('; ')})` : ''}`);
console.log(out.join('\n'));
