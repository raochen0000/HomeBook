import { describe, expect, it } from 'vitest';

import type { Category, CategoryLayout, ReportAnalyticsInput } from '@/api';
import { buildCategoryHierarchy } from '@/lib/category-hierarchy';
import { filterRequests, prepareFilterResults, selectedCategoryCount } from './filter-logic';

const category = (id: string): Category => ({
  id,
  name: id,
  status: 'active',
  type: 'expense',
  family_id: null,
  is_system: true,
  icon: null,
  color_key: null,
  created_at: '',
  updated_at: '',
});
const layout = (id: string, parent: string | null): CategoryLayout => ({
  family_id: 'family',
  category_id: id,
  parent_category_id: parent,
  is_group: parent === null,
  legacy_entry: false,
  created_at: '',
});
const input: ReportAnalyticsInput = {
  start: '2026-11-01',
  end: '2026-11-11',
  previousStart: '2026-10-01',
  historyStart: '2026-06-01',
  memberIds: ['member'],
  categoryIds: ['food'],
};
const options = {
  changed: true,
  future: false,
  scope: 'expense' as const,
  comparisonVisible: true,
  comparisonInProgress: true,
  currentComparison: { ...input, start: '2026-11-01' },
  previousComparison: { ...input, start: '2026-10-01' },
};

describe('report filter', () => {
  it('counts a fully selected parent once and partially selected children individually', () => {
    const categories = ['food', 'breakfast', 'lunch', 'travel'].map(category);
    const tree = buildCategoryHierarchy(categories, [
      layout('food', null),
      layout('breakfast', 'food'),
      layout('lunch', 'food'),
    ]);
    const roots = [categories[0], categories[3]];
    expect(selectedCategoryCount(roots, tree, ['food', 'breakfast', 'lunch'])).toBe(1);
    expect(selectedCategoryCount(roots, tree, ['breakfast', 'lunch', 'travel'])).toBe(3);
  });
  it('prepares both matching comparison intervals only when needed', () => {
    const requests = filterRequests(input, options);
    expect(requests).toHaveLength(3);
    expect(requests.slice(1).every((item) => item.memberIds[0] === 'member' && item.categoryIds[0] === 'food')).toBe(
      true,
    );
    expect(filterRequests(input, { ...options, scope: 'balance' })).toEqual([]);
    expect(filterRequests(input, { ...options, changed: false })).toEqual([]);
    expect(filterRequests(input, { ...options, scope: 'income' })).toHaveLength(1);
  });
  it('rejects a late result after cancellation', async () => {
    const controller = new AbortController();
    let resolve!: (value: string) => void;
    const load = () =>
      new Promise<string>((done) => {
        resolve = done;
      });
    const result = prepareFilterResults([input], load, controller.signal);
    controller.abort();
    resolve('late');
    await expect(result).rejects.toThrow('Filter cancelled');
  });
  it('does not return partial data if a required request fails', async () => {
    const controller = new AbortController();
    const requests = filterRequests(input, options);
    await expect(
      prepareFilterResults(
        requests,
        async (request) => {
          if (request.start === '2026-10-01') throw new Error('offline');
          return 'ok';
        },
        controller.signal,
      ),
    ).rejects.toThrow('offline');
  });
});
