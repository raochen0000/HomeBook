/**
 * 首页（Tab 1）：本月概览卡 + 月度总结条 + 按日分组流水列表。
 * 内容主体用 @expo/ui/swift-ui 原生渲染；外层脚手架（标题栏 / FAB / 状态页）用 RN。
 */
import { Host, ScrollView, VStack } from '@expo/ui/swift-ui';
import { padding } from '@expo/ui/swift-ui/modifiers';
import { Link, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useCategories,
  useCreateFamily,
  useFamilyMembers,
  useMyFamily,
  useMyProfile,
  useTransactions,
  type Transaction,
} from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { BalanceCard, DayGroup, InsightBanner, type RowData } from '@/features/home/components';
import { RecordSheet } from '@/features/record/record-sheet';
import { SearchSheet } from '@/features/search/search-sheet';
import { useSession } from '@/lib/auth';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { currentPeriod, dayKey, humanDay, signForType } from '@/lib/format';

type Group = { key: string; label: string; totalCents: number; rows: RowData[] };

export default function HomeScreen() {
  const palette = usePalette();
  const catColors = useCategoryColors();

  const { session } = useSession();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const membersQ = useFamilyMembers();
  const categoriesQ = useCategories();
  const transactionsQ = useTransactions();
  const createFamilyM = useCreateFamily();

  const multiMember = (familyQ.data?.member_count ?? 1) > 1;

  // 记账面板状态：editing=null 为新建，否则编辑该流水。
  const [sheet, setSheet] = useState<{ open: boolean; editing: Transaction | null; familyId: string }>({
    open: false,
    editing: null,
    familyId: '',
  });
  const [searchOpen, setSearchOpen] = useState(false);

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

  // 记一笔：若当前用户还没有家庭，先自动建「单人家庭」（M1：登录 + 单人家庭自动创建）。
  const openCreate = async () => {
    // 记账人必须是有效用户 id；profile 拉取失败时不进面板，避免把空 id 发给后端。
    if (!profileQ.data?.id) {
      Alert.alert('暂时无法记账', '账号信息还没加载好，请稍后重试或重新进入「我的」。');
      return;
    }
    let fid = familyQ.data?.id ?? profileQ.data?.current_family_id ?? null;
    if (!fid) {
      try {
        const fam = (await createFamilyM.mutateAsync({ name: '我的家' })) as { id: string };
        fid = fam.id;
      } catch (e) {
        Alert.alert('创建家庭失败', (e as Error).message ?? String(e));
        return;
      }
    }
    setSheet({ open: true, editing: null, familyId: fid });
  };

  const openEdit = (id: string) => {
    const txn = (transactionsQ.data ?? []).find((t) => t.id === id);
    if (txn) setSheet({ open: true, editing: txn, familyId: txn.family_id });
  };

  const onSearch = () => setSearchOpen(true);

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
        ) : !session ? (
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
                  <DayGroup key={g.key} label={g.label} totalCents={g.totalCents} rows={g.rows} onRowPress={openEdit} />
                ))}
              </VStack>
            </ScrollView>
          </Host>
        )}
      </SafeAreaView>

      {/* 记一笔 悬浮钮（IA §2：Tab Bar 右上方常驻） */}
      <Pressable onPress={openCreate} style={[styles.fab, { backgroundColor: palette.accent, shadowColor: '#000' }]}>
        <SymbolView name="plus" tintColor={palette.onAccent} size={28} weight="semibold" />
      </Pressable>

      {/* 记账面板（流程 2 + 编辑/删除 流程 10） */}
      <RecordSheet
        visible={sheet.open}
        editing={sheet.editing}
        familyId={sheet.familyId}
        recorderId={profileQ.data?.id ?? ''}
        onClose={() => setSheet({ open: false, editing: null, familyId: '' })}
      />

      {/* 搜索（顶栏 🔍） */}
      <SearchSheet visible={searchOpen} onClose={() => setSearchOpen(false)} />
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
