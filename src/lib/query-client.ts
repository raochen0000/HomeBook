import { QueryClient } from '@tanstack/react-query';

/** 全局 QueryClient。RN 无 window focus；家庭协作靠 Realtime + AppState 重拉，不靠窗口焦点。 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
