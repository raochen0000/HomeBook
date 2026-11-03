import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadCategoryUsage, recentCategoryUsage, recordCategoryUsage, sortCategoriesByUsage } from './category-usage';

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

const day = 24 * 60 * 60 * 1000;
const now = 1_800_000_000_000;

beforeEach(() => {
  storage.clear();
  vi.useRealTimers();
});

describe('local category usage', () => {
  it('keeps only valid events inside the rolling seven-day window', () => {
    const events = recentCategoryUsage(
      [
        { categoryId: 'a', type: 'expense', savedAt: now - 7 * day },
        { categoryId: 'b', type: 'income', savedAt: now - 7 * day + 1 },
        { categoryId: 'c', type: 'expense', savedAt: now + 1 },
        { categoryId: 'd', type: 'other', savedAt: now },
        null,
      ],
      now,
    );
    expect(events).toEqual([{ categoryId: 'b', type: 'income', savedAt: now - 7 * day + 1 }]);
  });

  it('sorts each type by count and keeps the existing order for ties and unused categories', () => {
    const categories = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const events = [
      { categoryId: 'c', type: 'expense' as const, savedAt: now },
      { categoryId: 'c', type: 'expense' as const, savedAt: now },
      { categoryId: 'b', type: 'expense' as const, savedAt: now },
      { categoryId: 'a', type: 'expense' as const, savedAt: now },
      { categoryId: 'd', type: 'income' as const, savedAt: now },
    ];
    expect(sortCategoriesByUsage(categories, events, 'expense').map((item) => item.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(sortCategoriesByUsage(categories, events, 'income').map((item) => item.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(categories.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('isolates households and users and does not lose consecutive writes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await Promise.all([
      recordCategoryUsage('family-a', 'user-a', 'a', 'expense'),
      recordCategoryUsage('family-a', 'user-a', 'b', 'income'),
      recordCategoryUsage('family-b', 'user-a', 'c', 'expense'),
      recordCategoryUsage('family-a', 'user-b', 'd', 'expense'),
    ]);
    expect(await loadCategoryUsage('family-a', 'user-a')).toEqual([
      { categoryId: 'a', type: 'expense', savedAt: now },
      { categoryId: 'b', type: 'income', savedAt: now },
    ]);
    expect(await loadCategoryUsage('family-b', 'user-a')).toHaveLength(1);
    expect(await loadCategoryUsage('family-a', 'user-b')).toHaveLength(1);
    vi.setSystemTime(now + 7 * day);
    expect(await loadCategoryUsage('family-a', 'user-a')).toEqual([]);
  });

  it('recovers from malformed stored data', async () => {
    storage.set('homebook:category-usage:v1:family:user', '{broken');
    expect(await loadCategoryUsage('family', 'user')).toEqual([]);
  });
});
