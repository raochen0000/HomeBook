/**
 * 报表数据卡片注册表（PRD §18 自定义能力）——报表卡片显隐 / 排序的单一真源。
 *
 * 用户偏好只存两个数组（accounting_preferences.report_card_order / report_card_hidden）；
 * 真正的「有哪些卡、默认序、哪张锁定」由本表定义。resolveCardLayout 把用户偏好与本表合并：
 *   - 用户排序里的已知卡按其序在前；本表新增（用户没存过）的卡按注册序补在末尾、默认可见；
 *   - 锁定卡（locked，如「收支概览」）永不隐藏；
 * 这样将来加卡不必迁移旧数据，老用户自动在末尾看到新卡。
 */

export type ReportCardId =
  | 'overview'
  | 'balance_rate'
  | 'trend'
  | 'cumulative'
  | 'expense_category'
  | 'category_mom'
  | 'member'
  | 'top_expenses'
  | 'income_structure';

export type ReportCardMeta = {
  id: ReportCardId;
  title: string;
  /** SF Symbol 名（管理页图标）。 */
  icon: string;
  /** 锁定卡：强制常驻、不可隐藏、不可拖动（仅「收支概览」）。 */
  locked?: boolean;
};

/** 默认顺序 = 报表页现渲染序。 */
export const REPORT_CARDS: ReportCardMeta[] = [
  { id: 'overview', title: '收支概览', icon: 'square.split.2x2.fill', locked: true },
  { id: 'balance_rate', title: '结余率', icon: 'gauge.medium' },
  { id: 'trend', title: '消费趋势', icon: 'chart.xyaxis.line' },
  { id: 'cumulative', title: '累计同期对比', icon: 'chart.line.uptrend.xyaxis' },
  { id: 'expense_category', title: '支出分类占比', icon: 'chart.pie.fill' },
  { id: 'category_mom', title: '分类环比', icon: 'arrow.up.arrow.down' },
  { id: 'member', title: '成员贡献', icon: 'person.2.fill' },
  { id: 'top_expenses', title: '大额支出 Top 5', icon: 'flame.fill' },
  { id: 'income_structure', title: '收入结构', icon: 'arrow.down.circle.fill' },
];

/** 全局至少展示的卡片数（含锁定卡）。 */
export const MIN_VISIBLE_CARDS = 3;

/** 卡片总数（记账设置页展示「已展示 N/总数」用）。 */
export const TOTAL_CARDS = REPORT_CARDS.length;

const CARD_BY_ID = new Map(REPORT_CARDS.map((c) => [c.id, c]));
const LOCKED_IDS = new Set(REPORT_CARDS.filter((c) => c.locked).map((c) => c.id));

export function reportCardMeta(id: ReportCardId): ReportCardMeta {
  return CARD_BY_ID.get(id)!;
}

export function isKnownCard(id: string): id is ReportCardId {
  return CARD_BY_ID.has(id as ReportCardId);
}

/**
 * 合并用户偏好与注册表，得到最终的「可见序」与「隐藏序」。
 * @param order  用户排序（卡 id 序，可含未知 / 缺失，容错）
 * @param hidden 用户隐藏集合
 */
export function resolveCardLayout(
  order: string[],
  hidden: string[],
): { visible: ReportCardId[]; hidden: ReportCardId[] } {
  // 1) 规整排序：先取用户序里的已知卡（去重），再把注册表中用户没排过的卡按注册序补末尾。
  const ordered: ReportCardId[] = [];
  const seen = new Set<ReportCardId>();
  for (const raw of order) {
    if (isKnownCard(raw) && !seen.has(raw)) {
      ordered.push(raw);
      seen.add(raw);
    }
  }
  for (const c of REPORT_CARDS) {
    if (!seen.has(c.id)) {
      ordered.push(c.id);
      seen.add(c.id);
    }
  }

  // 2) 显隐：锁定卡永不隐藏。
  const hiddenSet = new Set(hidden);
  const visible: ReportCardId[] = [];
  const hiddenOut: ReportCardId[] = [];
  for (const id of ordered) {
    if (hiddenSet.has(id) && !LOCKED_IDS.has(id)) hiddenOut.push(id);
    else visible.push(id);
  }
  return { visible, hidden: hiddenOut };
}

export function isLockedCard(id: string): boolean {
  return LOCKED_IDS.has(id as ReportCardId);
}
