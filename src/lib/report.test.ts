import { afterEach, describe, expect, it } from 'vitest';

import { setAppLocale } from '../i18n/instance';
import {
  categoryChanges,
  categoryIdsForReportType,
  comparablePeriods,
  equalPeriodIncomeExpenseSeries,
  balanceRate,
  incomeExpenseSeries,
  periodRange,
  reportAccountingTotals,
  reportBudgetForecast,
  reportCalendarDayTimestamp,
  reportDayFlows,
  reportPeriodCashFlow,
  reportTopicData,
  reportTrendAverage,
  shiftAnchor,
} from './report';

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

describe('shiftAnchor', () => {
  it.each([
    [new Date(2026, 9, 31), -1, new Date(2026, 8, 1)],
    [new Date(2026, 4, 31), -1, new Date(2026, 3, 1)],
    [new Date(2026, 2, 31), -1, new Date(2026, 1, 1)],
    [new Date(2028, 2, 31), -1, new Date(2028, 1, 1)],
    [new Date(2026, 1, 28), 1, new Date(2026, 2, 1)],
  ])('keeps monthly navigation in the target month for %s', (anchor, delta, expectedStart) => {
    const shifted = shiftAnchor('month', anchor, delta);

    expect(periodRange('month', shifted).start).toEqual(expectedStart);
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

describe('comparablePeriods', () => {
  it('compares completed days while leaving today out of an ongoing month', () => {
    const result = comparablePeriods(
      periodRange('month', new Date(2026, 10, 8)),
      periodRange('month', new Date(2026, 9, 8)),
      new Date(2026, 10, 8, 12),
    );
    expect(result).toEqual({
      current: { start: new Date(2026, 10, 1), end: new Date(2026, 10, 8) },
      previous: { start: new Date(2026, 9, 1), end: new Date(2026, 9, 8) },
      inProgress: true,
    });
  });

  it.each([
    [2026, 28],
    [2028, 29],
  ])('limits a March comparison to the previous February in %i', (year, days) => {
    const result = comparablePeriods(
      periodRange('month', new Date(year, 2, 31)),
      periodRange('month', new Date(year, 1, 1)),
      new Date(year, 2, 31, 12),
    );
    expect(result?.current.end).toEqual(new Date(year, 2, days + 1));
    expect(result?.previous.end).toEqual(new Date(year, 2, 1));
  });

  it('limits a May comparison to April’s 30 days', () => {
    const result = comparablePeriods(
      periodRange('month', new Date(2026, 4, 31)),
      periodRange('month', new Date(2026, 3, 1)),
      new Date(2026, 4, 31, 12),
    );
    expect(result?.current.end).toEqual(new Date(2026, 4, 31));
    expect(result?.previous.end).toEqual(new Date(2026, 4, 1));
  });

  it('uses both full periods after completion, even when their lengths differ', () => {
    const current = periodRange('month', new Date(2026, 2, 15));
    const previous = periodRange('month', new Date(2026, 1, 15));
    expect(comparablePeriods(current, previous, new Date(2026, 3, 1))).toEqual({
      current,
      previous,
      inProgress: false,
    });
  });

  it('handles a custom range across a year boundary and has no comparison on its first day', () => {
    const current = { start: new Date(2026, 11, 30), end: new Date(2027, 0, 5) };
    const previous = { start: new Date(2026, 11, 24), end: new Date(2026, 11, 30) };
    expect(comparablePeriods(current, previous, new Date(2026, 11, 30))).toBeNull();
    expect(comparablePeriods(current, previous, new Date(2026, 11, 29))).toBeNull();
    expect(comparablePeriods(current, previous, new Date(2027, 0, 2))).toEqual({
      current: { start: current.start, end: new Date(2027, 0, 2) },
      previous: { start: previous.start, end: new Date(2026, 11, 27) },
      inProgress: true,
    });
  });

  it('counts calendar days across a daylight-saving transition', () => {
    const current = { start: new Date(2026, 2, 7), end: new Date(2026, 2, 12) };
    const previous = { start: new Date(2026, 2, 2), end: new Date(2026, 2, 7) };
    expect(comparablePeriods(current, previous, new Date(2026, 2, 11, 12))).toEqual({
      current: { start: current.start, end: new Date(2026, 2, 11) },
      previous: { start: previous.start, end: new Date(2026, 2, 6) },
      inProgress: true,
    });
    expect(
      equalPeriodIncomeExpenseSeries(
        current,
        [
          { occurred_at: iso(2026, 3, 6), type: 'expense', amount: 1 },
          { occurred_at: iso(2026, 3, 7), type: 'expense', amount: 2 },
          { occurred_at: iso(2026, 3, 11), type: 'expense', amount: 3 },
        ],
        2,
      ).map((period) => period.expense),
    ).toEqual([1, 5]);
  });
});

describe('report analysis scope', () => {
  it('keeps family totals and budget stable while a recorder and expense category are selected', () => {
    const family = { incomeAmount: 1000000, expenseAmount: 680000, expenseNormalAmount: 480000 };
    const matchingTopic = { expenseNormalAmount: 120000 };
    const totals = reportAccountingTotals(
      family,
      [{ date: '2026-11-08', incomeNormalAmount: 1000000 }],
      '2026-11-01',
      '2026-12-01',
    );
    expect(totals.balance).toBe(320000);
    expect(balanceRate(totals.income, totals.balance)).toBe(0.32);
    expect(reportTopicData({ expenseNormalAmount: totals.normalExpense }, matchingTopic, true)).toEqual(matchingTopic);
    expect(reportTopicData({ expenseNormalAmount: totals.normalExpense }, undefined, true)).toBeUndefined();
    expect(reportTopicData({ expenseNormalAmount: totals.normalExpense }, matchingTopic, false)).toEqual({
      expenseNormalAmount: 480000,
    });
    expect(500000 - totals.normalExpense).toBe(20000);
    expect(balanceRate(0, -200000)).toBeNull();
  });

  it('pauses the budget forecast if whole-month usage and observed spending differ', () => {
    const input = {
      budgetUsed: 480000,
      budgetTotal: 500000,
      observedExpense: 480000,
      elapsedDays: 8,
      totalDays: 30,
      isCurrent: true,
    };
    expect(reportBudgetForecast(input)).toEqual({ scopeDiffers: false, projected: 1800000 });
    expect(reportBudgetForecast({ ...input, budgetUsed: 550000 })).toEqual({ scopeDiffers: true, projected: null });
    expect(reportBudgetForecast({ ...input, budgetUsed: null })).toEqual({ scopeDiffers: false, projected: null });
  });

  it('does not mix an in-progress period into the average of completed periods', () => {
    expect(reportTrendAverage([300, 500, 100], true)).toEqual({ average: 400, count: 2 });
    expect(reportTrendAverage([300, 500, 100], false)).toEqual({ average: 300, count: 3 });
    expect(reportTrendAverage([100], true)).toEqual({ average: 0, count: 0 });
  });

  it('keeps expense and income categories independent', () => {
    const categories = [
      { id: 'food', type: 'expense' },
      { id: 'wages', type: 'income' },
    ];
    expect(categoryIdsForReportType(['food'], categories, 'income')).toEqual([]);
    expect(categoryIdsForReportType(['food', 'wages'], categories, 'expense')).toEqual(['food']);
    expect(categoryIdsForReportType(['food', 'wages'], categories, 'income')).toEqual(['wages']);
  });

  it('sorts by absolute change and retains a category with only previous-period spending', () => {
    expect(
      categoryChanges(
        [
          { categoryId: 'large-stable', currentAmount: 1000 },
          { categoryId: 'new', currentAmount: 200 },
        ],
        [
          { categoryId: 'large-stable', currentAmount: 950 },
          { categoryId: 'gone', currentAmount: 500 },
        ],
      ),
    ).toEqual([
      { categoryId: 'gone', currentAmount: 0, previousAmount: 500 },
      { categoryId: 'new', currentAmount: 200, previousAmount: 0 },
      { categoryId: 'large-stable', currentAmount: 1000, previousAmount: 950 },
    ]);
  });

  it('separates ordinary income and consumption from goal transfers in daily trends', () => {
    const days = [
      {
        date: '2026-11-08',
        incomeAmount: 12000,
        expenseAmount: 6800,
        incomeNormalAmount: 10000,
        expenseNormalAmount: 4800,
      },
    ];
    expect(reportDayFlows(days, true).map((flow) => flow.amount)).toEqual([10000, 4800]);
    expect(reportDayFlows(days, false).map((flow) => flow.amount)).toEqual([12000, 6800]);
    expect(reportDayFlows([{ ...days[0], date: '2026-02-30' }], true)).toEqual([]);
    const localDay = reportCalendarDayTimestamp('2026-11-08');
    expect(localDay).not.toBeNull();
    expect(new Date(localDay ?? '').getDate()).toBe(8);
  });

  it('reconciles the whole-family cash balance while keeping goal transfers out of spending', () => {
    const totals = reportAccountingTotals(
      { incomeAmount: 1200000, expenseAmount: 680000, expenseNormalAmount: 480000 },
      [
        { date: '2026-10-31', incomeNormalAmount: 999999 },
        { date: '2026-11-08', incomeNormalAmount: 1000000 },
      ],
      '2026-11-01',
      '2026-12-01',
    );
    expect(totals).toEqual({
      income: 1200000,
      expense: 680000,
      balance: 520000,
      normalIncome: 1000000,
      normalExpense: 480000,
      goalWithdrawals: 200000,
      goalDeposits: 200000,
    });
  });

  it('compares family cash flow through the end of yesterday, including goal transfers', () => {
    const days = [
      { date: '2026-10-07', incomeAmount: 5000, expenseAmount: 3000 },
      { date: '2026-10-08', incomeAmount: 9000, expenseAmount: 9000 },
      { date: '2026-11-07', incomeAmount: 7000, expenseAmount: 5000 },
      { date: '2026-11-08', incomeAmount: 10000, expenseAmount: 10000 },
    ];
    expect(reportPeriodCashFlow(days, '2026-10-01', '2026-10-08')).toEqual({
      income: 5000,
      expense: 3000,
      balance: 2000,
      hasRecords: true,
    });
    expect(reportPeriodCashFlow(days, '2026-11-01', '2026-11-08')).toEqual({
      income: 7000,
      expense: 5000,
      balance: 2000,
      hasRecords: true,
    });
    expect(reportPeriodCashFlow(days, '2026-09-01', '2026-09-08').hasRecords).toBe(false);
  });
});
