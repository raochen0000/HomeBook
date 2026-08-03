export type HomeDashboard = {
  family_id: string;
  is_owner: boolean;
  budget_total_amount: number | null;
  income_amount: number;
  expense_amount: number;
  balance_amount: number;
  transaction_count: number;
  budget_used_amount: number;
};

export type PulseCardData = {
  hasBudget: boolean;
  totalCents: number;
  usedCents: number;
  balanceCents: number;
  expenseCents: number;
  incomeCents: number;
  isOwner: boolean;
};

export function toPulseCardData(dashboard: HomeDashboard): PulseCardData {
  const totalCents = dashboard.budget_total_amount ?? 0;

  return {
    hasBudget: totalCents > 0,
    totalCents,
    usedCents: dashboard.budget_used_amount,
    balanceCents: dashboard.balance_amount,
    expenseCents: dashboard.expense_amount,
    incomeCents: dashboard.income_amount,
    isOwner: dashboard.is_owner,
  };
}
