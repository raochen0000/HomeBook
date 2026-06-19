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
