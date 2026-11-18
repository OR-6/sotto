// The voice pack: from phrases the user chose and five answers, the cloud writes how this person
// talks and about sixty phrases in their voice. A short digest of it shapes every Say suggestion.

export const VOICE_GROUPS = ['greetings', 'yes', 'no', 'maybe', 'questions', 'thanks', 'humour', 'needs', 'goodbye'] as const;
export type VoiceGroup = (typeof VOICE_GROUPS)[number];
export type VoicePack = { style: string; phrases: Record<VoiceGroup, string[]> };

export type VoiceAnswers = {
  register: 'casual' | 'neutral' | 'formal';
  swearing: boolean;
  humour: 'none' | 'dry' | 'playful';
  greeting: string;
  neverSay: string;
};

export const VOICE_SYSTEM = [
  'From the phrases a person wrote and their answers about how they talk, describe how this person talks in a style guide of at most 90 words:',
  'register, sentence length, favourite words, how they greet, how they disagree, what they never say.',
  'Then write short phrases in their voice, each under 10 words, grouped as greetings, yes, no, maybe, questions, thanks, humour, needs, goodbye (five to eight per group).',
  'Stay close to the examples. Do not invent facts about their life, names or health. JSON only.',
].join(' ');

export const VOICE_SCHEMA = {
  type: 'object',
  properties: {
    style: { type: 'string' },
    phrases: {
      type: 'object',
      properties: Object.fromEntries(VOICE_GROUPS.map((g) => [g, { type: 'array', maxItems: 8, items: { type: 'string' } }])),
      required: [...VOICE_GROUPS],
    },
  },
  required: ['style', 'phrases'],
} as const;

/** The exact text sent: the user's phrases and answers, nothing else. */
export function voiceUser(phrases: readonly string[], a: VoiceAnswers): string {
  return [
    'Phrases I use:',
    ...phrases.map((p) => `- ${p}`),
    '',
    `I talk: ${a.register}. Swearing: ${a.swearing ? 'sometimes' : 'never'}. Humour: ${a.humour}.`,
    a.greeting ? `How I greet people: ${a.greeting}` : '',
    a.neverSay ? `I never say: ${a.neverSay}` : '',
  ]
    .filter((l) => l !== undefined)
    .join('\n')
    .trim();
}

const clean = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function toVoicePack(raw: unknown): VoicePack | null {
  const r = raw as { style?: unknown; phrases?: Record<string, unknown> } | undefined;
  if (!r || typeof r !== 'object') return null;
  const phrases = Object.fromEntries(VOICE_GROUPS.map((g) => [g, Array.isArray(r.phrases?.[g]) ? (r.phrases![g] as unknown[]).map((p) => clean(p, 80)).filter(Boolean).slice(0, 8) : []])) as Record<VoiceGroup, string[]>;
  const style = clean(r.style, 700);
  if (!style && !Object.values(phrases).some((p) => p.length)) return null;
  return { style, phrases };
}

/** About 120 words for the small model: the style guide and a few phrases. */
export function voiceDigest(p: VoicePack): string {
  const sample = VOICE_GROUPS.flatMap((g) => p.phrases[g].slice(0, 1)).slice(0, 8);
  const words = `${p.style} Sounds like: ${sample.join(' / ')}`.split(/\s+/);
  return words.slice(0, 120).join(' ');
}
