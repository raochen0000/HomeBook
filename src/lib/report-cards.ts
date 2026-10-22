/**
 * 报表数据卡片注册表（PRD §18 自定义能力）——报表卡片显隐 / 排序的单一真源。
 *
 * 支出、收入、结余各有一份顺序和显隐。偏好仍落在
 * accounting_preferences.report_card_order / report_card_hidden，元素为 `页:卡片id`
 * （如 `expense:budget`）。某一页没有任何该前缀项时用默认序；无前缀旧值忽略，不迁移。
 * 锁定卡（收支概览）在每一页置顶且不可隐藏。将来给某一页加卡时，已存过该页顺序的用户
 * 会在该页末尾看到新卡，默认可见。
 */

import { t } from '@/i18n/instance';

export type ReportCardId =
  | 'overview'
  | 'budget'
  | 'insights'
  | 'income_target'
  | 'income_expense'
  | 'expense_trend'
  | 'income_trend'
  | 'expense_category'
  | 'category_mom'
  | 'member'
  | 'top_expenses'
  | 'income_structure'
  | 'balance_waterfall'
  | 'savings_rate'
  | 'savings_goals'
  | 'more_stats';

export type ReportScope = 'expense' | 'income' | 'balance';

export const CARD_SCOPES: ReportScope[] = ['expense', 'income', 'balance'];

export type ReportCardMeta = {
  id: ReportCardId;
  /** SF Symbol 名（管理页图标）。 */
  icon: string;
  /** 锁定卡：每一页强制置顶、不可隐藏、不可拖动（仅「收支概览」）。 */
  locked?: boolean;
};

/** 卡片元数据。各页有哪些卡、默认顺序见 `DEFAULT_SCOPE_CARD_ORDER`。 */
export const REPORT_CARDS: ReportCardMeta[] = [
  { id: 'overview', icon: 'square.split.2x2.fill', locked: true },
  { id: 'budget', icon: 'target' },
  { id: 'insights', icon: 'sparkles' },
  { id: 'income_target', icon: 'flag.checkered' },
  { id: 'income_expense', icon: 'chart.bar.xaxis' },
  { id: 'expense_trend', icon: 'chart.line.uptrend.xyaxis' },
  { id: 'income_trend', icon: 'chart.bar.fill' },
  { id: 'expense_category', icon: 'chart.pie.fill' },
  { id: 'category_mom', icon: 'arrow.up.arrow.down' },
  { id: 'member', icon: 'person.2.fill' },
  { id: 'top_expenses', icon: 'flame.fill' },
  { id: 'income_structure', icon: 'arrow.down.circle.fill' },
  { id: 'balance_waterfall', icon: 'chart.bar.xaxis.descending' },
  { id: 'savings_rate', icon: 'percent' },
  { id: 'savings_goals', icon: 'scope' },
  { id: 'more_stats', icon: 'chart.xyaxis.line' },
];

/**
 * 各报表页的默认顺序，也是该页允许出现的卡片集合。
 * 存钱目标只属于结余页。
 */
export const DEFAULT_SCOPE_CARD_ORDER: Record<ReportScope, ReportCardId[]> = {
  expense: [
    'overview',
    'budget',
    'expense_trend',
    'expense_category',
    'category_mom',
    'member',
    'more_stats',
    'top_expenses',
    'insights',
  ],
  income: ['overview', 'income_trend', 'income_structure', 'income_target', 'more_stats', 'insights'],
  balance: [
    'overview',
    'income_expense',
    'balance_waterfall',
    'savings_rate',
    'savings_goals',
    'more_stats',
    'insights',
  ],
};

export type ScopeCardLayout = {
  /** 该页完整顺序，含隐藏卡；锁定卡在最前。 */
  order: ReportCardId[];
  hidden: ReportCardId[];
  visible: ReportCardId[];
};

const CARD_BY_ID = new Map(REPORT_CARDS.map((c) => [c.id, c]));
const LOCKED_IDS = new Set(REPORT_CARDS.filter((c) => c.locked).map((c) => c.id));
const SCOPE_CARD_SET: Record<ReportScope, Set<ReportCardId>> = {
  expense: new Set(DEFAULT_SCOPE_CARD_ORDER.expense),
  income: new Set(DEFAULT_SCOPE_CARD_ORDER.income),
  balance: new Set(DEFAULT_SCOPE_CARD_ORDER.balance),
};

const CARD_TITLE_KEY: Record<ReportCardId, string> = {
  overview: 'report.overview',
  budget: 'report.monthBudget',
  insights: 'report.insights',
  income_target: 'report.incomeTarget',
  income_expense: 'report.incomeExpense',
  expense_trend: 'report.expenseTrend',
  income_trend: 'report.incomeTrend',
  expense_category: 'report.expenseCategory',
  category_mom: 'report.categoryMom',
  member: 'report.member',
  top_expenses: 'report.topExpenses',
  income_structure: 'report.incomeStructure',
  balance_waterfall: 'report.balanceWaterfall',
  savings_rate: 'report.savingsRate',
  savings_goals: 'report.savingsGoals',
  more_stats: 'report.moreStats',
};

export function reportCardTitle(id: ReportCardId): string {
  return t(CARD_TITLE_KEY[id]);
}

export function reportCardMeta(id: ReportCardId): ReportCardMeta {
  return CARD_BY_ID.get(id)!;
}

export function isKnownCard(id: string): id is ReportCardId {
  return CARD_BY_ID.has(id as ReportCardId);
}

export function isLockedCard(id: string): boolean {
  return LOCKED_IDS.has(id as ReportCardId);
}

export function scopeCardKey(scope: ReportScope, id: ReportCardId): string {
  return `${scope}:${id}`;
}

/** 用顺序和隐藏集生成一份规范化布局：隐藏卡按顺序排列，锁定卡不会被隐藏。 */
export function buildScopeCardLayout(order: readonly ReportCardId[], hidden: readonly ReportCardId[]): ScopeCardLayout {
  const hiddenSet = new Set(hidden.filter((id) => !isLockedCard(id)));
  return {
    order: [...order],
    hidden: order.filter((id) => hiddenSet.has(id)),
    visible: order.filter((id) => !hiddenSet.has(id)),
  };
}

/**
 * 解析某一页的卡片布局。
 * @param order  用户排序（`页:卡片id`，可含其他页、未知项或无前缀旧值）
 * @param hidden 用户隐藏集合（格式同 order）
 */
export function resolveScopeCardLayout(
  scope: ReportScope,
  order: readonly string[],
  hidden: readonly string[],
): ScopeCardLayout {
  const allowed = SCOPE_CARD_SET[scope];
  const prefix = `${scope}:`;
  const seen = new Set<ReportCardId>();
  const stored: ReportCardId[] = [];
  let hasScopeOrder = false;

  for (const raw of order) {
    if (!raw.startsWith(prefix)) continue;
    hasScopeOrder = true;
    const id = raw.slice(prefix.length);
    if (!isKnownCard(id) || !allowed.has(id) || seen.has(id)) continue;
    stored.push(id);
    seen.add(id);
  }

  const base = hasScopeOrder ? stored : [...DEFAULT_SCOPE_CARD_ORDER[scope]];
  if (hasScopeOrder) {
    for (const id of DEFAULT_SCOPE_CARD_ORDER[scope]) {
      if (!seen.has(id)) base.push(id);
    }
  }

  const normalized = [...base.filter(isLockedCard), ...base.filter((id) => !isLockedCard(id))];
  const hiddenIds: ReportCardId[] = [];
  for (const raw of hidden) {
    if (!raw.startsWith(prefix)) continue;
    const id = raw.slice(prefix.length);
    if (!isKnownCard(id) || !allowed.has(id) || isLockedCard(id)) continue;
    hiddenIds.push(id);
  }
  return buildScopeCardLayout(normalized, hiddenIds);
}

export function resolveAllScopeCardLayouts(
  order: readonly string[],
  hidden: readonly string[],
): Record<ReportScope, ScopeCardLayout> {
  return {
    expense: resolveScopeCardLayout('expense', order, hidden),
    income: resolveScopeCardLayout('income', order, hidden),
    balance: resolveScopeCardLayout('balance', order, hidden),
  };
}

/** 把三页布局写回两个 text[]。隐藏项按该页顺序写出，锁定卡不进入隐藏集。 */
export function encodeScopeCardLayouts(layouts: Record<ReportScope, Pick<ScopeCardLayout, 'order' | 'hidden'>>): {
  report_card_order: string[];
  report_card_hidden: string[];
} {
  const report_card_order: string[] = [];
  const report_card_hidden: string[] = [];
  for (const scope of CARD_SCOPES) {
    const allowed = SCOPE_CARD_SET[scope];
    const hiddenSet = new Set(layouts[scope].hidden);
    for (const id of layouts[scope].order) {
      if (!allowed.has(id)) continue;
      report_card_order.push(scopeCardKey(scope, id));
      if (hiddenSet.has(id) && !isLockedCard(id)) report_card_hidden.push(scopeCardKey(scope, id));
    }
  }
  return { report_card_order, report_card_hidden };
}
