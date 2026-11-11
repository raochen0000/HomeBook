import { describe, expect, it } from 'vitest';

import { isOfflinePeriodUnavailable } from './period-availability';

describe('report period availability', () => {
  it('only blocks offline switches when the required cached results are missing', () => {
    expect(isOfflinePeriodUnavailable(false, undefined, false, undefined)).toBe(true);
    expect(isOfflinePeriodUnavailable(false, {}, false, undefined)).toBe(false);
    expect(isOfflinePeriodUnavailable(false, {}, true, undefined)).toBe(true);
    expect(isOfflinePeriodUnavailable(false, {}, true, {})).toBe(false);
    expect(isOfflinePeriodUnavailable(true, undefined, true, undefined)).toBe(false);
  });
});
