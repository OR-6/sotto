// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScanner } from '../src/ui/scan';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  document.body.innerHTML = '<button id="a">A</button><button id="b" disabled>B</button><div hidden><button id="c">C</button></div><button id="d">D</button>';
  const clicks: string[] = [];
  document.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => clicks.push(b.id)));
  const items = () => Array.from(document.querySelectorAll<HTMLElement>('button'));
  const s = createScanner({ items, rateMs: 1000 });
  const key = (type: 'keydown' | 'keyup', code = 'Space', key = ' ') => document.body.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true }));
  return { s, clicks, key };
}

describe('switch scanning', () => {
  it('steps over disabled and hidden targets at the set rate', () => {
    const { s } = setup();
    s.start();
    expect(document.querySelector('.scan')?.id).toBe('a');
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.scan')?.id).toBe('d');
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('.scan')?.id).toBe('a');
    s.dispose();
  });
  it('one switch: a short Space press selects the highlighted target and restarts from the top', () => {
    const { s, clicks, key } = setup();
    s.start();
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(0);
    key('keydown');
    key('keyup');
    expect(clicks).toEqual(['d']);
    expect(document.querySelector('.scan')?.id).toBe('a');
    s.dispose();
  });
  it('holding Space for a second turns scanning on; a slow release while scanning never turns it off', () => {
    const { s, key, clicks } = setup();
    key('keydown');
    vi.advanceTimersByTime(1000);
    key('keyup');
    expect(s.on).toBe(true);
    expect(clicks).toEqual([]);
    vi.advanceTimersByTime(700);
    key('keydown');
    vi.advanceTimersByTime(1500);
    key('keyup');
    expect(s.on).toBe(true);
    s.stop();
    expect(document.querySelector('.scan')).toBeNull();
    s.dispose();
  });

  it('keeps the highlight on the same element when targets change, and ignores a select right after', () => {
    const { s, key, clicks } = setup();
    s.start();
    vi.advanceTimersByTime(1000); // on D
    vi.advanceTimersByTime(700);
    const a = document.getElementById('a') as HTMLButtonElement;
    a.disabled = true; // the list shrinks: D must stay highlighted
    key('keydown');
    key('keyup');
    expect(clicks).toEqual([]); // ignored: the targets just changed
    expect(document.querySelector('.scan')?.id).toBe('d');
    vi.advanceTimersByTime(600);
    key('keydown');
    key('keyup');
    expect(clicks).toEqual(['d']);
    s.dispose();
  });

  it('pauses while a dialog is open', () => {
    const { s, key, clicks } = setup();
    s.start();
    vi.advanceTimersByTime(700);
    const d = document.createElement('dialog');
    d.setAttribute('open', '');
    document.body.append(d);
    vi.advanceTimersByTime(3000);
    key('keydown');
    key('keyup');
    expect(clicks).toEqual([]);
    expect(document.querySelector('.scan')).toBeNull();
    s.dispose();
  });
  it('a second switch (Enter) advances', () => {
    const { s, key } = setup();
    s.start();
    key('keydown', 'Enter', 'Enter');
    expect(document.querySelector('.scan')?.id).toBe('d');
    s.dispose();
  });
  it('clamps the rate to 0.6 to 4 seconds', () => {
    const { s } = setup();
    s.setRate(100);
    s.start();
    vi.advanceTimersByTime(599);
    expect(document.querySelector('.scan')?.id).toBe('a');
    vi.advanceTimersByTime(1);
    expect(document.querySelector('.scan')?.id).toBe('d');
    s.dispose();
  });
});
