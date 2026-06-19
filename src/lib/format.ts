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

/** YYYY-MM（按本地时区），用于本月范围判断。 */
export function currentPeriod(date = new Date()): string {
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
}

/** 取某时间戳的「年-月-日」key，用于按日分组。 */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 人性化日期头：今天 / 昨天 / M月D日。 */
export function humanDay(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  if (sameDay(d, today)) return `今天 · ${md}`;
  if (sameDay(d, yesterday)) return `昨天 · ${md}`;
  return md;
}
