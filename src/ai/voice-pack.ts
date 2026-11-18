// The voice pack: ONLY_IN_CLOUD (quality matters, and the user chose exactly what to send).
import type { AI } from 'firebase/ai';
import { parseJson } from '../core/filter';
import { toVoicePack, VOICE_SCHEMA, VOICE_SYSTEM, voiceUser, type VoiceAnswers, type VoicePack } from '../core/prompts/voice';
import type { Receipt } from '../core/receipt';
import { cloudCall, type Approver, type Outgoing } from './cloud';

export function voiceOutgoing(phrases: readonly string[], a: VoiceAnswers, model: string): Outgoing {
  return { step: 'voice pack', mode: 'ONLY_IN_CLOUD', model, system: VOICE_SYSTEM, user: voiceUser(phrases, a) };
}

export async function buildVoicePack(ai: AI, phrases: readonly string[], a: VoiceAnswers, model: string, approve: Approver, receipt: Receipt): Promise<{ pack: VoicePack; ms: number; bytesOut: number }> {
  const r = await cloudCall(ai, { step: 'voice pack', mode: 'ONLY_IN_CLOUD', model, system: VOICE_SYSTEM, user: voiceUser(phrases, a), schema: VOICE_SCHEMA }, approve, receipt);
  const pack = toVoicePack(parseJson(r.text));
  if (!pack) throw new Error('The voice pack came back empty. Try a few more phrases.');
  return { pack, ms: r.ms, bytesOut: r.bytesOut };
}
