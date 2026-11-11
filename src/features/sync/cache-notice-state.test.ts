import { describe, expect, it } from 'vitest';

import { hasSettledRefreshFailure } from './cache-notice-state';

describe('cached data refresh warnings', () => {
  it('clears old errors during retry and after success, but keeps a real failure', () => {
    expect(hasSettledRefreshFailure([{ isEnabled: true, isError: true, isFetching: false, errorUpdatedAt: 10 }])).toBe(
      true,
    );
    expect(hasSettledRefreshFailure([{ isEnabled: true, isError: true, isFetching: true, errorUpdatedAt: 10 }])).toBe(
      false,
    );
    expect(hasSettledRefreshFailure([{ isEnabled: true, isError: false, isFetching: false, errorUpdatedAt: 10 }])).toBe(
      false,
    );
    expect(hasSettledRefreshFailure([{ isEnabled: false, isError: true, isFetching: false, errorUpdatedAt: 10 }])).toBe(
      false,
    );
    expect(
      hasSettledRefreshFailure([{ isEnabled: true, isError: true, isFetching: false, errorUpdatedAt: 10 }], 20),
    ).toBe(false);
    expect(
      hasSettledRefreshFailure([{ isEnabled: true, isError: true, isFetching: false, errorUpdatedAt: 21 }], 20),
    ).toBe(true);
  });
});
