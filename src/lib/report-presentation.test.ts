import { describe, expect, it } from 'vitest';

import type { ReportCardId } from './report-cards';
import { compactReportCards, reportComparisonChange, reportComparisonRangeLabel } from './report-presentation';

describe('reportComparisonRangeLabel', () => {
  const today = new Date(2026, 10, 9);

  it('keeps the exact comparable window visible, including a single completed day', () => {
    expect(reportComparisonRangeLabel(new Date(2026, 10, 1), new Date(2026, 10, 8), today, 'en-US')).toBe('11/1–11/8');
    expect(reportComparisonRangeLabel(new Date(2026, 10, 1), new Date(2026, 10, 1), today, 'en-US')).toBe('11/1');
  });

  it('retains years in historical and cross-year windows', () => {
    expect(reportComparisonRangeLabel(new Date(2025, 10, 1), new Date(2025, 10, 8), today, 'en-US')).toBe(
      '11/1/2025–11/8/2025',
    );
    expect(reportComparisonRangeLabel(new Date(2025, 11, 25), new Date(2026, 0, 2), today, 'en-US')).toBe(
      '12/25/2025–1/2/2026',
    );
  });
});

describe('reportComparisonChange', () => {
  it('uses percentages for ordinary income and expense with a positive previous base', () => {
    expect(reportComparisonChange('expense', 150, 100, true, true)).toEqual({ kind: 'percent', value: 50 });
    expect(reportComparisonChange('income', 0, 100, true, true)).toEqual({ kind: 'percent', value: -100 });
  });

  it('distinguishes absent records from a recorded zero rather than celebrating an empty window', () => {
    expect(reportComparisonChange('expense', 0, 100, false, true)).toEqual({ kind: 'no-current' });
    expect(reportComparisonChange('income', 100, 0, true, false)).toEqual({ kind: 'no-previous' });
    expect(reportComparisonChange('expense', 0, 0, false, false)).toEqual({ kind: 'no-records' });
  });

  it('shows an amount delta for a zero base and for balances crossing zero', () => {
    expect(reportComparisonChange('income', 100, 0, true, true)).toEqual({ kind: 'amount', value: 100 });
    expect(reportComparisonChange('balance', 100, -200, true, true)).toEqual({ kind: 'amount', value: 300 });
    expect(reportComparisonChange('balance', -100, 200, true, true)).toEqual({ kind: 'amount', value: -300 });
  });
});

describe('compactReportCards', () => {
  const empty = new Set<ReportCardId>(['expense_category', 'category_mom', 'member', 'top_expenses']);

  it('consolidates adjacent empty cards without moving history, populated cards or family cards', () => {
    expect(
      compactReportCards(['overview', 'expense_trend', 'expense_category', 'category_mom', 'budget', 'member'], empty),
    ).toEqual([
      { kind: 'card', id: 'overview' },
      { kind: 'card', id: 'expense_trend' },
      { kind: 'empty', ids: ['expense_category', 'category_mom'] },
      { kind: 'card', id: 'budget' },
      { kind: 'empty', ids: ['member'] },
    ]);
  });

  it('does not restore hidden cards or require the trend card to be visible', () => {
    expect(compactReportCards(['overview', 'member'], empty)).toEqual([
      { kind: 'card', id: 'overview' },
      { kind: 'empty', ids: ['member'] },
    ]);
  });

  it('preserves the supplied custom order and never mutates stored preferences', () => {
    const order: ReportCardId[] = ['overview', 'top_expenses', 'expense_category', 'expense_trend'];
    const original = [...order];
    expect(compactReportCards(order, empty)).toEqual([
      { kind: 'card', id: 'overview' },
      { kind: 'empty', ids: ['top_expenses', 'expense_category'] },
      { kind: 'card', id: 'expense_trend' },
    ]);
    expect(order).toEqual(original);
    expect(compactReportCards(order, new Set())).toEqual(order.map((id) => ({ kind: 'card', id })));
  });
});
