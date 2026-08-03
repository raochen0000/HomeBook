export const HOME_TRANSACTION_PAGE_SIZE = 30;

export type TransactionCursor = {
  occurred_at: string;
  id: string;
};

export type HomeTransactionPage<T extends TransactionCursor> = {
  items: T[];
  nextCursor: TransactionCursor | undefined;
};

export function createHomeTransactionPage<T extends TransactionCursor>(rows: T[]): HomeTransactionPage<T> {
  return {
    items: rows,
    nextCursor: rows.length === HOME_TRANSACTION_PAGE_SIZE ? rows.at(-1) : undefined,
  };
}

/**
 * PostgREST `.or()` 过滤：ISO 时间戳含保留字符 `:`，值必须包在双引号内，
 * 否则游标条件会被错误拆词，导致下一页漏项或请求失败。
 */
export function homeTransactionCursorFilter(cursor: TransactionCursor): string {
  const at = `"${cursor.occurred_at}"`;
  const id = `"${cursor.id}"`;
  return `occurred_at.lt.${at},and(occurred_at.eq.${at},id.lt.${id})`;
}

export function flattenHomeTransactionPages<T extends TransactionCursor>(
  pages: Pick<HomeTransactionPage<T>, 'items'>[],
): T[] {
  return pages.flatMap((page) => page.items);
}
