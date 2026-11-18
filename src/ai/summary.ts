// Summary: the cloud's job after a conversation (PREFER_IN_CLOUD, only the ticked lines,
// shown before sending), or the same on the device only.
import type { AI } from 'firebase/ai';
import { parseJson } from '../core/filter';
import { SUMMARY_DEVICE_SYSTEM, SUMMARY_SCHEMA, SUMMARY_SYSTEM, summaryUser, toSummary, type Summary, type SummaryLine } from '../core/prompts/summary';
import type { Receipt } from '../core/receipt';
import { cloudCall, type Approver, type Outgoing } from './cloud';
import { createDeviceOnlyModel } from './models';

export type SummaryResult = { summary: Summary; source: 'on_device' | 'in_cloud'; ms: number; bytesOut: number };

export function summaryOutgoing(lines: readonly SummaryLine[], model: string): Outgoing {
  return { step: 'summary', mode: 'PREFER_IN_CLOUD', model, system: SUMMARY_SYSTEM, user: summaryUser(lines) };
}

export async function summariseInCloud(ai: AI, lines: readonly SummaryLine[], model: string, approve: Approver, receipt: Receipt): Promise<SummaryResult> {
  const r = await cloudCall(ai, { step: 'summary', mode: 'PREFER_IN_CLOUD', model, system: SUMMARY_SYSTEM, user: summaryUser(lines), schema: SUMMARY_SCHEMA, device: { system: SUMMARY_DEVICE_SYSTEM, schema: SUMMARY_SCHEMA } }, approve, receipt);
  const summary = toSummary(parseJson(r.text));
  if (!summary) throw new Error('The summary came back empty.');
  return { summary, source: r.source, ms: r.ms, bytesOut: r.bytesOut };
}

export async function summariseOnDevice(ai: AI, lines: readonly SummaryLine[], receipt: Receipt, env: object = globalThis): Promise<SummaryResult> {
  const m = createDeviceOnlyModel(ai, { system: SUMMARY_DEVICE_SYSTEM, schema: SUMMARY_SCHEMA }, env);
  const r = await m.generate(summaryUser(lines));
  receipt.recordDevice({ step: 'summary (on device)', mode: 'ONLY_ON_DEVICE', ms: r.ms });
  const summary = toSummary(parseJson(r.text));
  if (!summary) throw new Error('The on-device summary came back empty.');
  return { summary, source: 'on_device', ms: r.ms, bytesOut: 0 };
}
