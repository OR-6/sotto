// Prepare: the cloud's job before a conversation (PREFER_IN_CLOUD, with the SDK falling back to
// the device when the cloud cannot be reached), or the same on the device only.
import type { AI } from 'firebase/ai';
import { parseJson } from '../core/filter';
import { PREPARE_DEVICE_SCHEMA, PREPARE_DEVICE_SYSTEM, PREPARE_SCHEMA, PREPARE_SYSTEM, prepareUser, toBrief, type Brief } from '../core/prompts/prepare';
import type { Receipt } from '../core/receipt';
import { cloudCall, type Approver, type Outgoing } from './cloud';
import { createDeviceOnlyModel } from './models';

export type PrepareResult = { brief: Brief; source: 'on_device' | 'in_cloud'; ms: number; bytesOut: number };

/** What would leave the device for this situation line (shown before sending). */
export function prepareOutgoing(situation: string, model: string): Outgoing {
  return { step: 'prepare', mode: 'PREFER_IN_CLOUD', model, system: PREPARE_SYSTEM, user: prepareUser(situation) };
}

export async function prepareInCloud(ai: AI, situation: string, model: string, approve: Approver, receipt: Receipt): Promise<PrepareResult> {
  const r = await cloudCall(
    ai,
    { step: 'prepare', mode: 'PREFER_IN_CLOUD', model, system: PREPARE_SYSTEM, user: prepareUser(situation), schema: PREPARE_SCHEMA, device: { system: PREPARE_DEVICE_SYSTEM, schema: PREPARE_DEVICE_SCHEMA } },
    approve,
    receipt,
  );
  const brief = toBrief(parseJson(r.text));
  if (!brief) throw new Error('The brief came back empty. Try describing the situation in a few more words.');
  return { brief, source: r.source, ms: r.ms, bytesOut: r.bytesOut };
}

export async function prepareOnDevice(ai: AI, situation: string, receipt: Receipt, env: object = globalThis): Promise<PrepareResult> {
  const m = createDeviceOnlyModel(ai, { system: PREPARE_DEVICE_SYSTEM, schema: PREPARE_DEVICE_SCHEMA }, env);
  const r = await m.generate(prepareUser(situation));
  receipt.recordDevice({ step: 'prepare (on device)', mode: 'ONLY_ON_DEVICE', ms: r.ms });
  const brief = toBrief(parseJson(r.text));
  if (!brief) throw new Error('The on-device brief came back empty.');
  return { brief, source: 'on_device', ms: r.ms, bytesOut: 0 };
}
