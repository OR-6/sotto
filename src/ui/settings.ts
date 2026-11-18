// Settings: voice, tone, look, scanning, quick phrases, clearing everything.
import { QUICK_PHRASES } from '../core/filter';
import { loadVoices, offlineVoices, speak } from '../speech/speak';
import { h } from './dom';
import { DEFAULT_SETTINGS, saveSettings, savePhrases, state, type Settings } from './state';
import { clearAll } from './store';

function radioGroup<K extends keyof Settings>(key: K, label: string, options: [Settings[K], string][]): HTMLElement {
  const name = `set-${String(key)}`;
  return h(
    'fieldset',
    { class: 'setting' },
    h('legend', {}, label),
    h(
      'div',
      { class: 'row' },
      options.map(([value, text]) => {
        const input = h('input', { type: 'radio', name, value: String(value), checked: state.settings[key] === value });
        input.addEventListener('change', () => input.checked && saveSettings({ [key]: value } as Partial<Settings>));
        return h('label', { class: 'radio' }, input, h('span', {}, text));
      }),
    ),
  );
}

function toggle<K extends keyof Settings>(key: K, label: string, hint: string): HTMLElement {
  const input = h('input', { type: 'checkbox', checked: Boolean(state.settings[key]), id: `set-${String(key)}` });
  input.addEventListener('change', () => saveSettings({ [key]: input.checked } as Partial<Settings>));
  return h('label', { class: 'consent setting-toggle', for: `set-${String(key)}` }, input, h('span', {}, h('strong', {}, label), h('br', {}), h('span', { class: 'muted' }, hint)));
}

export async function openSettings(onClose: () => void): Promise<void> {
  document.getElementById('settings')?.remove();
  const voices = offlineVoices(await loadVoices());
  const voiceSelect = h('select', { class: 'text-input', id: 'set-voice', 'aria-label': 'Voice' }, voices.length ? voices.map((v) => h('option', { value: v.name, selected: v.name === state.settings.voiceName }, `${v.name} (${v.lang})`)) : h('option', { value: '' }, 'No offline voice on this device'));
  voiceSelect.addEventListener('change', () => saveSettings({ voiceName: voiceSelect.value }));
  const rate = h('input', { type: 'range', min: '0.6', max: '1.6', step: '0.1', value: String(state.settings.rate), id: 'set-rate', 'aria-label': 'Speaking rate' });
  rate.addEventListener('change', () => saveSettings({ rate: Number(rate.value) }));
  const test = h('button', { class: 'btn small' }, 'Hear it');
  test.addEventListener('click', () => speak('Hello, this is how I sound.', { voiceName: state.settings.voiceName, rate: state.settings.rate }));
  const scanRate = h('input', { type: 'range', min: '0.6', max: '3', step: '0.1', value: String(state.settings.scanRateMs / 1000), id: 'set-scan-rate', 'aria-label': 'Scanning step in seconds' });
  const scanOut = h('output', { for: 'set-scan-rate' }, `${(state.settings.scanRateMs / 1000).toFixed(1)} s`);
  scanRate.addEventListener('input', () => (scanOut.textContent = `${Number(scanRate.value).toFixed(1)} s`));
  scanRate.addEventListener('change', () => saveSettings({ scanRateMs: Math.round(Number(scanRate.value) * 1000) }));

  const phrases = h('textarea', { class: 'text-input', id: 'set-phrases', rows: 6, 'aria-label': 'Quick phrases, one per line' });
  phrases.value = state.phrases.join('\n');
  phrases.addEventListener('change', () => savePhrases(phrases.value.split('\n').map((p) => p.trim()).filter(Boolean).slice(0, 24)));
  const resetPhrases = h('button', { class: 'btn small' }, 'Back to the default phrases');
  resetPhrases.addEventListener('click', () => {
    savePhrases([...QUICK_PHRASES]);
    phrases.value = state.phrases.join('\n');
  });
  const cleared = h('span', { class: 'muted', role: 'status' });
  const clearBtn = h('button', { class: 'btn danger small', id: 'clear-all' }, 'Clear everything Sotto saved here');
  clearBtn.addEventListener('click', () => {
    clearAll();
    Object.assign(state.settings, DEFAULT_SETTINGS);
    savePhrases([...QUICK_PHRASES]);
    state.brief = null;
    state.useBrief = false;
    cleared.textContent = 'Cleared: settings, phrases, briefs, saved numbers, and the Firebase identifiers and tokens a cloud step stored.';
  });

  const close = h('button', { class: 'btn small', 'data-close': '' }, 'Done');
  const d = h(
    'dialog',
    { id: 'settings', 'aria-labelledby': 'settings-title' },
    h('div', { class: 'dialog-head' }, h('h2', { id: 'settings-title' }, 'Settings'), close),
    h(
      'div',
      { class: 'dialog-body settings' },
      h('h3', {}, 'Voice'),
      h('p', { class: 'muted' }, 'Only voices that work offline are listed.'),
      h('div', { class: 'row' }, voiceSelect, test),
      h('label', { class: 'field-label', for: 'set-rate' }, 'Speaking rate'),
      rate,
      h('h3', {}, 'How suggestions sound'),
      radioGroup('tone', 'Tone', [
        ['casual', 'Casual'],
        ['neutral', 'Neutral'],
        ['formal', 'Formal'],
      ]),
      toggle('joke', 'Add a light joke now and then', 'For people who miss being the funny one.'),
      h('h3', {}, 'Look'),
      radioGroup('theme', 'Theme', [
        ['auto', 'Follow the device'],
        ['dark', 'Dark'],
        ['light', 'Light'],
        ['contrast', 'High contrast'],
      ]),
      radioGroup('size', 'Text size', [
        ['normal', 'Large'],
        ['large', 'Larger'],
      ]),
      h('h3', {}, 'Switch scanning'),
      toggle('scan', 'Scan when a conversation starts', 'Space selects. Hold Space for one second to turn scanning on or off. Enter moves on, for two switches.'),
      h('label', { class: 'field-label', for: 'set-scan-rate' }, 'Time on each item'),
      h('div', { class: 'row' }, scanRate, scanOut),
      toggle('shortcuts', 'Single-key shortcuts', '1, 2 and 3 say a suggestion, H holds the floor, / jumps to typing. Switch off if keys get pressed by accident.'),
      h('h3', {}, 'Quick phrases'),
      h('p', { class: 'muted' }, 'One per line. They are always at the bottom of the screen and speak at once.'),
      phrases,
      h('div', { class: 'row', style: 'margin-top:8px' }, resetPhrases),
      h('h3', {}, 'On this device'),
      h('p', { class: 'muted' }, 'Sotto keeps only what you save: settings, phrases, briefs you keep and session numbers. Never what was said, never the receipt.'),
      h('div', { class: 'row' }, clearBtn, cleared),
    ),
  );
  close.addEventListener('click', () => d.close());
  d.addEventListener('close', () => {
    d.remove();
    onClose();
  });
  document.body.append(d);
  d.showModal();
}
