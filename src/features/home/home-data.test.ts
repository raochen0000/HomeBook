import { describe, expect, it } from 'vitest';

import {
  createHomeTransactionPage,
  flattenHomeTransactionPages,
  homeTransactionCursorFilter,
  type TransactionCursor,
} from './home-data';

const cursor = (occurred_at: string, id: string): TransactionCursor => ({ occurred_at, id });

describe('home transaction feed helpers', () => {
  it('uses the final item as the next cursor when a page is full', () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      cursor(`2026-08-03T00:${String(59 - index).padStart(2, '0')}:00.000Z`, `id-${index}`),
    );

    expect(createHomeTransactionPage(rows)).toEqual({
      items: rows,
      nextCursor: rows.at(-1),
    });
  });

  it('does not expose a next cursor when a page is shorter than the page size', () => {
    const rows = [cursor('2026-08-03T00:00:00.000Z', 'id-1')];

    expect(createHomeTransactionPage(rows)).toEqual({ items: rows, nextCursor: undefined });
  });

  it('builds the composite cursor filter for rows sharing an occurred timestamp', () => {
    expect(homeTransactionCursorFilter(cursor('2026-08-03T00:00:00.000Z', 'b'))).toBe(
      'occurred_at.lt."2026-08-03T00:00:00.000Z",and(occurred_at.eq."2026-08-03T00:00:00.000Z",id.lt."b")',
    );
  });

  it('flattens fetched pages without reordering their transactions', () => {
    const first = [cursor('2026-08-03T00:02:00.000Z', 'c'), cursor('2026-08-03T00:00:00.000Z', 'b')];
    const second = [cursor('2026-08-03T00:00:00.000Z', 'a')];

    expect(flattenHomeTransactionPages([{ items: first }, { items: second }])).toEqual([...first, ...second]);
  });
});
