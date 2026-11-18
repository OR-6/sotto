// App-wide state. Session data (turns, suggestions, the receipt) lives only in memory here.
import type { DeviceState } from '../ai/capability';
import { DEFAULT_CONFIG, type AppConfig } from '../config';
import type { Tone } from '../core/context';
import { QUICK_PHRASES } from '../core/filter';
import { createReceipt } from '../core/receipt';
import type { Answer } from '../core/stats';
import type { Brief } from '../core/prompts/prepare';
import type { SpeechState } from '../speech/recognise';
import { load, save } from './store';

export type Theme = 'auto' | 'dark' | 'light' | 'contrast';
export type Settings = {
  consent: boolean;
  theme: Theme;
  size: 'normal' | 'large';
  tone: Tone;
  joke: boolean;
  voiceName: string;
  rate: number;
  flipPartner: boolean;
  /** "I am the one who cannot speak": everything heard is the other person. */
  allHeardIsPartner: boolean;
  /** Switch scanning: on at session start, and the step time. */
  scan: boolean;
  scanRateMs: number;
};

export const DEFAULT_SETTINGS: Settings = {
  consent: false,
  theme: 'auto',
  size: 'normal',
  tone: 'neutral',
  joke: false,
  voiceName: '',
  rate: 1,
  flipPartner: false,
  allHeardIsPartner: true,
  scan: false,
  scanRateMs: 1200,
};

export const state = {
  settings: { ...DEFAULT_SETTINGS, ...load<Partial<Settings>>('settings', {}) },
  phrases: load<string[]>('phrases', [...QUICK_PHRASES]),
  device: 'missing' as DeviceState,
  speech: 'missing' as SpeechState,
  voices: 0,
  config: DEFAULT_CONFIG as AppConfig,
  /** Cloud live mode for this session only. Never persisted, never the default. */
  cloudLive: false,
  mode: 'say' as 'say' | 'ask',
  pack: 'cafe',
  situationText: '',
  partnerLabel: '',
  warmMs: 0,
  /** Recorded on-device sessions available for Replay. */
  replays: 0,
  receipt: createReceipt(),
  brief: null as Brief | null,
  useBrief: false,
  answers: [] as Answer[],
};

export function saveSettings(patch: Partial<Settings>): void {
  Object.assign(state.settings, patch);
  save('settings', state.settings);
  applyTheme();
}

export function savePhrases(p: string[]): void {
  state.phrases = p;
  save('phrases', p);
}

export function applyTheme(): void {
  const root = document.documentElement;
  if (state.settings.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = state.settings.theme;
  root.dataset.size = state.settings.size;
}
