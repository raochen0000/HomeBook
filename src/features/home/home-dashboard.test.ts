import { describe, expect, it } from 'vitest';

import { toPulseCardData, type HomeDashboard } from './home-dashboard';

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
