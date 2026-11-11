import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname, useRouter, type Href } from 'expo-router';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useColorScheme } from 'react-native';
import { initialWindowMetrics, SafeAreaProvider } from 'react-native-safe-area-context';

import { LaunchScreenOverlay } from '@/components/launch-screen';
import { ToastHost } from '@/components/toast';
import { NotificationGate } from '@/features/notifications/notification-gate';
import { useNotificationObserver } from '@/features/notifications/use-notification-observer';
import { usePushRegistration } from '@/features/notifications/use-push-registration';
import { useRecurringCatchup } from '@/features/record/use-recurring-catchup';
import { SearchProvider } from '@/features/search/search-provider';
import { ThemePreferenceProvider, useThemePreference } from '@/features/settings/theme-preference';
import { FamilyLiveSyncHost } from '@/features/sync/use-family-live-sync';
import { QueryCacheProvider } from '@/features/sync/query-cache-provider';
import { CacheStatusNotice } from '@/features/sync/cache-status';
import { localePathRef, LocalePreferenceProvider, pendingLocaleRestoreRef, useLocalePreference } from '@/i18n';
import { SessionProvider, useSession } from '@/lib/auth';

export default function RootLayout() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <ThemePreferenceProvider>
        <LocalePreferenceProvider>
          <SessionProvider>
            <QueryCacheProvider>
              <AppShell />
            </QueryCacheProvider>
          </SessionProvider>
        </LocalePreferenceProvider>
      </ThemePreferenceProvider>
    </SafeAreaProvider>
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
  const { restored: themePreferenceRestored } = useThemePreference();
  const { locale } = useLocalePreference();
  const pathname = usePathname();
  useEffect(() => {
    localePathRef.current = pathname;
  }, [pathname]);
  const { session, loading, offline } = useSession();
  const signedIn = !loading && !!session;
  const signedOut = !loading && !session;
  const showLaunchScreen = loading || !themePreferenceRestored;

  // 推送设备令牌注册（层级二骨架）：PUSH_DELIVERY_ENABLED 关时 no-op；APNs 配好翻开即通。
  usePushRegistration();
  // 前台、后台点按与冷启动的系统推送统一跳转到通知对应的安全 App 内页面。
  useNotificationObserver(signedIn);

  // 定时收支补记（PRD §18）：登录态下 App 前台触发一次幂等补记（按天节流）。
  useRecurringCatchup();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
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
            <Stack.Screen name="settings/notifications" />
            <Stack.Screen name="settings/record" />
            <Stack.Screen name="settings/recurring" />
            <Stack.Screen name="settings/report-cards" />
          </Stack.Protected>
          <Stack.Protected guard={signedIn && !offline}>
            <Stack.Screen name="account/index" />
            <Stack.Screen name="account/email" />
            <Stack.Screen name="account/apple" />
            <Stack.Screen name="account/password" />
          </Stack.Protected>
          <Stack.Protected guard={signedOut}>
            <Stack.Screen name="login" />
          </Stack.Protected>
        </Stack>
        <RestoreLocaleRoute />
      </SearchProvider>
      {/* 已登录：家庭协作同步（Realtime 门铃 + 回前台重拉）与关键通知兜底。 */}
      {session && !offline ? <FamilyLiveSyncHost /> : null}
      {session ? <NotificationGate /> : null}
      {session ? <CacheStatusNotice key={pathname} /> : null}
      {/* 已登录时的全局轻提示；未登录由 login 路由自己挂 ToastHost。 */}
      {session ? <ToastHost /> : null}
      {showLaunchScreen ? <LaunchScreenOverlay /> : null}
    </ThemeProvider>
  );
}
