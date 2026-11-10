/**
 * 报表时间维度与趋势分桶（流程 9 完整版）。周（周一起）/ 月 / 年三档。
 * 趋势与分类占比口径排除储蓄类流水（source != normal），与 PRD §11 一致；
 * 收支总额口径包含储蓄类（资金对账），由调用方分别传入。
 */
import { monthLabel } from './format';
import { fromI18nLanguage } from '@/i18n/locale';
import { i18n, t } from '@/i18n/instance';

export type Dimension = 'week' | 'month' | 'year' | 'custom';

export type ReportPeriod = { start: Date; end: Date };
export type ComparablePeriods = { current: ReportPeriod; previous: ReportPeriod; inProgress: boolean };

export function calendarDayDifference(start: Date, end: Date): number {
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endDay - startDay) / 86400000);
}

function addCalendarDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** 当前周期只比较昨天以前的完整自然日；已结束周期分别比较各自完整区间。 */
export function comparablePeriods(
  current: ReportPeriod,
  previous: ReportPeriod,
  today: Date,
): ComparablePeriods | null {
  const currentDays = calendarDayDifference(current.start, current.end);
  const previousDays = calendarDayDifference(previous.start, previous.end);
  const elapsedDays = calendarDayDifference(current.start, today);
  if (currentDays <= 0 || previousDays <= 0 || elapsedDays < 0) return null;
  if (elapsedDays >= currentDays) return { current, previous, inProgress: false };
  const days = Math.min(elapsedDays, currentDays, previousDays);
  if (days <= 0) return null;
  return {
    current: { start: current.start, end: addCalendarDays(current.start, days) },
    previous: { start: previous.start, end: addCalendarDays(previous.start, days) },
    inProgress: true,
  };
}

export type CategoryAmount = { categoryId: string; currentAmount: number };
export type CategoryChange = { categoryId: string; currentAmount: number; previousAmount: number };

/** 合并两段独立聚合，包含只在上期出现的分类，按金额变化大小排序。 */
export function categoryChanges(current: CategoryAmount[], previous: CategoryAmount[]): CategoryChange[] {
  const changes = new Map<string, CategoryChange>();
  for (const item of current) {
    if (item.currentAmount !== 0) {
      changes.set(item.categoryId, {
        categoryId: item.categoryId,
        currentAmount: item.currentAmount,
        previousAmount: 0,
      });
    }
  }
  for (const item of previous) {
    if (item.currentAmount === 0) continue;
    const change = changes.get(item.categoryId) ?? {
      categoryId: item.categoryId,
      currentAmount: 0,
      previousAmount: 0,
    };
    change.previousAmount = item.currentAmount;
    changes.set(item.categoryId, change);
  }
  return [...changes.values()].sort(
    (a, b) =>
      Math.abs(b.currentAmount - b.previousAmount) - Math.abs(a.currentAmount - a.previousAmount) ||
      b.currentAmount - a.currentAmount ||
      a.categoryId.localeCompare(b.categoryId),
  );
}

/** 选中的支出和收入分类分别作用于对应专题。 */
export function categoryIdsForReportType(
  selectedIds: string[],
  categories: { id: string; type: string }[],
  type: 'income' | 'expense',
): string[] {
  const allowed = new Set(categories.filter((category) => category.type === type).map((category) => category.id));
  return selectedIds.filter((id) => allowed.has(id));
}

/** 专题查询尚未完成时不回落到全家数据，避免旧范围冒充筛选结果。 */
export function reportTopicData<T>(
  family: T | undefined,
  filtered: T | undefined,
  filterActive: boolean,
): T | undefined {
  return filterActive ? filtered : family;
}

/** 预算沿用整月统计；当其与已到日期不一致时，不用两种范围混算预测。 */
export function reportBudgetForecast({
  budgetUsed,
  budgetTotal,
  observedExpense,
  elapsedDays,
  totalDays,
  isCurrent,
}: {
  budgetUsed: number | null;
  budgetTotal: number | null;
  observedExpense: number;
  elapsedDays: number | null;
  totalDays: number;
  isCurrent: boolean;
}): { scopeDiffers: boolean; projected: number | null } {
  const scopeDiffers = isCurrent && budgetUsed != null && (budgetTotal ?? 0) > 0 && budgetUsed !== observedExpense;
  const projected =
    isCurrent && budgetUsed != null && elapsedDays != null && elapsedDays > 0 && !scopeDiffers
      ? Math.round((budgetUsed / elapsedDays) * totalDays)
      : null;
  return { scopeDiffers, projected };
}

/** 进行中的最后一期不计入完整周期均值。 */
export function reportTrendAverage(values: number[], inProgress: boolean): { average: number; count: number } {
  const completed = inProgress ? values.slice(0, -1) : values;
  return {
    average: completed.length > 0 ? Math.round(completed.reduce((sum, value) => sum + value, 0) / completed.length) : 0,
    count: completed.length,
  };
}

/** 服务端日期为家庭时区的日历日；本地正午仅用于图表日历分桶。 */
export function reportCalendarDayTimestamp(dateKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [year, month, date] = dateKey.split('-').map(Number);
  const calendarDay = new Date(year, month - 1, date, 12);
  if (calendarDay.getFullYear() !== year || calendarDay.getMonth() !== month - 1 || calendarDay.getDate() !== date)
    return null;
  return calendarDay.toISOString();
}

export function reportDayFlows(
  days: {
    date: string;
    incomeAmount: number;
    expenseAmount: number;
    incomeNormalAmount: number;
    expenseNormalAmount: number;
  }[],
  ordinary: boolean,
): { occurred_at: string; type: 'income' | 'expense'; amount: number }[] {
  return days.flatMap((day) => {
    const occurred_at = reportCalendarDayTimestamp(day.date);
    if (!occurred_at) return [];
    return [
      { occurred_at, type: 'income' as const, amount: ordinary ? day.incomeNormalAmount : day.incomeAmount },
      { occurred_at, type: 'expense' as const, amount: ordinary ? day.expenseNormalAmount : day.expenseAmount },
    ];
  });
}

/** 全家对账总额与目标存取；普通收入由本期每日聚合得到。 */
export function reportAccountingTotals(
  summary: { incomeAmount: number; expenseAmount: number; expenseNormalAmount: number },
  days: { date: string; incomeNormalAmount: number }[],
  start: string,
  end: string,
) {
  const normalIncome = days.reduce(
    (sum, day) => sum + (day.date >= start && day.date < end ? day.incomeNormalAmount : 0),
    0,
  );
  return {
    income: summary.incomeAmount,
    expense: summary.expenseAmount,
    balance: summary.incomeAmount - summary.expenseAmount,
    normalIncome,
    normalExpense: summary.expenseNormalAmount,
    goalWithdrawals: Math.max(0, summary.incomeAmount - normalIncome),
    goalDeposits: Math.max(0, summary.expenseAmount - summary.expenseNormalAmount),
  };
}

/** 用同一份家庭按日汇总计算比较区间，不把实时概览的今天混入环比。 */
export function reportPeriodCashFlow(
  days: { date: string; incomeAmount: number; expenseAmount: number }[],
  start: string,
  end: string,
) {
  const totals = days.reduce(
    (result, day) => {
      if (day.date >= start && day.date < end) {
        result.income += day.incomeAmount;
        result.expense += day.expenseAmount;
        result.hasRecords = true;
      }
      return result;
    },
    { income: 0, expense: 0, hasRecords: false },
  );
  return { ...totals, balance: totals.income - totals.expense };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function shortDateLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 维度 + 锚点 → [start, end) 区间与标题。 */
export function periodRange(dim: Dimension, anchor: Date): { start: Date; end: Date; label: string } {
  if (dim === 'week') {
    const x = startOfDay(anchor);
    const dow = (x.getDay() + 6) % 7; // 周一=0
    const start = new Date(x);
    start.setDate(x.getDate() - dow);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    const last = new Date(end);
    last.setDate(end.getDate() - 1);
    return { start, end, label: `${start.getMonth() + 1}/${start.getDate()}–${last.getMonth() + 1}/${last.getDate()}` };
  }
  if (dim === 'year') {
    return {
      start: new Date(anchor.getFullYear(), 0, 1),
      end: new Date(anchor.getFullYear() + 1, 0, 1),
      label: t('report.yearLabel', { year: anchor.getFullYear() }),
    };
  }
  if (dim === 'custom') {
    const endInclusive = startOfDay(anchor);
    const start = new Date(endInclusive);
    start.setDate(endInclusive.getDate() - 29);
    const end = new Date(endInclusive);
    end.setDate(endInclusive.getDate() + 1);
    return { start, end, label: `${shortDateLabel(start)}–${shortDateLabel(endInclusive)}` };
  }
  // JS Date 构造器会把月份溢出（12）自动进位到下一年 1 月。
  return {
    start: new Date(anchor.getFullYear(), anchor.getMonth(), 1),
    end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1),
    label: monthLabel(anchor),
  };
}

/** 锚点按维度平移。 */
export function shiftAnchor(dim: Dimension, anchor: Date, delta: number): Date {
  const x = new Date(anchor);
  if (dim === 'week') x.setDate(x.getDate() + delta * 7);
  else if (dim === 'custom') x.setDate(x.getDate() + delta * 30);
  else if (dim === 'year') x.setFullYear(x.getFullYear() + delta);
  else {
    // 月维度只关心目标月份；先归一到 1 号，避免 29/30/31 日跨到短月时溢出回原月。
    x.setDate(1);
    x.setMonth(x.getMonth() + delta);
  }
  return x;
}

/** 是否为「当前」周期（用于禁用下一期按钮）。 */
export function isCurrentPeriod(dim: Dimension, anchor: Date): boolean {
  return periodRange(dim, anchor).start.getTime() === periodRange(dim, new Date()).start.getTime();
}

export function inRange(iso: string, start: Date, end: Date): boolean {
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
}

export type Bucket = { label: string; value: number };

/** 趋势分桶（传入「已按区间过滤的日常支出」）：周=7 天，月=按天，年=12 月。 */
export function trendBuckets(
  dim: Dimension,
  range: { start: Date; end?: Date },
  expenses: { occurred_at: string; amount: number }[],
): Bucket[] {
  let buckets: Bucket[];
  let indexer: (d: Date) => number;

  if (dim === 'week') {
    const names = [
      t('dates.weekdayMon'),
      t('dates.weekdayTue'),
      t('dates.weekdayWed'),
      t('dates.weekdayThu'),
      t('dates.weekdayFri'),
      t('dates.weekdaySat'),
      t('dates.weekdaySun'),
    ];
    buckets = names.map((n) => ({ label: n, value: 0 }));
    indexer = (d) => Math.floor((startOfDay(d).getTime() - range.start.getTime()) / 86400000);
  } else if (dim === 'custom') {
    const days = Math.max(
      1,
      Math.ceil(((range.end ?? periodRange('custom', range.start).end).getTime() - range.start.getTime()) / 86400000),
    );
    buckets = Array.from({ length: days }, (_, i) => {
      const d = new Date(range.start);
      d.setDate(range.start.getDate() + i);
      return { label: shortDateLabel(d), value: 0 };
    });
    indexer = (d) => Math.floor((startOfDay(d).getTime() - range.start.getTime()) / 86400000);
  } else if (dim === 'year') {
    buckets = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}`, value: 0 }));
    indexer = (d) => d.getMonth();
  } else {
    const year = range.start.getFullYear();
    const month = range.start.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    buckets = Array.from({ length: days }, (_, i) => ({ label: `${i + 1}`, value: 0 }));
    indexer = (d) => d.getDate() - 1;
  }

  for (const e of expenses) {
    const idx = indexer(new Date(e.occurred_at));
    if (idx >= 0 && idx < buckets.length) buckets[idx].value += e.amount;
  }
  return buckets;
}

/** 维度 + 区间起点 → bucket 索引函数（与 trendBuckets 内部口径一致）。 */
function bucketIndexer(dim: Dimension, rangeStart: Date): (d: Date) => number {
  if (dim === 'week') return (d) => Math.floor((startOfDay(d).getTime() - startOfDay(rangeStart).getTime()) / 86400000);
  if (dim === 'custom')
    return (d) => Math.floor((startOfDay(d).getTime() - startOfDay(rangeStart).getTime()) / 86400000);
  if (dim === 'year') return (d) => d.getMonth();
  return (d) => d.getDate() - 1;
}

export type CumulativeSeries = {
  labels: string[];
  /** 本期累计（进行中周期在「至今」之后为 null，不绘制）。 */
  curr: (number | null)[];
  /** 上期同区间累计（对齐到本期 bucket 数）。 */
  prev: number[];
  /** 截至「至今」的本期累计额。 */
  currToDate: number;
  /** 上期同期（同 bucket 位）累计额。 */
  prevToDate: number;
};

/**
 * 累计同期对比（PRD §11.5.1）：本期至今累计支出 vs 上期同区间累计支出。
 * 两序列对齐到「本期」bucket 数（月维度下上月天数不同则按日序号对齐，越界数据丢弃）；
 * 进行中周期的本期线在「今天」之后置 null（不绘制未来）。传入均为已按各自区间过滤的日常支出。
 */
export function cumulativeSeries(
  dim: Dimension,
  range: { start: Date },
  prevRange: { start: Date },
  isCurrent: boolean,
  curExpenses: { occurred_at: string; amount: number }[],
  prevExpenses: { occurred_at: string; amount: number }[],
): CumulativeSeries {
  const base = trendBuckets(dim, range, curExpenses);
  const len = base.length;
  const labels = base.map((b) => b.label);

  const prevDaily = new Array<number>(len).fill(0);
  const prevIdx = bucketIndexer(dim, prevRange.start);
  for (const e of prevExpenses) {
    const i = prevIdx(new Date(e.occurred_at));
    if (i >= 0 && i < len) prevDaily[i] += e.amount;
  }

  const cutoff = isCurrent ? Math.min(len - 1, Math.max(0, bucketIndexer(dim, range.start)(new Date()))) : len - 1;

  const curr: (number | null)[] = [];
  const prev: number[] = [];
  let ca = 0;
  let pa = 0;
  let currToDate = 0;
  let prevToDate = 0;
  for (let i = 0; i < len; i++) {
    ca += base[i].value;
    pa += prevDaily[i];
    curr.push(i <= cutoff ? ca : null);
    prev.push(pa);
    if (i === cutoff) {
      currToDate = ca;
      prevToDate = pa;
    }
  }
  return { labels, curr, prev, currToDate, prevToDate };
}

/** 结余率 = 结余 ÷ 收入（对账口径）。收入 ≤ 0 时无可比基数，返回 null。可为负（超支）。 */
export function balanceRate(income: number, balance: number): number | null {
  if (income <= 0) return null;
  return balance / income;
}

export type PeriodFlow = { label: string; income: number; expense: number };

/** 收支对比 x 轴短标签：周=起始 M/D，月=M月，年=YYYY。 */
function flowLabel(dim: Dimension, start: Date): string {
  if (dim === 'week' || dim === 'custom') return `${start.getMonth() + 1}/${start.getDate()}`;
  if (dim === 'year') return `${start.getFullYear()}`;
  if (fromI18nLanguage(i18n.language) === 'en') {
    return start.toLocaleDateString('en-US', { month: 'short' });
  }
  return t('dates.monthShort', { month: start.getMonth() + 1 });
}

/**
 * 收支对比（PRD §11.5.1）：近 N 期各期收入 / 支出发生额，末位为锚点所在期。
 * 对账口径：含储蓄类流水（source != normal），与概览 / 结余率一致，调用方传全量流水即可。
 */
export function incomeExpenseSeries(
  dim: Dimension,
  anchor: Date,
  txns: { occurred_at: string; type: string; amount: number }[],
  count = 6,
): PeriodFlow[] {
  // 先归一到周期起点再平移：月维度下从 29/30/31 号直接 setMonth 会溢出串月。
  const base = periodRange(dim, anchor).start;
  const periods = Array.from({ length: count }, (_, i) => {
    const r = periodRange(dim, shiftAnchor(dim, base, i - (count - 1)));
    return { start: r.start.getTime(), end: r.end.getTime(), label: flowLabel(dim, r.start), income: 0, expense: 0 };
  });
  const first = periods[0].start;
  const last = periods[count - 1].end;
  for (const t of txns) {
    const time = new Date(t.occurred_at).getTime();
    if (time < first || time >= last) continue;
    const p = periods.find((x) => time >= x.start && time < x.end);
    if (!p) continue;
    if (t.type === 'income') p.income += t.amount;
    else p.expense += t.amount;
  }
  return periods.map(({ label, income, expense }) => ({ label, income, expense }));
}

/**
 * 自定义周期的近 N 期收支：每期长度与用户选择区间一致，末位为当前自定义区间。
 * 用于自定义报表的“上一等长周期”口径，避免用自然周/月/年误分桶。
 */
export function equalPeriodIncomeExpenseSeries(
  range: { start: Date; end: Date },
  txns: { occurred_at: string; type: string; amount: number }[],
  count = 6,
): PeriodFlow[] {
  const lengthDays = Math.max(1, calendarDayDifference(range.start, range.end));
  const periods = Array.from({ length: count }, (_, i) => {
    const offset = count - 1 - i;
    const start = addCalendarDays(range.start, -offset * lengthDays);
    const end = addCalendarDays(start, lengthDays);
    return { start: start.getTime(), end: end.getTime(), label: flowLabel('custom', start), income: 0, expense: 0 };
  });
  const first = periods[0].start;
  const last = periods[count - 1].end;
  for (const t of txns) {
    const time = new Date(t.occurred_at).getTime();
    if (time < first || time >= last) continue;
    const p = periods.find((x) => time >= x.start && time < x.end);
    if (!p) continue;
    if (t.type === 'income') p.income += t.amount;
    else p.expense += t.amount;
  }
  return periods.map(({ label, income, expense }) => ({ label, income, expense }));
}
