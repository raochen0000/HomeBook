import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { queryKeys } from '@/api/keys';

import { FAMILY_LIVE_QUERY_KEYS, invalidateFamilyLiveQueries } from './family-live-queries';

describe('family live query keys', () => {
  it('covers the shared family query prefixes used by tabs and sheets', () => {
    expect(FAMILY_LIVE_QUERY_KEYS).toEqual([
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
    ]);
  });

  it('invalidates prefixed variants such as home feed and period dashboards', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(queryKeys.transactions, []);
    queryClient.setQueryData([...queryKeys.transactions, 'home-feed', 'fam-1'], { pages: [] });
    queryClient.setQueryData(queryKeys.homeDashboard('2026-09'), { transaction_count: 0 });
    queryClient.setQueryData(queryKeys.familyMembers, []);

    await invalidateFamilyLiveQueries(queryClient);

    expect(queryClient.getQueryState(queryKeys.transactions)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState([...queryKeys.transactions, 'home-feed', 'fam-1'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.homeDashboard('2026-09'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(queryKeys.familyMembers)?.isInvalidated).toBe(true);
  });
});
