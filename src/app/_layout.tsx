import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { LoginScreen } from '@/features/auth/login-screen';
import { NotificationGate } from '@/features/notifications/notification-gate';
import { SearchProvider } from '@/features/search/search-provider';
import { useSession } from '@/lib/auth';
import { devAutoSignIn } from '@/lib/dev-auth';
import { queryClient } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const { session, loading } = useSession();

  // 登录态变化时刷新所有查询，避免切换账号后读到上一个用户的缓存数据。
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // 开发期：启动时自动登录测试账号（仅在无 session 时），免去每次手动登录。
  useEffect(() => {
    if (__DEV__) devAutoSignIn();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <AnimatedSplashOverlay />
        {/* 搜索单例：根级挂全屏搜索页，各 Tab 顶栏 🔍 共用（流程 14）。 */}
        <SearchProvider>
          {/*
           * 根导航栈：四 Tab 组 `(tabs)` 无头（各 Tab 自带折叠头）；「我的」子页为 push 全屏，
           * 由各子页自行 `<Stack.Screen options>` 开启原生返回头（IA §6 G / DESIGN §10.4/§10.5）。
           */}
          <Stack screenOptions={{ headerShown: false, headerBackButtonDisplayMode: 'minimal' }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        </SearchProvider>
        {/* 已登录：关键通知兜底（被移除/解散/转让，流程 13）。 */}
        {session ? <NotificationGate /> : null}
        {/* 未登录时以全屏覆盖层显示登录页（流程 1）；session 出现后自动卸载。 */}
        {!loading && !session ? <LoginScreen /> : null}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
