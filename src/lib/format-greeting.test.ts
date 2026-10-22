import { describe, expect, it } from 'vitest';

import { msUntilNextGreeting, nextGreetingBoundary } from './format';

describe('greeting boundary', () => {
  it('moves from morning to noon at 12:00', () => {
    const morning = new Date(2026, 9, 22, 11, 30, 0);
    expect(nextGreetingBoundary(morning)).toEqual(new Date(2026, 9, 22, 12, 0, 0));
  });

  it('moves from noon to afternoon at 14:00', () => {
    const noon = new Date(2026, 9, 22, 13, 0, 0);
    expect(nextGreetingBoundary(noon)).toEqual(new Date(2026, 9, 22, 14, 0, 0));
  });

  it('uses the following boundary when the clock is exactly on one', () => {
    const noonSharp = new Date(2026, 9, 22, 12, 0, 0);
    expect(nextGreetingBoundary(noonSharp)).toEqual(new Date(2026, 9, 22, 14, 0, 0));
  });

  it('rolls evening over to the next midnight', () => {
    const evening = new Date(2026, 9, 22, 20, 15, 0);
    expect(nextGreetingBoundary(evening)).toEqual(new Date(2026, 9, 23, 0, 0, 0));
    expect(msUntilNextGreeting(evening)).toBe(3 * 60 * 60 * 1000 + 45 * 60 * 1000);
  });
});
