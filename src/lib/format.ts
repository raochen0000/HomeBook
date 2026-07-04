/**
 * 金额格式化（DESIGN §8）。金额以「分」存储；展示拆为整数 / 小数两段，
 * 整数主字号、小数降一档；千分位分隔；符号 +（收入）/ −（支出）。
 */

export type AmountParts = {
  /** 符号：'+' | '-' | ''（中性/结余） */
  sign: '+' | '-' | '';
  /** 货币符号 */
  currency: string;
  /** 整数部分（含千分位），如 "9,110" */
  integer: string;
  /** 两位小数，如 "00" */
  decimal: string;
};

/** 分 → 展示分段。signed 控制是否带 +/− 号（默认按正负）。 */
export function amountParts(cents: number, sign: '+' | '-' | '' = ''): AmountParts {
  const abs = Math.abs(cents);
  const yuan = Math.floor(abs / 100);
  const frac = abs % 100;
  return {
    sign,
    currency: '¥',
    integer: yuan.toLocaleString('en-US'),
    decimal: frac.toString().padStart(2, '0'),
  };
}

/** 按流水类型取符号：收入 +，支出 −。 */
export function signForType(type: 'income' | 'expense'): '+' | '-' {
  return type === 'income' ? '+' : '-';
}

/** 当日小计 / 结余等「净额」符号：正 +、负 −、零 空。 */
export function signForNet(cents: number): '+' | '-' | '' {
  if (cents > 0) return '+';
  if (cents < 0) return '-';
  return '';
}

/** 拼成完整字符串（用于无障碍标签等）。 */
export function formatAmount(cents: number, sign: '+' | '-' | '' = ''): string {
  const p = amountParts(cents, sign);
  return `${p.sign}${p.currency}${p.integer}.${p.decimal}`;
}

/** 金额隐私遮罩（PRD §18.3.1）：hidden 时把金额文案替换为 ****，防窥屏。 */
export function maskAmount(text: string, hidden: boolean): string {
  return hidden ? '****' : text;
}

/** YYYY-MM（按本地时区），用于本月范围判断。 */
export function currentPeriod(date = new Date()): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
}

/** 上一周期（YYYY-MM）。如 '2026-06' → '2026-05'。 */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() - 1);
  return currentPeriod(d);
}

/** 环比：当前 vs 上期。上期为 0（无可比基数）时返回 null（UI 显示「—」）。 */
export function percentDelta(curr: number, prev: number): { pct: number; up: boolean } | null {
  if (prev <= 0) return null;
  return { pct: Math.round(((curr - prev) / prev) * 1000) / 10, up: curr >= prev };
}

/** 带符号的百分比文案，如 +8.3% / -12.5% / 0%。 */
export function formatPercent(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

/** 按小时取问候语（顶栏副标题前半句）。 */
export function greetingForHour(date = new Date()): string {
  const h = date.getHours();
  if (h < 6) return '夜深了';
  if (h < 12) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/** 人性化月份标题：今年省略年份（如「6月」），往年带年（如「2025年6月」）。 */
export function monthLabel(date: Date): string {
  const now = new Date();
  const m = `${date.getMonth() + 1}月`;
  return date.getFullYear() === now.getFullYear() ? m : `${date.getFullYear()}年${m}`;
}

/** 取某时间戳的「年-月-日」key，用于按日分组。 */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 人性化日期头：今天 / 昨天 / 更早则用具体日期（M月D日）。 */
export function humanDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return '今天';
  if (sameDay(d, yesterday)) return '昨天';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 24 小时制时刻（HH:mm），用于流水行的记录/修改时间。 */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
