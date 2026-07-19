/**
 * 开发期调试页（仅 __DEV__ 可见）。
 * 提供：测试账号一键登录、建家庭、记一笔、读概览、登出。
 * 用于在真实 RLS 下验证前/后端接口。生产构建会重定向回首页。
 */
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  TEST_ACCOUNTS,
  addSampleExpense,
  createInvitation,
  devSignIn,
  devSignOut,
  ensureFamily,
  fetchOverview,
  getMyProfile,
  joinFamily,
} from '@/lib/dev-auth';
import { supabase } from '@/lib/supabase';

export default function DevScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState<string | null>(null);
  const [log, setLog] = useState<string>('（操作结果会显示在这里）');
  const [busy, setBusy] = useState(false);
  const [lastCode, setLastCode] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (!__DEV__) return <Redirect href="/" />;

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setLog(`▶ ${label} …`);
    try {
      const result = await fn();
      setLog(`✅ ${label}\n\n${JSON.stringify(result, null, 2)}`);
    } catch (e) {
      const err = e as { message?: string; code?: string };
      setLog(`❌ ${label}\n\n${err.code ? `[${err.code}] ` : ''}${err.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const button = (label: string, onPress: () => void): React.ReactNode => (
    <Pressable
      key={label}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) =>
        [styles.button, { backgroundColor: theme.backgroundElement, opacity: busy || pressed ? 0.6 : 1 }] as ViewStyle[]
      }
    >
      <ThemedText type="smallBold">{label}</ThemedText>
    </Pressable>
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content}>
          <ThemedText type="subtitle">Dev 调试台</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            当前登录：{email ?? '未登录'}
          </ThemedText>

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            登录
          </ThemedText>
          <ThemedView type="background" style={styles.row}>
            {button('登录为 大伟(户主)', () => run('登录 A', () => devSignIn(TEST_ACCOUNTS.a)))}
            {button('登录为 小美', () => run('登录 B', () => devSignIn(TEST_ACCOUNTS.b)))}
            {button('登出', () => run('登出', devSignOut))}
          </ThemedView>
          <ThemedView type="background" style={styles.row}>
            {button('登录为 阿强', () => run('登录 C', () => devSignIn(TEST_ACCOUNTS.c)))}
            {button('登录为 婷婷', () => run('登录 D', () => devSignIn(TEST_ACCOUNTS.d)))}
            {button('登录为 老王', () => run('登录 E', () => devSignIn(TEST_ACCOUNTS.e)))}
          </ThemedView>

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            数据操作（受 RLS 约束）
          </ThemedText>
          <ThemedView type="background" style={styles.row}>
            {button('我的 profile', () => run('getMyProfile', getMyProfile))}
            {button('确保有家庭', () => run('ensureFamily', () => ensureFamily()))}
            {button('记一笔 ¥25.80', () => run('addSampleExpense', () => addSampleExpense()))}
            {button('读概览', () => run('fetchOverview', fetchOverview))}
          </ThemedView>

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            邀请 → 加入（户主账号生成码，另一账号加入）
          </ThemedText>
          <ThemedView type="background" style={styles.row}>
            {button('生成邀请码', () =>
              run('createInvitation', async () => {
                const inv = await createInvitation(false);
                setLastCode(inv.code);
                return inv;
              }),
            )}
            {button(`用邀请码加入${lastCode ? `（${lastCode}）` : ''}`, () =>
              run('joinFamily', () => {
                if (!lastCode) throw new Error('请先用户主账号生成邀请码');
                return joinFamily(lastCode);
              }),
            )}
          </ThemedView>

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            结果
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.logBox}>
            <ThemedText type="code">{log}</ThemedText>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  sectionTitle: { marginTop: Spacing.three },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  button: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    borderRadius: Spacing.two,
  },
  logBox: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    minHeight: 160,
  },
});
