import { i18n, t } from '@/i18n/instance';
import { fromI18nLanguage } from '@/i18n/locale';

import type { DatePresetKey } from './search';

export function datePresetLabel(key: DatePresetKey): string {
  switch (key) {
    case 'all':
      return t('dates.date');
    case 'thisMonth':
      return t('dates.thisMonth');
    case 'lastMonth':
      return t('dates.lastMonth');
    case 'last7':
      return t('dates.last7');
    case 'last30':
      return t('dates.last30');
    case 'thisYear':
      return t('dates.thisYear');
    case 'custom':
      return t('dates.customDate');
  }
}

/** @deprecated 测试与旧调用可读当前语言标签 */
export const DATE_PRESET_LABELS: Record<DatePresetKey, string> = {
  get all() {
    return datePresetLabel('all');
  },
  get thisMonth() {
    return datePresetLabel('thisMonth');
  },
  get lastMonth() {
    return datePresetLabel('lastMonth');
  },
  get last7() {
    return datePresetLabel('last7');
  },
  get last30() {
    return datePresetLabel('last30');
  },
  get thisYear() {
    return datePresetLabel('thisYear');
  },
  get custom() {
    return datePresetLabel('custom');
  },
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
  if (n >= 10000 && n % 10000 === 0) {
    return fromI18nLanguage(i18n.language) === 'zh' ? `${n / 10000}万` : `${n / 1000}k`;
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function compactAmountFilterLabel(minYuan: string, maxYuan: string): string {
  const min = minYuan.trim();
  const max = maxYuan.trim();
  if (!min && !max) return t('search.amount');
  if (min && max) return `¥${trimNumberText(min)}–${trimNumberText(max)}`;
  if (min) return `¥${trimNumberText(min)}+`;
  return `≤¥${trimNumberText(max)}`;
}

export function isAmountFilterUnrestricted(minYuan: string, maxYuan: string): boolean {
  return minYuan.trim() === '' && maxYuan.trim() === '';
}

function shortDate(d: Date, showYear: boolean): string {
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  return showYear ? `${d.getFullYear()}/${mm}/${dd}` : `${mm}/${dd}`;
}

export function customDateFilterLabel(from: Date | null, to: Date | null, now = new Date()): string {
  if (!from && !to) return datePresetLabel('custom');
  const showYear =
    (from?.getFullYear() ?? now.getFullYear()) !== now.getFullYear() ||
    (to?.getFullYear() ?? now.getFullYear()) !== now.getFullYear() ||
    (!!from && !!to && from.getFullYear() !== to.getFullYear());
  if (from && to) return `${shortDate(from, showYear)}–${shortDate(to, showYear)}`;
  if (from) return t('dates.fromDate', { date: shortDate(from, showYear) });
  return t('dates.untilDate', { date: shortDate(to as Date, showYear) });
}
