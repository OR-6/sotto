// How a Say prompt is written and its reply read. Two formats:
// - JSON: {"options":[{text,kind}]} with a schema. Used in the cloud (Cloud live mode).
// - LINES: three plain lines "A: / B: / Q:", no schema. Used on device: measured on Chrome 157
//   (10 cores, 16 GB), the median time to all three fell from 3.01 s to 1.85 s and to the first
//   option from 1.67 s to 1.22 s, with 10/10 valid (replays/step0-latency-variants.json).
import { buildContext, type ContextInput } from './context';
import { filterSay, parseJson, type SayFiltered } from './filter';
import { parseSayLines, SAY_LINES_SYSTEM, sayLinesInstruction } from './prompts/say-lines';
import { SAY_SCHEMA, SAY_SYSTEM, sayInstruction } from './prompts/say';
import { partialSayTexts } from './stream';

export type SayFormat = {
  readonly id: 'json' | 'lines';
  readonly system: string;
  /** JSON Schema for structured output, or undefined for free text. */
  readonly schema?: object;
  compose(c: ContextInput, steer: string): string;
  /** Option texts already complete in a partial reply. */
  partial(soFar: string): string[];
  /** The checked, padded three options from a full reply. */
  final(text: string, partnerLine: string): SayFiltered;
};

export const JSON_FORMAT: SayFormat = {
  id: 'json',
  system: SAY_SYSTEM,
  schema: SAY_SCHEMA,
  compose: (c, steer) => `${buildContext(c)}\n\n${sayInstruction(steer)}`,
  partial: (soFar) => partialSayTexts(soFar),
  final: (text, line) => filterSay(parseJson(text), line),
};

export const LINES_FORMAT: SayFormat = {
  id: 'lines',
  system: SAY_LINES_SYSTEM,
  compose: (c, steer) => `${buildContext(c)}\n\n${sayLinesInstruction(steer)}`,
  partial: (soFar) => parseSayLines(soFar, false).map((o) => o.text),
  final: (text, line) => filterSay({ options: parseSayLines(text) }, line),
};
