import { afterEach, describe, expect, it } from 'vitest';

import { setAppLocale } from '../i18n/instance';
import { equalPeriodIncomeExpenseSeries, incomeExpenseSeries } from './report';

afterEach(() => {
  setAppLocale('zh');
});

const iso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

describe('incomeExpenseSeries', () => {
  it('uses month labels across year boundaries and buckets income/expense', () => {
    const s = incomeExpenseSeries('month', new Date(2026, 2, 15), [
      { occurred_at: iso(2025, 10, 5), type: 'income', amount: 100 },
      { occurred_at: iso(2025, 9, 30), type: 'income', amount: 999 },
      { occurred_at: iso(2026, 1, 1), type: 'expense', amount: 30 },
      { occurred_at: iso(2026, 3, 31), type: 'expense', amount: 50 },
      { occurred_at: iso(2026, 3, 1), type: 'income', amount: 80 },
      { occurred_at: iso(2026, 4, 1), type: 'expense', amount: 999 },
    ]);
    expect(s.map((x) => x.label)).toEqual(['10月', '11月', '12月', '1月', '2月', '3月']);
    expect(s[0]).toEqual({ label: '10月', income: 100, expense: 0 });
    expect(s[3]).toEqual({ label: '1月', income: 0, expense: 30 });
    expect(s[5]).toEqual({ label: '3月', income: 80, expense: 50 });
  });

  it('does not overflow months when the anchor is the 31st', () => {
    const s = incomeExpenseSeries('month', new Date(2026, 4, 31), []);
    expect(s.map((x) => x.label)).toEqual(['12月', '1月', '2月', '3月', '4月', '5月']);
  });

  it('uses Monday-start week labels', () => {
    const s = incomeExpenseSeries(
      'week',
      new Date(2026, 6, 9),
      [
        { occurred_at: iso(2026, 7, 6), type: 'expense', amount: 10 },
        { occurred_at: iso(2026, 7, 5), type: 'expense', amount: 20 },
      ],
      2,
    );
    expect(s.map((x) => x.label)).toEqual(['6/29', '7/6']);
    expect(s.map((x) => x.expense)).toEqual([20, 10]);
  });

  it('buckets by year', () => {
    const s = incomeExpenseSeries(
      'year',
      new Date(2026, 0, 1),
      [{ occurred_at: iso(2024, 6, 1), type: 'income', amount: 7 }],
      3,
    );
    expect(s.map((x) => x.label)).toEqual(['2024', '2025', '2026']);
    expect(s[0].income).toBe(7);
  });
});

describe('equalPeriodIncomeExpenseSeries', () => {
  it('generates equal-length custom periods', () => {
    const s = equalPeriodIncomeExpenseSeries(
      { start: new Date(2026, 6, 11), end: new Date(2026, 6, 16) },
      [
        { occurred_at: iso(2026, 7, 6), type: 'expense', amount: 10 },
        { occurred_at: iso(2026, 7, 11), type: 'income', amount: 20 },
        { occurred_at: iso(2026, 7, 16), type: 'income', amount: 999 },
      ],
      2,
    );
    expect(s.map((x) => x.label)).toEqual(['7/6', '7/11']);
    expect(s.map((x) => ({ income: x.income, expense: x.expense }))).toEqual([
      { income: 0, expense: 10 },
      { income: 20, expense: 0 },
    ]);
  });
});
