/**
 * 预算「已用」口径（PRD §10.6 / §11）：仅统计当期日常支出，排除储蓄类流水
 * （type=expense AND source=normal）。供预算页与首页预警条幅共用。
 */
import { currentPeriod } from './format';

type UsageTxn = { type: string; amount: number; source: string; occurred_at: string; category_id: string };

export function expenseUsedInPeriod(
  txns: UsageTxn[],
  period: string,
): { total: number; byCategory: Map<string, number> } {
  let total = 0;
  const byCategory = new Map<string, number>();
  for (const t of txns) {
    if (t.type !== 'expense' || t.source !== 'normal') continue;
    if (currentPeriod(new Date(t.occurred_at)) !== period) continue;
    total += t.amount;
    byCategory.set(t.category_id, (byCategory.get(t.category_id) ?? 0) + t.amount);
  }
  return { total, byCategory };
}

/** 当月距月底剩余天数（含今天为 0）。 */
export function daysToMonthEnd(date = new Date()): number {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  return lastDay - date.getDate();
}

/** 进度颜色档：<80% 正常，80%~100% 预警，>100% 超支。 */
export function budgetLevel(pct: number): 'normal' | 'warning' | 'danger' {
  if (pct > 100) return 'danger';
  if (pct >= 80) return 'warning';
  return 'normal';
}
