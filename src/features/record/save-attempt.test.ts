import { describe, expect, it } from 'vitest';

import {
  SAVE_NETWORK_TIMEOUT_MS,
  SaveAttemptTimeoutError,
  isLikelyNetworkError,
  isSaveAttemptTimeout,
  withDeadline,
} from './save-attempt';

describe('withDeadline', () => {
  it('returns the save result and cancels the deadline when the request finishes first', async () => {
    let cancelled = false;
    const result = withDeadline(
      Promise.resolve('saved'),
      SAVE_NETWORK_TIMEOUT_MS,
      () => 1 as ReturnType<typeof setTimeout>,
      () => {
        cancelled = true;
      },
    );

    await expect(result).resolves.toBe('saved');
    expect(cancelled).toBe(true);
  });

  it('rejects at 8 seconds and ignores a response that arrives later', async () => {
    let fire: (() => void) | undefined;
    let resolveSave: (value: string) => void = () => {};
    const save = new Promise<string>((resolve) => {
      resolveSave = resolve;
    });
    const result = withDeadline(save, SAVE_NETWORK_TIMEOUT_MS, (onTimeout, delay) => {
      expect(delay).toBe(SAVE_NETWORK_TIMEOUT_MS);
      fire = onTimeout;
      return 1 as ReturnType<typeof setTimeout>;
    });
    const settled = result.then(
      () => 'resolved',
      (error: unknown) => error,
    );

    fire?.();
    await expect(settled).resolves.toBeInstanceOf(SaveAttemptTimeoutError);
    resolveSave('late');
    await Promise.resolve();
  });

  it('keeps a fast network failure instead of waiting out the deadline', async () => {
    const failure = new Error('Network request failed');
    let cancelled = false;
    const result = withDeadline(
      Promise.reject(failure),
      SAVE_NETWORK_TIMEOUT_MS,
      () => 1 as ReturnType<typeof setTimeout>,
      () => {
        cancelled = true;
      },
    );

    await expect(result).rejects.toBe(failure);
    expect(cancelled).toBe(true);
  });
});

describe('save error classification', () => {
  it('recognizes the deadline separately from transport failures', () => {
    const timeout = new SaveAttemptTimeoutError();
    expect(isSaveAttemptTimeout(timeout)).toBe(true);
    expect(isLikelyNetworkError(timeout)).toBe(false);
    expect(isLikelyNetworkError(new Error('Network request failed'))).toBe(true);
    expect(isLikelyNetworkError(new Error('new row violates row-level security'))).toBe(false);
  });
});
