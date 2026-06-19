import { QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import AppTabs from '@/components/app-tabs';
import { devAutoSignIn } from '@/lib/dev-auth';
import { queryClient } from '@/lib/query-client';
import { supabase } from '@/lib/supabase';

export default function TabLayout() {
  const colorScheme = useColorScheme();

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
        <AppTabs />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
