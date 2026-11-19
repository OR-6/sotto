// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { load, save, STORE_KEYS } from '../src/ui/store';

beforeEach(() => localStorage.clear());

describe('store', () => {
  it('keeps only allow-listed keys, never a transcript or receipt key', () => {
    expect(STORE_KEYS).not.toContain('turns' as never);
    expect(STORE_KEYS).not.toContain('receipt' as never);
    expect(() => save('turns' as never, [])).toThrow(/not an allowed storage key/);
  });
  it('drops kept briefs and summaries older than 30 days', () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const fresh = new Date().toISOString().slice(0, 10);
    save('summaries', [{ date: fresh, summary: 'keep' }, { date: old, summary: 'gone' }]);
    expect(load<{ summary: string }[]>('summaries', []).map((s) => s.summary)).toEqual(['keep']);
  });
});
