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

const EMPTY_PULSE: PulseCardData = {
  hasBudget: false,
  totalCents: 0,
  usedCents: 0,
  balanceCents: 0,
  expenseCents: 0,
  incomeCents: 0,
  isOwner: false,
};

export type HomeOverviewView =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'empty'; pulse: PulseCardData }
  | { status: 'ready'; pulse: PulseCardData };

/**
 * 首页概览卡的展示态。
 * 无家庭，或本月无记账且未设预算：仍用现金流脉搏卡，金额为 0，由调用方隐藏「设置预算」。
 * 已设预算但本月还没记账时展示 0% 进度。请求未结束前不能把空数据画成「加载中」。
 */
export function resolveHomeOverview(input: {
  isPending: boolean;
  isError: boolean;
  data: HomeDashboard | null | undefined;
}): HomeOverviewView {
  if (input.data) {
    const pulse = toPulseCardData(input.data);
    if (input.data.transaction_count === 0 && !pulse.hasBudget) return { status: 'empty', pulse };
    return { status: 'ready', pulse };
  }
  if (input.isError) return { status: 'error' };
  if (input.isPending) return { status: 'loading' };
  return { status: 'empty', pulse: EMPTY_PULSE };
}
