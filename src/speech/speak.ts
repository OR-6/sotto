// Text-to-speech with offline voices only (`localService === true`).

export type VoiceLike = { name: string; lang: string; localService: boolean; default?: boolean; voiceURI?: string };

/** Novelty voices (singing, whispering, effects) are not offered as someone's voice. */
const NOVELTY = /^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Pipe Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Junior|Ralph|Fred|Kathy)\b/i;

export function offlineVoices(voices: readonly VoiceLike[], langPrefix = 'en'): VoiceLike[] {
  return voices
    .filter((v) => v.localService && v.lang.toLowerCase().startsWith(langPrefix) && !NOVELTY.test(v.name))
    .sort((a, b) => Number(Boolean(b.default)) - Number(Boolean(a.default)) || a.name.localeCompare(b.name));
}

/** Voices load asynchronously in Chrome; resolves once the list is populated (or after 1.5 s). */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === 'undefined') return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export type SpeakOptions = { voiceName?: string; rate?: number; onEnd?: () => void };

/** Speaks `text` with an offline voice. Returns false if no offline voice exists (the partner side still shows it). */
export function speak(text: string, opts: SpeakOptions = {}): boolean {
  if (typeof speechSynthesis === 'undefined' || typeof SpeechSynthesisUtterance === 'undefined') return false;
  const voices = speechSynthesis.getVoices();
  const offline = offlineVoices(voices) as SpeechSynthesisVoice[];
  const voice = offline.find((v) => v.name === opts.voiceName) ?? offline[0];
  if (!voice) return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = opts.rate ?? 1;
  if (opts.onEnd) {
    // Exactly once, whether speech ends, fails or is cancelled: the microphone must come back.
    let done = false;
    const end = () => (done ? undefined : ((done = true), opts.onEnd!()));
    u.onend = end;
    u.onerror = end;
  }
  speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
