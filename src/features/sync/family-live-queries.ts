import type { QueryClient } from '@tanstack/react-query';

import { queryKeys } from '@/api/keys';

/**
 * 家庭协作缓存前缀。Realtime / 回前台只敲门铃，由这些 key 的现有 query 自己重拉。
 * 用前缀失效，以便打中带 period / range / feed 的变体。
 */
export const FAMILY_LIVE_QUERY_KEYS = [
  queryKeys.profile,
  queryKeys.family,
  queryKeys.familyMembers,
  queryKeys.memberships,
  queryKeys.transactions,
  ['home_dashboard'],
  queryKeys.analytics,
  ['budget'],
  queryKeys.savingsGoals,
  ['savings_entries'],
  ['categories'],
  queryKeys.hiddenCategories,
  queryKeys.recurringRules,
  queryKeys.notifications,
] as const;

export function invalidateFamilyLiveQueries(queryClient: QueryClient): Promise<void> {
  return Promise.all(FAMILY_LIVE_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey }))).then(
    () => undefined,
  );
}
