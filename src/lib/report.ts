/**
 * 报表时间维度与趋势分桶（流程 9 完整版）。周（周一起）/ 月 / 年三档。
 * 趋势与分类占比口径排除储蓄类流水（source != normal），与 PRD §11 一致；
 * 收支总额口径包含储蓄类（资金对账），由调用方分别传入。
 */
import { monthLabel } from './format';

export type Dimension = 'week' | 'month' | 'year';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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
      label: `${anchor.getFullYear()}年`,
    };
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
  else if (dim === 'year') x.setFullYear(x.getFullYear() + delta);
  else x.setMonth(x.getMonth() + delta);
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
  range: { start: Date },
  expenses: { occurred_at: string; amount: number }[],
): Bucket[] {
  let buckets: Bucket[];
  let indexer: (d: Date) => number;

  if (dim === 'week') {
    const names = ['一', '二', '三', '四', '五', '六', '日'];
    buckets = names.map((n) => ({ label: n, value: 0 }));
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
  if (dim === 'week') return `${start.getMonth() + 1}/${start.getDate()}`;
  if (dim === 'year') return `${start.getFullYear()}`;
  return `${start.getMonth() + 1}月`;
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
