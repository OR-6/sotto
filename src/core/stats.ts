// Session stats for Say: answers given, time from the partner's line to the answer, words per minute.
import { wordCount } from './turns';

export type Answer = { askedAt: number; answeredAt: number; text: string; via: 'option' | 'quick' | 'typed' | 'hold' };

export type Stats = { answers: number; medianMs: number; meanMs: number; words: number; wpm: number };

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function percentile(xs: readonly number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/**
 * Words per minute counts only the time the user spent composing (partner line → answer),
 * which is how AAC output rate is usually reported. Hold-the-floor taps are not answers.
 */
export function computeStats(answers: readonly Answer[]): Stats {
  const real = answers.filter((a) => a.via !== 'hold' && a.answeredAt >= a.askedAt);
  const times = real.map((a) => a.answeredAt - a.askedAt);
  const words = real.reduce((n, a) => n + wordCount(a.text), 0);
  const totalMin = times.reduce((a, b) => a + b, 0) / 60_000;
  return {
    answers: real.length,
    medianMs: median(times),
    meanMs: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0,
    words,
    wpm: totalMin > 0 ? Math.round(words / totalMin) : 0,
  };
}
