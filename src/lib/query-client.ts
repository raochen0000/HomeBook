import { QueryClient } from '@tanstack/react-query';

import './query-network';

/** Each account/family gets its own client, so old in-flight responses cannot populate a new scope. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      // Writes must fail normally when offline; they must not be queued and replayed later.
      mutations: { networkMode: 'always' },
    },
  });
}
