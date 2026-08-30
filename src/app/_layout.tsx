import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname, useRouter, type Href } from 'expo-router';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ToastHost } from '@/components/toast';
import { NotificationGate } from '@/features/notifications/notification-gate';
import { useNotificationObserver } from '@/features/notifications/use-notification-observer';
import { usePushRegistration } from '@/features/notifications/use-push-registration';
import { useRecurringCatchup } from '@/features/record/use-recurring-catchup';
import { SearchProvider } from '@/features/search/search-provider';
import { ThemePreferenceProvider } from '@/features/settings/theme-preference';
import { localePathRef, LocalePreferenceProvider, pendingLocaleRestoreRef, useLocalePreference } from '@/i18n';
import { useSession } from '@/lib/auth';
import { devAutoSignIn } from '@/lib/dev-auth';
import { queryClient } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';

export default function RootLayout() {
  // 登录态变化时刷新所有查询，避免切换账号后读到上一个用户的缓存数据。
  // SIGNED_OUT 直接清空：注销后 profile 已是墓碑「已注销用户」，invalidate 会把墓碑写回 UI。
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        queryClient.clear();
        return;
      }
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
        <ThemePreferenceProvider>
          <LocalePreferenceProvider>
            <AppShell />
          </LocalePreferenceProvider>
        </ThemePreferenceProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/**
 * 仍有全局 t() 调用的原生页面不会订阅 locale Context；语言变化时重建导航壳，
 * 让 NativeTabs / SwiftUI Host 与所有已挂载页面使用同一份新文案。
 */
function RestoreLocaleRoute() {
  const { locale } = useLocalePreference();
  const router = useRouter();
  const previousLocale = useRef(locale);
  useLayoutEffect(() => {
    if (previousLocale.current === locale) return;
    previousLocale.current = locale;
    const path = pendingLocaleRestoreRef.current;
    pendingLocaleRestoreRef.current = null;
    if (!path) return;
    requestAnimationFrame(() => router.replace(path as Href));
  }, [locale, router]);
  return null;
}

/** Provider 内层：依赖 QueryClient / session 的根级副作用与导航壳。 */
function AppShell() {
  const colorScheme = useColorScheme();
  const { locale } = useLocalePreference();
  const pathname = usePathname();
  useEffect(() => {
    localePathRef.current = pathname;
  }, [pathname]);
  const { session, loading } = useSession();
  const signedIn = !loading && !!session;
  const signedOut = !loading && !session;

  // 推送设备令牌注册（层级二骨架）：PUSH_DELIVERY_ENABLED 关时 no-op；APNs 配好翻开即通。
  usePushRegistration();
  // 前台、后台点按与冷启动的系统推送统一跳转到通知对应的安全 App 内页面。
  useNotificationObserver(signedIn);

  // 定时收支补记（PRD §18）：登录态下 App 前台触发一次幂等补记（按天节流）。
  useRecurringCatchup();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      {/* 搜索入口上下文：各 Tab 顶栏 🔍 共用跳转逻辑（流程 14）。 */}
      <SearchProvider>
        {/*
         * 根导航栈：已登录页用 Stack.Protected 守住。注销后账号与安全等原生页会从栈里摘掉，
         * 落到 login（覆盖层无法盖住 Native Stack，这是停留在账号页的根因）。
         * 目前仍有全局 t() 调用的原生页面；key=locale 让整棵已挂载原生树同步更新。
         */}
        <Stack key={locale} screenOptions={{ headerShown: false, headerBackButtonDisplayMode: 'minimal' }}>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="search" />
            <Stack.Screen name="summary" />
            <Stack.Screen name="about" />
            <Stack.Screen name="export" />
            <Stack.Screen name="feedback" />
            <Stack.Screen name="help" />
            <Stack.Screen name="account/index" />
            <Stack.Screen name="account/phone" />
            <Stack.Screen name="account/email" />
            <Stack.Screen name="account/apple" />
            <Stack.Screen name="account/password" />
            <Stack.Screen name="settings/notifications" />
            <Stack.Screen name="settings/record" />
            <Stack.Screen name="settings/recurring" />
            <Stack.Screen name="settings/report-cards" />
          </Stack.Protected>
          <Stack.Protected guard={signedOut}>
            <Stack.Screen name="login" />
          </Stack.Protected>
        </Stack>
        <RestoreLocaleRoute />
      </SearchProvider>
      {/* 已登录：关键通知兜底（被移除/解散/转让，流程 13）。 */}
      {session ? <NotificationGate /> : null}
      {/* 已登录时的全局轻提示；未登录由 login 路由自己挂 ToastHost。 */}
      {session ? <ToastHost /> : null}
    </ThemeProvider>
  );
}
