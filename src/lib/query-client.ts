import { QueryClient } from '@tanstack/react-query';

/** 全局 QueryClient。RN 无 window focus 概念，关掉 refetchOnWindowFocus。 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
