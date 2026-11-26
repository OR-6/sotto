// The ONLY module that may create a cloud-capable model (invariant I2, enforced by check:ai).
//
// Every call here:
//   1. needs an approval for its exact outgoing text: either the user approved this one call
//      on the outgoing-text pane (Prepare, voice pack, summary), or the user switched on
//      Cloud live mode for this session, with the red banner showing (I3);
//   2. arms a one-shot egress permit for exactly that text, so the network layer lets
//      nothing else through (egress-guard.ts);
//   3. records the step in the receipt, with the bytes sent and the SHA-256 (I4).
import { getGenerativeModel, InferenceMode, InferenceSource, type AI, type SchemaRequest } from 'firebase/ai';
import type { Receipt } from '../core/receipt';
import { EN_TEXT_ONLY } from './capability';
import { egressGuard } from './install-guard';

export type CloudMode = 'PREFER_IN_CLOUD' | 'ONLY_IN_CLOUD' | 'PREFER_ON_DEVICE';

const MODES: Record<CloudMode, InferenceMode> = {
  PREFER_IN_CLOUD: InferenceMode.PREFER_IN_CLOUD,
  ONLY_IN_CLOUD: InferenceMode.ONLY_IN_CLOUD,
  PREFER_ON_DEVICE: InferenceMode.PREFER_ON_DEVICE,
};

/** What will leave the device, shown to the user before it is sent. */
export type Outgoing = { step: string; mode: CloudMode; model: string; system: string; user: string };

/** Approval for one call. The UI resolves true only after the user saw `outgoing` and agreed. */
export type Approver = (outgoing: Outgoing) => Promise<boolean>;

export type CloudRequest = {
  step: string;
  mode: CloudMode;
  model: string;
  system: string;
  user: string;
  /** Plain JSON Schema (lowercase types). Converted for the cloud backend. */
  schema?: object;
  /** Used when the SDK runs the call on device instead (PREFER_IN_CLOUD offline, PREFER_ON_DEVICE). */
  device?: { system: string; schema?: object };
  signal?: AbortSignal;
};

export type CloudAnswer = { text: string; source: 'on_device' | 'in_cloud'; ms: number; model: string; bytesOut: number };

export class CloudDeclinedError extends Error {
  constructor() {
    super('Nothing was sent: you chose not to send it.');
    this.name = 'CloudDeclinedError';
  }
}
export class CloudOffError extends Error {
  constructor() {
    super('Cloud steps are switched off right now.');
    this.name = 'CloudOffError';
  }
}
export class CloudError extends Error {
  constructor(message: string, readonly kind: 'offline' | 'rate-limit' | 'app-check' | 'other') {
    super(message);
    this.name = 'CloudError';
  }
}

export function classifyCloudError(e: unknown): CloudError {
  const m = String((e as Error)?.message ?? e);
  if (/\b429\b|RESOURCE_EXHAUSTED|quota/i.test(m)) return new CloudError('Too many requests right now. Try again in a minute.', 'rate-limit');
  if (/\b401\b|\b403\b|App Check|UNAUTHENTICATED|PERMISSION_DENIED/i.test(m)) return new CloudError('The cloud refused this browser (App Check). Reload the page and try again.', 'app-check');
  if (/fetch|network|Failed to fetch|offline|FETCH_ERROR/i.test(m)) {
    // The SDK reports a refused App Check token the same way as a network failure.
    const online = typeof navigator === 'undefined' || navigator.onLine;
    return online
      ? new CloudError('The cloud did not answer this page. You are online, so App Check may not accept this site yet. The receipt shows whether anything left.', 'app-check')
      : new CloudError('You are offline, so the cloud cannot be reached.', 'offline');
  }
  return new CloudError(`The cloud step failed: ${m.slice(0, 160)}`, 'other');
}

/** Converts a plain JSON Schema into the SDK's SchemaRequest shape (enum strings need format: 'enum'). */
export function toCloudSchema(s: object): SchemaRequest {
  const node = s as Record<string, unknown>;
  const out: Record<string, unknown> = { ...node };
  if (node.type === 'string' && Array.isArray(node.enum)) out.format = 'enum';
  if (node.properties && typeof node.properties === 'object') {
    out.properties = Object.fromEntries(Object.entries(node.properties as Record<string, object>).map(([k, v]) => [k, toCloudSchema(v)]));
  }
  if (node.items && typeof node.items === 'object') out.items = toCloudSchema(node.items as object);
  return out as unknown as SchemaRequest;
}

/** Runtime state the cloud module reads; set by the app from Remote Config and the user's switches. */
export const cloudState = { enabled: true, liveSession: false };

/**
 * Turns Cloud live mode on for this session. Only the UI's explicit switch calls this, and it
 * must show the red banner while it is on.
 */
export function setCloudLive(on: boolean): void {
  cloudState.liveSession = on;
}

export async function cloudCall(ai: AI, req: CloudRequest, approve: Approver, receipt: Receipt): Promise<CloudAnswer> {
  if (!cloudState.enabled) throw new CloudOffError();
  const outgoing: Outgoing = { step: req.step, mode: req.mode, model: req.model, system: req.system, user: req.user };
  if (req.mode === 'PREFER_ON_DEVICE' && !cloudState.liveSession) throw new CloudDeclinedError();
  if (!(await approve(outgoing))) throw new CloudDeclinedError();
  if (req.signal?.aborted) throw new DOMException('The call was superseded.', 'AbortError');

  const model = getGenerativeModel(ai, {
    mode: MODES[req.mode],
    inCloudParams: {
      model: req.model,
      systemInstruction: req.system,
      generationConfig: req.schema ? { responseMimeType: 'application/json', responseSchema: toCloudSchema(req.schema) } : {},
    },
    onDeviceParams: req.device
      ? {
          createOptions: { ...EN_TEXT_ONLY, initialPrompts: [{ role: 'system', content: [{ type: 'text', value: req.device.system }] }] },
          promptOptions: req.device.schema ? { responseConstraint: req.device.schema } : {},
        }
      : { createOptions: { ...EN_TEXT_ONLY } },
  });

  // The network lets through exactly one request whose text parts are these two strings.
  const structural = req.schema ? collectSchemaStrings(req.schema) : [];
  const disarm = egressGuard.armCloudPermit({ texts: [req.system, req.user], structural });
  const t0 = performance.now();
  const outText = `${req.system}\n\n${req.user}`;
  const eventsBefore = egressGuard.events.length;
  // Bytes are counted where they leave: the egress guard logs every request it let through.
  const sentBytes = () => egressGuard.events.slice(eventsBefore).filter((e) => e.outcome === 'allowed').reduce((n, e) => n + e.bytes, 0);
  try {
    const result = await model.generateContent(req.user, req.signal ? { signal: req.signal } : undefined);
    const source = result.response.inferenceSource === InferenceSource.ON_DEVICE ? 'on_device' : 'in_cloud';
    const ms = performance.now() - t0;
    const bytes = sentBytes();
    await receipt.recordCloud({ step: req.step, mode: req.mode, ms, where: source, outgoing: outText, bytes });
    return { text: result.response.text(), source, ms, model: req.model, bytesOut: bytes };
  } catch (e) {
    // A failed call may still have sent the text (e.g. the reply never arrived): count what left.
    await receipt.recordCloud({ step: req.step, mode: req.mode, ms: performance.now() - t0, where: 'failed', outgoing: outText, bytes: sentBytes(), note: String((e as Error)?.message ?? e).slice(0, 120) });
    throw classifyCloudError(e);
  } finally {
    disarm();
  }
}

/** Schema descriptions or enum values longer than a structural token must be listed in the permit. */
function collectSchemaStrings(s: object): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => (out.push(k), walk(x)));
  };
  walk(s);
  return out;
}

/**
 * Cloud live mode's backend: the same live prompts in PREFER_ON_DEVICE, so the device runs them
 * when it has the model and the cloud otherwise. It refuses every call unless the user switched
 * Cloud live mode on for this session (the red banner is visible while it is on).
 */
export function createCloudLiveBackend(ai: AI, model: string, receipt: Receipt, prompts: { saySystem: string; saySchema: object; askSystem: string; askSchema: object }) {
  const sessionApproval: Approver = async () => cloudState.liveSession;
  const call = (step: 'say' | 'ask', system: string, schema: object) => async (prompt: string, onText: (s: string) => void, signal: AbortSignal) => {
    const r = await cloudCall(ai, { step: `${step} (cloud live)`, mode: 'PREFER_ON_DEVICE', model, system, user: prompt, schema, device: { system, schema }, signal }, sessionApproval, receipt);
    onText(r.text);
    return { text: r.text, ms: r.ms, source: r.source };
  };
  return {
    mode: 'PREFER_ON_DEVICE',
    say: call('say', prompts.saySystem, prompts.saySchema),
    ask: call('ask', prompts.askSystem, prompts.askSchema),
  };
}
