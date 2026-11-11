import { afterEach, describe, expect, it, vi } from 'vitest';

import { createOfflineRecovery } from './offline-recovery';

afterEach(() => vi.useRealTimers());

describe('offline connection recovery', () => {
  it('detects service recovery without a native network event', async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onRecovered = vi.fn();
    const recovery = createOfflineRecovery({ check, onRecovered, isForeground: () => true });
    recovery.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);
    expect(onRecovered).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(check).toHaveBeenCalledTimes(2);
    expect(onRecovered).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(2);
    recovery.stop();
  });

  it('does not start checks in the background or accept a result after cancellation', async () => {
    vi.useFakeTimers();
    let foreground = false;
    let finish: ((value: boolean) => void) | undefined;
    const check = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const onRecovered = vi.fn();
    const recovery = createOfflineRecovery({ check, onRecovered, isForeground: () => foreground });
    recovery.start();
    expect(check).not.toHaveBeenCalled();
    foreground = true;
    recovery.start();
    expect(check).toHaveBeenCalledTimes(1);
    recovery.stop();
    finish?.(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it('times out a stalled request and avoids overlapping checks', async () => {
    vi.useFakeTimers();
    const check = vi.fn(() => new Promise<boolean>(() => {}));
    const recovery = createOfflineRecovery({ check, onRecovered: vi.fn(), isForeground: () => true });
    recovery.start();
    recovery.retryNow();
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(check).toHaveBeenCalledTimes(2);
    recovery.stop();
  });

  it('lets repeated manual retries share the active check and its result', async () => {
    let finish: ((value: boolean) => void) | undefined;
    const check = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const onRecovered = vi.fn();
    const recovery = createOfflineRecovery({ check, onRecovered, isForeground: () => true });
    const first = recovery.retryNow();
    const second = recovery.retryNow();
    expect(second).toBe(first);
    expect(check).toHaveBeenCalledOnce();
    finish?.(true);
    await expect(first).resolves.toBe(true);
    expect(onRecovered).toHaveBeenCalledOnce();
    recovery.stop();
  });

  it('reports an unsuccessful manual retry when the service is unreachable', async () => {
    vi.useFakeTimers();
    const recovery = createOfflineRecovery({
      check: vi.fn().mockResolvedValue(false),
      onRecovered: vi.fn(),
      isForeground: () => true,
    });
    await expect(recovery.retryNow()).resolves.toBe(false);
    recovery.stop();
  });

  it('backs off after real requests fail even if the service probe previously succeeded', async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValue(true);
    const recovery = createOfflineRecovery({ check, onRecovered: vi.fn(), isForeground: () => true });
    recovery.startDelayed();
    recovery.start();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledOnce();
    recovery.stop();
  });
});
