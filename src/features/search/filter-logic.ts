import type { CategoryHierarchy } from '@/lib/category-hierarchy';
import type { DatePresetKey, TxnType } from '@/lib/search';

export const AMOUNT_SLIDER_STEP = 10;
export const SEARCH_DATE_PRESETS: DatePresetKey[] = ['thisYear', 'thisMonth', 'lastMonth', 'last7', 'last30'];

export function isValidAmountInput(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  return /^\d+(?:\.\d{0,2})?$/.test(text) && Number(text) <= Number.MAX_SAFE_INTEGER / 100;
}

/** Keep only categories that can match the newly selected transaction type. */
export function categoriesForType(
  categoryIds: ReadonlySet<string>,
  type: TxnType | null,
  hierarchy: CategoryHierarchy,
): Set<string> {
  if (!type) return new Set(categoryIds);
  return new Set([...categoryIds].filter((id) => hierarchy.byId.get(id)?.type === type));
}

/** Empty bounds represent an unrestricted end of the amount range. */
export function moveAmountBound(
  bound: 'min' | 'max',
  fraction: number,
  limit: number,
  min: string,
  max: string,
): { min: string; max: string } {
  const value = Math.min(
    limit,
    Math.round((Math.max(0, Math.min(1, fraction)) * limit) / AMOUNT_SLIDER_STEP) * AMOUNT_SLIDER_STEP,
  );
  const lower = min.trim() && isValidAmountInput(min) ? Math.min(Number(min) || 0, limit) : 0;
  const upper = max.trim() && isValidAmountInput(max) ? Math.min(Number(max) || 0, limit) : limit;
  if (bound === 'min') {
    const next = Math.min(value, Math.floor(upper / AMOUNT_SLIDER_STEP) * AMOUNT_SLIDER_STEP);
    return { min: next === 0 ? '' : String(next), max };
  }
  const next = Math.max(value, Math.ceil(lower / AMOUNT_SLIDER_STEP) * AMOUNT_SLIDER_STEP);
  return { min, max: next >= limit ? '' : String(next) };
}
