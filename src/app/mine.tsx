/**
 * 我的（Tab 4）：账号信息占位 + 开发期入口（Dev 调试台，含测试登录）。
 */
import { Link, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMyProfile } from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, usePalette } from '@/constants/design';
import { signOut, useSession } from '@/lib/auth';

export default function MineScreen() {
  const palette = usePalette();
  const { session } = useSession();
  const { data: profile } = useMyProfile();

  const onSignOut = () => {
    Alert.alert('退出登录', '确定要退出当前账号吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (e) {
            Alert.alert('退出失败', (e as Error).message ?? String(e));
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.header}>
          <ThemedText style={[styles.title, { color: palette.textPrimary }]}>我的</ThemedText>
        </View>

        <View style={styles.content}>
          <View style={[styles.card, { backgroundColor: palette.card }]}>
            <SymbolView name="person.crop.circle.fill" tintColor={palette.textTertiary} size={44} />
            <View>
              <ThemedText style={[styles.name, { color: palette.textPrimary }]}>
                {profile?.nickname ?? (session ? '已登录' : '未登录')}
              </ThemedText>
              <ThemedText style={{ color: palette.textSecondary, fontSize: 13 }}>
                {session ? '已登录' : '请在 Dev 调试台登录'}
              </ThemedText>
            </View>
          </View>

          {__DEV__ ? (
            <Link href={'/dev' as Href} style={[styles.row, { backgroundColor: palette.card }]}>
              <ThemedText style={{ color: palette.textPrimary }}>Dev 调试台</ThemedText>
            </Link>
          ) : null}

          {session ? (
            <Pressable onPress={onSignOut} style={[styles.row, { backgroundColor: palette.card }]}>
              <ThemedText style={{ color: palette.danger }}>退出登录</ThemedText>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: Space[4], paddingTop: Space[2], paddingBottom: Space[3] },
  title: { fontSize: 34, fontWeight: '700' },
  content: { paddingHorizontal: Space[4], gap: Space[3] },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    padding: Space[4],
    borderRadius: Radius.lg,
  },
  name: { fontSize: 17, fontWeight: '600' },
  row: { padding: Space[4], borderRadius: Radius.lg },
});
