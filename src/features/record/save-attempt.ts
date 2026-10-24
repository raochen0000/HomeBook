/**
 * 记账保存的等待上限。
 *
 * 慢网时按钮不能一直转。满 8 秒仍未返回就结束本次等待并提示重试，表单内容留下。
 * 已经发出的请求不撤回：它稍后仍可能成功。用户再点保存时，可能多记一笔。
 */
export const SAVE_NETWORK_TIMEOUT_MS = 8_000;

export class SaveAttemptTimeoutError extends Error {
  constructor() {
    super('save-attempt-timeout');
    this.name = 'SaveAttemptTimeoutError';
  }
}

export function isSaveAttemptTimeout(error: unknown): boolean {
  return error instanceof SaveAttemptTimeoutError;
}

/** 传输失败用「网络异常」文案，不把 fetch 原文给用户。业务校验错误不走这里。 */
export function isLikelyNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const named = error as { status?: number; message?: string; name?: string } | null;
  const msg = (named?.message ?? message).toLowerCase();
  return (
    named?.status === 0 ||
    named?.name === 'AuthRetryableFetchError' ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('network error') ||
    msg.includes('internet connection appears to be offline')
  );
}

type DeadlineTimer = ReturnType<typeof setTimeout>;

/**
 * 先完成的一边赢。超时后晚到的成功或失败都不再交给调用方，避免超时提示之后又走一遍成功收尾。
 */
export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  schedule: (onTimeout: () => void, delay: number) => DeadlineTimer = (onTimeout, delay) =>
    setTimeout(onTimeout, delay),
  cancel: (timer: DeadlineTimer) => void = (timer) => clearTimeout(timer),
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = schedule(() => {
      if (settled) return;
      settled = true;
      reject(new SaveAttemptTimeoutError());
    }, ms);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        cancel(timer);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        cancel(timer);
        reject(error);
      },
    );
  });
}
