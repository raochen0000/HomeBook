import { describe, expect, it } from 'vitest';

import { resolveHomeOverview, toPulseCardData, type HomeDashboard } from './home-dashboard';

const dashboard: HomeDashboard = {
  family_id: 'family-1',
  is_owner: true,
  budget_total_amount: 100_000,
  income_amount: 250_000,
  expense_amount: 90_000,
  balance_amount: 160_000,
  transaction_count: 12,
  budget_used_amount: 80_000,
};

describe('home dashboard mapping', () => {
  it('maps the server aggregate to the PulseCard contract', () => {
    expect(toPulseCardData(dashboard)).toEqual({
      hasBudget: true,
      totalCents: 100_000,
      usedCents: 80_000,
      balanceCents: 160_000,
      expenseCents: 90_000,
      incomeCents: 250_000,
      isOwner: true,
    });
  });

  it('uses the cash-flow Hero state when the family has no positive budget', () => {
    expect(toPulseCardData({ ...dashboard, budget_total_amount: null })).toMatchObject({
      hasBudget: false,
      totalCents: 0,
    });
  });
});

describe('home overview view', () => {
  const pending = { isPending: true, isError: false, data: undefined };
  const failed = { isPending: false, isError: true, data: null };
  const noFamily = { isPending: false, isError: false, data: null };

  it('keeps the skeleton only while the dashboard has not settled', () => {
    expect(resolveHomeOverview(pending)).toEqual({ status: 'loading' });
    expect(resolveHomeOverview(failed)).toEqual({ status: 'error' });
  });

  it('treats a settled dashboard with no family as a zero cash-flow card', () => {
    expect(resolveHomeOverview(noFamily)).toEqual({
      status: 'empty',
      pulse: {
        hasBudget: false,
        totalCents: 0,
        usedCents: 0,
        balanceCents: 0,
        expenseCents: 0,
        incomeCents: 0,
        isOwner: false,
      },
    });
  });

  it('treats a month with no entries and no budget as a zero cash-flow card', () => {
    expect(
      resolveHomeOverview({
        isPending: false,
        isError: false,
        data: {
          ...dashboard,
          transaction_count: 0,
          budget_total_amount: null,
          income_amount: 0,
          expense_amount: 0,
          balance_amount: 0,
          budget_used_amount: 0,
        },
      }),
    ).toEqual({
      status: 'empty',
      pulse: {
        hasBudget: false,
        totalCents: 0,
        usedCents: 0,
        balanceCents: 0,
        expenseCents: 0,
        incomeCents: 0,
        isOwner: true,
      },
    });
  });

  it('shows the zero-progress pulse when a budget exists but the month has no entries', () => {
    expect(
      resolveHomeOverview({
        isPending: false,
        isError: false,
        data: {
          ...dashboard,
          transaction_count: 0,
          budget_used_amount: 0,
          income_amount: 0,
          expense_amount: 0,
          balance_amount: 0,
        },
      }).status,
    ).toBe('ready');
  });
});
