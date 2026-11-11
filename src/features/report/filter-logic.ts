import type { Category, ReportAnalyticsInput } from '@/api';
import { categoryDescendantIds, type CategoryHierarchy } from '@/lib/category-hierarchy';

export function selectedCategoryCount(
  categories: Category[],
  hierarchy: CategoryHierarchy,
  selected: string[],
): number {
  const selection = new Set(selected);
  return categories.reduce((total, category) => {
    const ids = categoryDescendantIds(category.id, hierarchy);
    const count = ids.filter((id) => selection.has(id)).length;
    return total + (count === ids.length ? 1 : count);
  }, 0);
}

export function filterRequests(
  input: ReportAnalyticsInput,
  options: {
    changed: boolean;
    future: boolean;
    scope: 'expense' | 'income' | 'balance';
    comparisonVisible: boolean;
    comparisonInProgress: boolean;
    currentComparison: ReportAnalyticsInput;
    previousComparison: ReportAnalyticsInput;
  },
): ReportAnalyticsInput[] {
  if (!options.changed || options.future || options.scope === 'balance') return [];
  const requests = [input];
  if (options.scope === 'expense' && options.comparisonVisible && options.comparisonInProgress) {
    const selection = { memberIds: input.memberIds, categoryIds: input.categoryIds };
    requests.push({ ...options.currentComparison, ...selection }, { ...options.previousComparison, ...selection });
  }
  return requests;
}

export async function prepareFilterResults<T>(
  requests: ReportAnalyticsInput[],
  load: (input: ReportAnalyticsInput) => Promise<T>,
  signal: AbortSignal,
): Promise<T[]> {
  const results = await Promise.all(requests.map(load));
  if (signal.aborted) throw new Error('Filter cancelled');
  return results;
}
