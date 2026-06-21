/**
 * 搜索检索的纯逻辑层（流程 14 / PRD §16）。
 *
 * 不依赖 UI / 主题，只做「过滤 + 合计」。当前数据源是已加载到内存的流水
 * （Supabase + React Query 全量加载），将来切到本地 WatermelonDB 时，只需替换
 * 调用处传入的 txns 来源（或把这里的条件改写为 SQL where），UI 层无需改动。
 *
 * 合计口径（PRD §16.5 / §16.6）：支出 / 收入 / 净额默认排除储蓄类流水
 * （`source !== 'normal'`），与对账「日常消费」口径一致；储蓄类仍可出现在结果列表中
 * （由调用方标注），但金额不并入合计。
 */
import type { Transaction } from '@/api';

export type TxnType = 'expense' | 'income';

export type DatePresetKey = 'all' | 'thisMonth' | 'lastMonth' | 'last7' | 'last30' | 'thisYear' | 'custom';

export type SearchFilters = {
  keyword: string;
  /** 空集合 = 不限类型 */
  types: Set<TxnType>;
  /** 空集合 = 全部分类（可多选） */
  categoryIds: Set<string>;
  /** 空集合 = 全部成员（按记账人，可多选） */
  recorderIds: Set<string>;
  datePreset: DatePresetKey;
  /** datePreset === 'custom' 时生效 */
  customFrom: Date | null;
  customTo: Date | null;
  /** 金额区间（元，原始输入串；空串 = 不限，任一可空） */
  amountMinYuan: string;
  amountMaxYuan: string;
};

export const EMPTY_FILTERS: SearchFilters = {
  keyword: '',
  types: new Set(),
  categoryIds: new Set(),
  recorderIds: new Set(),
  datePreset: 'all',
  customFrom: null,
  customTo: null,
  amountMinYuan: '',
  amountMaxYuan: '',
};

export type SearchContext = {
  /** category_id → 分类名（关键词命中分类名用） */
  categoryNameById: Map<string, string>;
  /** user_id → 昵称（关键词命中成员名用） */
  recorderNameById: Map<string, string>;
  /** 当前登录用户 id（关键词命中「我」用） */
  myId: string | undefined;
};

export type SearchTotals = {
  count: number;
  expenseCents: number;
  incomeCents: number;
  netCents: number;
};

export type ValidationError = { amount: boolean; date: boolean };

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** 解析金额区间为「分」；空串或非法（非数 / 负数）→ null。 */
export function resolveAmountRange(filters: SearchFilters): { minCents: number | null; maxCents: number | null } {
  const parse = (s: string): number | null => {
    const t = s.trim();
    if (t === '') return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.round(n * 100);
  };
  return { minCents: parse(filters.amountMinYuan), maxCents: parse(filters.amountMaxYuan) };
}

/** 解析日期范围为 [fromMs, toMs)（toMs 为不含的上界）。null 表示该侧不限。 */
export function resolveDateRange(
  filters: SearchFilters,
  now = new Date(),
): { fromMs: number | null; toMs: number | null } {
  switch (filters.datePreset) {
    case 'all':
      return { fromMs: null, toMs: null };
    case 'thisMonth':
      return {
        fromMs: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
        toMs: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(),
      };
    case 'lastMonth':
      return {
        fromMs: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
        toMs: new Date(now.getFullYear(), now.getMonth(), 1).getTime(),
      };
    case 'last7':
      return { fromMs: addDays(startOfDay(now), -6).getTime(), toMs: addDays(startOfDay(now), 1).getTime() };
    case 'last30':
      return { fromMs: addDays(startOfDay(now), -29).getTime(), toMs: addDays(startOfDay(now), 1).getTime() };
    case 'thisYear':
      return {
        fromMs: new Date(now.getFullYear(), 0, 1).getTime(),
        toMs: new Date(now.getFullYear() + 1, 0, 1).getTime(),
      };
    case 'custom':
      return {
        fromMs: filters.customFrom ? startOfDay(filters.customFrom).getTime() : null,
        toMs: filters.customTo ? addDays(startOfDay(filters.customTo), 1).getTime() : null,
      };
  }
}

/** 即时校验：金额 min>max、自定义日期 起>止（PRD §16.7）。 */
export function validateFilters(filters: SearchFilters): ValidationError {
  const { minCents, maxCents } = resolveAmountRange(filters);
  const amount = minCents != null && maxCents != null && minCents > maxCents;
  let date = false;
  if (filters.datePreset === 'custom' && filters.customFrom && filters.customTo) {
    date = startOfDay(filters.customFrom).getTime() > startOfDay(filters.customTo).getTime();
  }
  return { amount, date };
}

/** 是否设置了任一检索条件（决定展示搜索历史还是检索结果）。 */
export function hasAnyQuery(filters: SearchFilters): boolean {
  return (
    filters.keyword.trim() !== '' ||
    filters.types.size > 0 ||
    filters.categoryIds.size > 0 ||
    filters.recorderIds.size > 0 ||
    filters.datePreset !== 'all' ||
    filters.amountMinYuan.trim() !== '' ||
    filters.amountMaxYuan.trim() !== ''
  );
}

function matchesKeyword(t: Transaction, kw: string, ctx: SearchContext): boolean {
  if (kw === '') return true;
  const catName = ctx.categoryNameById.get(t.category_id) ?? '';
  const recName = t.recorder_user_id === ctx.myId ? '我' : (ctx.recorderNameById.get(t.recorder_user_id) ?? '');
  const hay = `${t.note ?? ''} ${catName} ${recName}`.toLowerCase();
  return hay.includes(kw);
}

/**
 * 执行检索：返回命中流水（按记账时间倒序）+ 合计。
 * 维度间为 AND（逐步收窄）。校验不通过（金额 / 日期区间非法）时返回空结果与 valid=false。
 */
export function runSearch(
  txns: Transaction[],
  filters: SearchFilters,
  ctx: SearchContext,
  now = new Date(),
): { matched: Transaction[]; totals: SearchTotals; valid: boolean } {
  const errors = validateFilters(filters);
  if (errors.amount || errors.date) {
    return { matched: [], totals: { count: 0, expenseCents: 0, incomeCents: 0, netCents: 0 }, valid: false };
  }

  const kw = filters.keyword.trim().toLowerCase();
  const { fromMs, toMs } = resolveDateRange(filters, now);
  const { minCents, maxCents } = resolveAmountRange(filters);

  const matched: Transaction[] = [];
  let expenseCents = 0;
  let incomeCents = 0;

  for (const t of txns) {
    const ttype: TxnType = t.type === 'income' ? 'income' : 'expense';
    if (filters.types.size > 0 && !filters.types.has(ttype)) continue;
    if (filters.categoryIds.size > 0 && !filters.categoryIds.has(t.category_id)) continue;
    if (filters.recorderIds.size > 0 && !filters.recorderIds.has(t.recorder_user_id)) continue;

    const ts = new Date(t.occurred_at).getTime();
    if (fromMs != null && ts < fromMs) continue;
    if (toMs != null && ts >= toMs) continue;

    if (minCents != null && t.amount < minCents) continue;
    if (maxCents != null && t.amount > maxCents) continue;

    if (!matchesKeyword(t, kw, ctx)) continue;

    matched.push(t);
    // 合计口径：仅普通流水计入金额；储蓄类（source !== 'normal'）不并入（PRD §16.5/§16.6）。
    if (t.source === 'normal') {
      if (ttype === 'income') incomeCents += t.amount;
      else expenseCents += t.amount;
    }
  }

  matched.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));

  return {
    matched,
    totals: { count: matched.length, expenseCents, incomeCents, netCents: incomeCents - expenseCents },
    valid: true,
  };
}
