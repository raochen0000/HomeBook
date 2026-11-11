type OfflineRecoveryOptions = {
  check: (signal: AbortSignal) => Promise<boolean>;
  onRecovered: () => void;
  isForeground: () => boolean;
};

/** A single bounded check at a time, only while offline and in the foreground. */
export function createOfflineRecovery({ check, onRecovered, isForeground }: OfflineRecoveryOptions) {
  const delays = [5_000, 10_000, 20_000, 30_000];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let pending: Promise<boolean> | undefined;
  let generation = 0;
  let failures = 0;

  const stop = () => {
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
    pending = undefined;
    failures = 0;
  };

  const run = (): Promise<boolean> => {
    timer = undefined;
    if (pending) return pending;
    if (!isForeground()) return Promise.resolve(false);
    const current = generation;
    const abort = new AbortController();
    controller = abort;
    const task = (async () => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let reachable = false;
      try {
        reachable = await Promise.race([
          check(abort.signal),
          new Promise<boolean>((resolve) => {
            timeout = setTimeout(() => {
              abort.abort();
              resolve(false);
            }, 5_000);
          }),
        ]);
      } catch {
        // A failed probe means we should keep showing cached data.
      } finally {
        clearTimeout(timeout);
        if (controller === abort) controller = undefined;
      }
      if (generation !== current || !isForeground()) return false;
      if (reachable) {
        failures = 0;
        onRecovered();
        return true;
      }
      const delay = delays[Math.min(failures, delays.length - 1)];
      failures += 1;
      timer = setTimeout(() => void run(), delay);
      return false;
    })();
    pending = task;
    const clearPending = () => {
      if (pending === task) pending = undefined;
    };
    void task.then(clearPending, clearPending);
    return task;
  };

  const start = () => {
    if (pending) return pending;
    if (timer || !isForeground()) return Promise.resolve(false);
    return run();
  };
  const retryNow = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    return start();
  };
  const startDelayed = () => {
    if (timer || controller || !isForeground()) return;
    timer = setTimeout(() => void run(), 15_000);
  };
  return { start, stop, retryNow, startDelayed };
}
