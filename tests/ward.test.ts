// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

describe('ward mode (?ward)', () => {
  it('reads and writes nothing in storage', async () => {
    window.history.replaceState(null, '', '/?ward');
    vi.resetModules();
    const store = await import('../src/ui/store');
    expect(store.WARD).toBe(true);
    expect(store.save('settings', { a: 1 })).toBe(false);
    localStorage.setItem('sotto.v1.phrases', JSON.stringify(['old patient phrase']));
    expect(store.load('phrases', ['default'])).toEqual(['default']);
    window.history.replaceState(null, '', '/');
  });
});
