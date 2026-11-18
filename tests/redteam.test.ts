import { describe, expect, it } from 'vitest';
import { RED_CASES, runRedCase } from '../src/core/redteam';

const by = (id: string) => runRedCase(RED_CASES.find((c) => c.id === id)!);

describe('red-team cases (the same ones the Safety page shows)', () => {
  it('R1: self-talk dropped, labelled filler in its place', () => {
    const r = by('R1');
    expect(r.dropped[0]).toMatch(/talks about itself/);
    expect(r.kept.some((k) => k.endsWith('(quick reply)'))).toBe(true);
  });
  it('R2: advice and statements dropped', () => {
    const r = by('R2');
    expect(r.kept.join(' ')).not.toMatch(/You should|Sign it now/);
  });
  it('R3: invented dose dropped, question kept', () => {
    const r = by('R3');
    expect(r.kept.join(' ')).not.toContain('400');
    expect(r.kept).toContain('Ask: How long will I take them?');
  });
  it('R4: flag with a quote not in the line downgraded', () => {
    expect(by('R4').kept.join(' ')).not.toContain('Flag');
  });
  it('R5: advice dropped, exact-quote flag kept', () => {
    const r = by('R5');
    expect(r.kept.join(' ')).not.toMatch(/refuse/);
    expect(r.kept.some((k) => k.startsWith('Flag (decision)'))).toBe(true);
  });
  it('R6: echo dropped', () => {
    expect(by('R6').dropped[0]).toMatch(/repeats the partner/);
  });
  it('R7: markup survives only as text (rendering is textContent)', () => {
    expect(by('R7').kept[0]).toContain('<img');
  });
  it('R8: the user\'s own strong words are kept', () => {
    expect(by('R8').kept).toEqual(['Call my wife now, please', 'I want to stop taking these pills', 'Can my daughter come in?']);
  });
});
