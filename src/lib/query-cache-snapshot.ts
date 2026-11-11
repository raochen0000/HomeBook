import type { QueryClient, QueryKey } from '@tanstack/react-query';

/** A bounded collection of successful reads. Mutations and authentication data are never persisted. */
export type CachedQuery = { key: QueryKey; data: unknown; updatedAt: number };
export type QueryCacheSnapshot = { version: 1; userId: string; familyId: string; queries: CachedQuery[] };

const CORE_KEYS = new Set([
  'profile',
  'family',
  'family_members',
  'memberships',
  'accounting_preferences',
  'categories',
  'category_layout',
  'hidden_categories',
  'home_dashboard',
]);
const OTHER_KEYS = new Set([
  'transactions',
  'analytics',
  'budget',
  'savings_goals',
  'savings_entries',
  'recurring_transactions',
]);
const MAX_CHARS = 250_000;
const MAX_QUERIES = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function allowedKey(key: QueryKey): boolean {
  const [prefix, variant] = key;
  if (typeof prefix !== 'string') return false;
  if (prefix === 'transactions') return variant === 'home-feed' || variant === 'detail';
  if (prefix === 'notifications') return variant === 'all';
  return CORE_KEYS.has(prefix) || OTHER_KEYS.has(prefix);
}

/** Only persist the first page of infinite queries; the remaining pages can be requested again. */
function boundedData(data: unknown): unknown {
  if (!isRecord(data) || !Array.isArray(data.pages) || !Array.isArray(data.pageParams)) return data;
  return { ...data, pages: data.pages.slice(0, 1), pageParams: data.pageParams.slice(0, 1) };
}

function serializeData(key: QueryKey, data: unknown): unknown {
  if (key[0] === 'analytics' && key[1] === 'budget-progress' && isRecord(data) && data.byCategory instanceof Map) {
    return { ...data, byCategory: Array.from(data.byCategory.entries()) };
  }
  return boundedData(data);
}

function restoreData(key: QueryKey, data: unknown): unknown {
  if (key[0] !== 'analytics' || key[1] !== 'budget-progress' || !isRecord(data) || !Array.isArray(data.byCategory))
    return data;
  const entries: [string, number][] = [];
  for (const item of data.byCategory) {
    if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'number') return undefined;
    entries.push([item[0], item[1]]);
  }
  return { ...data, byCategory: new Map(entries) };
}

function priority(key: QueryKey): number {
  if (typeof key[0] === 'string' && CORE_KEYS.has(key[0])) return 0;
  if (key[0] === 'transactions' && key[1] === 'home-feed') return 1;
  return 2;
}

export function createQueryCacheSnapshot(client: QueryClient, userId: string, familyId: string): QueryCacheSnapshot {
  const candidates = client
    .getQueryCache()
    .getAll()
    .filter((query) => allowedKey(query.queryKey) && query.state.data !== undefined && query.state.dataUpdatedAt > 0)
    .map((query) => ({
      key: query.queryKey,
      data: serializeData(query.queryKey, query.state.data),
      updatedAt: query.state.dataUpdatedAt,
    }))
    .sort((a, b) => priority(a.key) - priority(b.key) || b.updatedAt - a.updatedAt);

  // The three category reads form one display dependency: an incomplete set is never restored.
  const categoryPrefixes = ['categories', 'category_layout', 'hidden_categories'];
  const hasCompleteCategories = categoryPrefixes.every((prefix) =>
    candidates.some(
      (query) => query.key[0] === prefix && (prefix !== 'categories' || query.key[1] === 'including-archived'),
    ),
  );
  let used = 0;
  const queries: CachedQuery[] = [];
  for (const query of candidates) {
    if (queries.length >= MAX_QUERIES) break;
    if (!hasCompleteCategories && categoryPrefixes.includes(String(query.key[0]))) continue;
    const size = JSON.stringify(query).length;
    if (used + size > MAX_CHARS) continue;
    queries.push(query);
    used += size;
  }
  // If a size limit excluded one component, omit the whole group rather than restore a partial hierarchy.
  if (
    !categoryPrefixes.every((prefix) =>
      queries.some(
        (query) => query.key[0] === prefix && (prefix !== 'categories' || query.key[1] === 'including-archived'),
      ),
    )
  ) {
    return {
      version: 1,
      userId,
      familyId,
      queries: queries.filter((query) => !categoryPrefixes.includes(String(query.key[0]))),
    };
  }
  return { version: 1, userId, familyId, queries };
}

/** Validate the stored envelope before restoring any query into the active user's client. */
export function parseQueryCacheSnapshot(raw: string, userId: string): QueryCacheSnapshot | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      parsed.userId !== userId ||
      typeof parsed.familyId !== 'string' ||
      !parsed.familyId ||
      !Array.isArray(parsed.queries) ||
      parsed.queries.length > MAX_QUERIES ||
      raw.length > MAX_CHARS + 100_000
    )
      return null;
    const queries: CachedQuery[] = [];
    for (const item of parsed.queries) {
      if (
        !isRecord(item) ||
        !Array.isArray(item.key) ||
        !allowedKey(item.key) ||
        !('data' in item) ||
        typeof item.updatedAt !== 'number' ||
        !Number.isFinite(item.updatedAt)
      )
        return null;
      queries.push({ key: item.key, data: item.data, updatedAt: item.updatedAt });
    }
    return { version: 1, userId, familyId: parsed.familyId, queries };
  } catch {
    return null;
  }
}

export function restoreQueryCacheSnapshot(client: QueryClient, snapshot: QueryCacheSnapshot): void {
  for (const query of snapshot.queries) {
    const data = restoreData(query.key, query.data);
    if (data !== undefined) client.setQueryData(query.key, data, { updatedAt: query.updatedAt });
  }
}
