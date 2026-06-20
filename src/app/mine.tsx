/**
 * 我的（Tab 4）：账号信息 + 管理入口（分类 / 储蓄目标 / 预算 / 通知中心）+ 开发期入口。
 * 二级页面统一以 Modal Sheet 呈现（沿用全局 Sheet 模式）。
 */
import { Link, type Href } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useMyProfile, useUnreadNotifications } from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, TabBarInset, usePalette } from '@/constants/design';
import { BudgetSheet } from '@/features/budget/budget-sheet';
import { CategoryManageSheet } from '@/features/category/manage-sheet';
import { NotificationCenterSheet } from '@/features/notifications/center-sheet';
import { SavingsSheet } from '@/features/savings/savings-sheet';
import { signOut, useSession } from '@/lib/auth';

type SheetKey = 'savings' | 'budget' | 'categories' | 'notifications' | null;

export default function MineScreen() {
  const palette = usePalette();
  const { session } = useSession();
  const { data: profile } = useMyProfile();
  const unreadQ = useUnreadNotifications();
  const [sheet, setSheet] = useState<SheetKey>(null);

  const unreadCount = unreadQ.data?.length ?? 0;

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

        <ScrollView contentContainerStyle={styles.content} scrollIndicatorInsets={{ bottom: TabBarInset }}>
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

          {/* 管理入口 */}
          <View style={[styles.group, { backgroundColor: palette.card }]}>
            <MenuRow icon="bell.fill" label="通知中心" badge={unreadCount} onPress={() => setSheet('notifications')} />
            <Divider palette={palette} />
            <MenuRow icon="target" label="储蓄目标" onPress={() => setSheet('savings')} />
            <Divider palette={palette} />
            <MenuRow icon="chart.pie.fill" label="预算" onPress={() => setSheet('budget')} />
            <Divider palette={palette} />
            <MenuRow icon="tag.fill" label="分类管理" onPress={() => setSheet('categories')} />
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
        </ScrollView>
      </SafeAreaView>

      <SavingsSheet visible={sheet === 'savings'} onClose={() => setSheet(null)} />
      <BudgetSheet visible={sheet === 'budget'} onClose={() => setSheet(null)} />
      <CategoryManageSheet visible={sheet === 'categories'} onClose={() => setSheet(null)} />
      <NotificationCenterSheet visible={sheet === 'notifications'} onClose={() => setSheet(null)} />
    </View>
  );
}

function MenuRow({
  icon,
  label,
  badge,
  onPress,
}: {
  icon: SymbolViewProps['name'];
  label: string;
  badge?: number;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable onPress={onPress} style={styles.menuRow}>
      <SymbolView name={icon} tintColor={palette.accent} size={20} />
      <ThemedText style={[styles.menuLabel, { color: palette.textPrimary }]}>{label}</ThemedText>
      <View style={styles.flex} />
      {badge && badge > 0 ? (
        <View style={[styles.badge, { backgroundColor: palette.danger }]}>
          <ThemedText style={styles.badgeText}>{badge > 99 ? '99+' : badge}</ThemedText>
        </View>
      ) : null}
      <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
    </Pressable>
  );
}

function Divider({ palette }: { palette: ReturnType<typeof usePalette> }) {
  return <View style={[styles.divider, { backgroundColor: palette.separator }]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: Space[4], paddingTop: Space[2], paddingBottom: Space[3] },
  title: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  content: { paddingHorizontal: Space[4], gap: Space[3], paddingBottom: TabBarInset },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    padding: Space[4],
    borderRadius: Radius.lg,
  },
  name: { fontSize: 17, fontWeight: '600' },
  row: { padding: Space[4], borderRadius: Radius.lg },
  group: { borderRadius: Radius.lg, overflow: 'hidden' },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingHorizontal: Space[4],
    paddingVertical: Space[4],
  },
  menuLabel: { fontSize: 16, fontWeight: '500' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 52 },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
});
