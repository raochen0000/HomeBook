import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAmountSliderSession } from './amount-slider-session';

afterEach(() => vi.useRealTimers());

describe('amount slider gesture', () => {
  it('keeps repeated movements local, even during a long pause, and commits only the final range on release', () => {
    vi.useFakeTimers();
    const commit = vi.fn();
    const session = createAmountSliderSession({ min: '', max: '', limit: 1000 }, commit);

    expect(session.update('100', '')).toEqual({ min: '100', max: '', limit: 1000 });
    vi.advanceTimersByTime(1000);
    session.update('200', '');
    vi.advanceTimersByTime(1000);
    expect(commit).not.toHaveBeenCalled();

    session.finish(false);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ min: '200', max: '', limit: 1000 });
    session.finish(false);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not commit when interrupted or when the amount did not change', () => {
    const commit = vi.fn();
    const interrupted = createAmountSliderSession({ min: '', max: '500', limit: 1000 }, commit);
    interrupted.update('100', '500');
    interrupted.finish(true);

    const unchanged = createAmountSliderSession({ min: '', max: '500', limit: 1000 }, commit);
    unchanged.finish(false);
    expect(commit).not.toHaveBeenCalled();
  });
});
