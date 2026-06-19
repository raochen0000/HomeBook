/**
 * 首页（Tab 1）：本月概览卡 + 月度总结条 + 按日分组流水列表。
 * 内容主体用 @expo/ui/swift-ui 原生渲染；外层脚手架（标题栏 / FAB / 状态页）用 RN。
 */
import { Host, ScrollView, VStack } from '@expo/ui/swift-ui';
import { padding } from '@expo/ui/swift-ui/modifiers';
import { Link, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategories, useFamilyMembers, useMyFamily, useMyProfile, useTransactions, type Transaction } from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { BalanceCard, DayGroup, InsightBanner, type RowData } from '@/features/home/components';
import { currentPeriod, dayKey, humanDay, signForType } from '@/lib/format';

type Group = { key: string; label: string; totalCents: number; rows: RowData[] };

export default function HomeScreen() {
  const palette = usePalette();
  const catColors = useCategoryColors();

  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const membersQ = useFamilyMembers();
  const categoriesQ = useCategories();
  const transactionsQ = useTransactions();

  const multiMember = (familyQ.data?.member_count ?? 1) > 1;

  const { groups, balance, expense, income, monthCount } = useMemo(() => {
    const txns = transactionsQ.data ?? [];
    const cats = categoriesQ.data ?? [];
    const members = membersQ.data ?? [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const nameById = new Map(members.map((m) => [m.id, m.nickname]));
    const myId = profileQ.data?.id;
    const period = currentPeriod();

    let inc = 0;
    let exp = 0;
    let cnt = 0;

    const subtitle = (t: Transaction): string | null => {
      const who = t.recorder_user_id === myId ? '我' : (nameById.get(t.recorder_user_id) ?? '成员');
      if (multiMember) return t.note ? `${t.note} · ${who}` : who;
      return t.note ?? null;
    };

    const map = new Map<string, Group>();
    for (const t of txns) {
      if (currentPeriod(new Date(t.occurred_at)) === period) {
        cnt += 1;
        if (t.type === 'income') inc += t.amount;
        else exp += t.amount;
      }

      const cat = catById.get(t.category_id);
      const ttype = (t.type === 'income' ? 'income' : 'expense') as 'income' | 'expense';
      const key = dayKey(t.occurred_at);
      const group =
        map.get(key) ??
        (() => {
          const g: Group = { key, label: humanDay(t.occurred_at), totalCents: 0, rows: [] };
          map.set(key, g);
          return g;
        })();
      group.totalCents += t.type === 'income' ? t.amount : -t.amount;
      group.rows.push({
        id: t.id,
        title: cat?.name ?? '未分类',
        subtitle: subtitle(t),
        symbol: categorySymbol(cat?.icon ?? null, ttype),
        iconColor: catColors[categoryColorKey(cat?.name ?? '', ttype)],
        amountCents: t.amount,
        sign: signForType(ttype),
        amountColor: ttype === 'income' ? palette.income : palette.expense,
      });
    }

    return {
      groups: Array.from(map.values()),
      balance: inc - exp,
      expense: exp,
      income: inc,
      monthCount: cnt,
    };
  }, [transactionsQ.data, categoriesQ.data, membersQ.data, profileQ.data, multiMember, catColors, palette]);

  const onAdd = () => Alert.alert('记一笔', '记账面板开发中');
  const onSearch = () => Alert.alert('搜索', '搜索页开发中');

  const month = new Date().getMonth() + 1;
  const loading = profileQ.isLoading || transactionsQ.isLoading || categoriesQ.isLoading;

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top']} style={styles.flex}>
        {/* 顶栏：左上标题 + 右上搜索（IA §2） */}
        <View style={styles.header}>
          <ThemedText style={[styles.title, { color: palette.textPrimary }]}>首页</ThemedText>
          <Pressable hitSlop={12} onPress={onSearch}>
            <SymbolView name="magnifyingglass" tintColor={palette.textPrimary} size={22} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : !profileQ.data ? (
          <View style={styles.center}>
            <ThemedText style={{ color: palette.textSecondary }}>请先登录</ThemedText>
            <Link href={'/mine' as Href}>
              <ThemedText style={{ color: palette.info }}>去「我的」登录</ThemedText>
            </Link>
          </View>
        ) : groups.length === 0 ? (
          <View style={styles.center}>
            <SymbolView name="tray" tintColor={palette.textTertiary} size={48} />
            <ThemedText style={{ color: palette.textSecondary }}>还没有记账，点 + 记一笔</ThemedText>
          </View>
        ) : (
          <Host style={styles.flex}>
            <ScrollView>
              <VStack spacing={Space[5]} modifiers={[padding({ horizontal: Space[4], top: Space[2], bottom: 140 })]}>
                <BalanceCard balanceCents={balance} expenseCents={expense} incomeCents={income} />
                {monthCount > 0 ? (
                  <InsightBanner message={`${month} 月家里一起记下了 ${monthCount} 笔 · 查看月度总结`} />
                ) : null}
                {groups.map((g) => (
                  <DayGroup key={g.key} label={g.label} totalCents={g.totalCents} rows={g.rows} />
                ))}
              </VStack>
            </ScrollView>
          </Host>
        )}
      </SafeAreaView>

      {/* 记一笔 悬浮钮（IA §2：Tab Bar 右上方常驻） */}
      <Pressable onPress={onAdd} style={[styles.fab, { backgroundColor: palette.accent, shadowColor: '#000' }]}>
        <SymbolView name="plus" tintColor={palette.onAccent} size={28} weight="semibold" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[3] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[4],
    paddingTop: Space[2],
    paddingBottom: Space[3],
  },
  title: { fontSize: 34, fontWeight: '700' },
  fab: {
    position: 'absolute',
    right: Space[4],
    bottom: 96,
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
