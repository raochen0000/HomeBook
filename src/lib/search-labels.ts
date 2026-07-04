import type { DatePresetKey } from './search';

export const DATE_PRESET_LABELS: Record<DatePresetKey, string> = {
  all: '日期',
  thisMonth: '本月',
  lastMonth: '上月',
  last7: '近 7 天',
  last30: '近 30 天',
  thisYear: '今年',
  custom: '自定义日期',
};

export function summarizeSelectedLabels(labels: string[], limit = 2): string {
  if (labels.length === 0) return '';
  const visible = labels.slice(0, limit).join(' ');
  const rest = labels.length - limit;
  return rest > 0 ? `${visible} +${rest}` : visible;
}

function trimNumberText(value: string): string {
  const n = Number(value.trim());
  if (!Number.isFinite(n)) return value.trim();
  if (n >= 10000 && n % 10000 === 0) return `${n / 10000}万`;
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function compactAmountFilterLabel(minYuan: string, maxYuan: string): string {
  const min = minYuan.trim();
  const max = maxYuan.trim();
  if (!min && !max) return '金额';
  if (min && max) return `¥${trimNumberText(min)}–${trimNumberText(max)}`;
  if (min) return `¥${trimNumberText(min)}+`;
  return `≤¥${trimNumberText(max)}`;
}

function shortDate(d: Date, showYear: boolean): string {
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return showYear ? `${d.getFullYear()}/${mm}/${dd}` : `${mm}/${dd}`;
}

export function customDateFilterLabel(from: Date | null, to: Date | null, now = new Date()): string {
  if (!from && !to) return DATE_PRESET_LABELS.custom;
  const showYear =
    (from?.getFullYear() ?? now.getFullYear()) !== now.getFullYear() ||
    (to?.getFullYear() ?? now.getFullYear()) !== now.getFullYear() ||
    (!!from && !!to && from.getFullYear() !== to.getFullYear());
  if (from && to) return `${shortDate(from, showYear)}–${shortDate(to, showYear)}`;
  if (from) return `${shortDate(from, showYear)} 起`;
  return `${shortDate(to as Date, showYear)} 前`;
}
