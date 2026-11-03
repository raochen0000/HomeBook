import AsyncStorage from '@react-native-async-storage/async-storage';

export type CategoryUsageEvent = { categoryId: string; type: 'expense' | 'income'; savedAt: number };

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const pending = new Map<string, Promise<unknown>>();

export function recentCategoryUsage(value: unknown, now: number): CategoryUsageEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CategoryUsageEvent => {
    if (typeof item !== 'object' || item === null) return false;
    const event: Partial<Record<keyof CategoryUsageEvent, unknown>> = item;
    return (
      typeof event.categoryId === 'string' &&
      event.categoryId.length > 0 &&
      (event.type === 'expense' || event.type === 'income') &&
      typeof event.savedAt === 'number' &&
      Number.isFinite(event.savedAt) &&
      event.savedAt > now - WINDOW_MS &&
      event.savedAt <= now
    );
  });
}

export function sortCategoriesByUsage<T extends { id: string }>(
  categories: T[],
  events: CategoryUsageEvent[],
  type: CategoryUsageEvent['type'],
): T[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    if (event.type === type) counts.set(event.categoryId, (counts.get(event.categoryId) ?? 0) + 1);
  }
  return categories
    .map((category, index) => ({ category, index, count: counts.get(category.id) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .map(({ category }) => category);
}

function storageKey(familyId: string, userId: string): string {
  return `homebook:category-usage:v1:${familyId}:${userId}`;
}

/** Serialize local reads and writes so consecutive saves cannot overwrite each other. */
function enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = pending.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  pending.set(key, current);
  void current
    .finally(() => {
      if (pending.get(key) === current) pending.delete(key);
    })
    .catch(() => {});
  return current;
}

async function readEvents(key: string, now: number): Promise<CategoryUsageEvent[]> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return [];
  try {
    return recentCategoryUsage(JSON.parse(raw), now);
  } catch {
    return [];
  }
}

export function loadCategoryUsage(familyId: string, userId: string): Promise<CategoryUsageEvent[]> {
  const key = storageKey(familyId, userId);
  return enqueue(key, async () => {
    const events = await readEvents(key, Date.now());
    await AsyncStorage.setItem(key, JSON.stringify(events));
    return events;
  });
}

export function recordCategoryUsage(
  familyId: string,
  userId: string,
  categoryId: string,
  type: CategoryUsageEvent['type'],
): Promise<CategoryUsageEvent[]> {
  const key = storageKey(familyId, userId);
  const savedAt = Date.now();
  return enqueue(key, async () => {
    const events = await readEvents(key, savedAt);
    events.push({ categoryId, type, savedAt });
    await AsyncStorage.setItem(key, JSON.stringify(events));
    return events;
  });
}
