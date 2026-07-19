import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { LoginScreen } from '@/features/auth/login-screen';
import { NotificationGate } from '@/features/notifications/notification-gate';
import { usePushRegistration } from '@/features/notifications/use-push-registration';
import { useRecurringCatchup } from '@/features/record/use-recurring-catchup';
import { SearchProvider } from '@/features/search/search-provider';
import { useSession } from '@/lib/auth';
import { devAutoSignIn } from '@/lib/dev-auth';
import { queryClient } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';

export default function RootLayout() {
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
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <AppShell />
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/** Provider 内层：依赖 QueryClient / session 的根级副作用与导航壳。 */
function AppShell() {
  const colorScheme = useColorScheme();
  const { session, loading } = useSession();

  // 推送设备令牌注册（层级二骨架）：PUSH_DELIVERY_ENABLED 关时 no-op；APNs 配好翻开即通。
  usePushRegistration();

  // 定时收支补记（PRD §18）：登录态下 App 前台触发一次幂等补记（按天节流）。
  useRecurringCatchup();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {/* 搜索入口上下文：各 Tab 顶栏 🔍 共用跳转逻辑（流程 14）。 */}
      <SearchProvider>
        {/*
         * 根导航栈：四 Tab 组 `(tabs)` 无头（各 Tab 自带折叠头）；「我的」子页为 push 全屏，
         * 由各子页自行 `<Stack.Screen options>` 开启原生返回头（IA §6 G / DESIGN §10.4/§10.5）。
         */}
        <Stack screenOptions={{ headerShown: false, headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="search" />
          <Stack.Screen name="summary" />
        </Stack>
      </SearchProvider>
      {/* 已登录：关键通知兜底（被移除/解散/转让，流程 13）。 */}
      {session ? <NotificationGate /> : null}
      {/* 未登录时以全屏覆盖层显示登录页（流程 1）；session 出现后自动卸载。 */}
      {!loading && !session ? <LoginScreen /> : null}
    </ThemeProvider>
  );
}
