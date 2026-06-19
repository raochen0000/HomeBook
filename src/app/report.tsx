/**
 * 报表（Tab 2，流程 9 基础版）：本月收入/支出/结余 + 支出分类占比环形图 + 分类明细（可下钻）。
 * 口径（DATAMODEL §3.4）：收支结余统计全部流水；分类占比仅算「支出 + source=normal」，排除储蓄类流水。
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCategories, useTransactions, type Transaction } from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, useCategoryColors, usePalette } from '@/constants/design';
import { Donut } from '@/features/report/donut';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { currentPeriod, formatAmount, monthLabel, signForNet } from '@/lib/format';

type CatSlice = { id: string; name: string; amount: number; color: string; symbol: string };

export default function ReportScreen() {
  const palette = usePalette();
  const catColors = useCategoryColors();
  const txnsQ = useTransactions();
  const catsQ = useCategories();

  const [monthDate, setMonthDate] = useState(() => new Date());
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);

  const period = currentPeriod(monthDate);
  const isCurrentMonth = period === currentPeriod();

  const { income, expense, balance, byCat, expenseTotal } = useMemo(() => {
    const txns = txnsQ.data ?? [];
    const cats = catsQ.data ?? [];
    const catById = new Map(cats.map((c) => [c.id, c]));

    let inc = 0;
    let exp = 0;
    const catMap = new Map<string, CatSlice>();

    for (const t of txns) {
      if (currentPeriod(new Date(t.occurred_at)) !== period) continue;
      if (t.type === 'income') inc += t.amount;
      else exp += t.amount;

      // 分类占比：仅支出 + 普通流水（排除储蓄类）
      if (t.type === 'expense' && t.source === 'normal') {
        const cat = catById.get(t.category_id);
        const name = cat?.name ?? '未分类';
        const entry = catMap.get(t.category_id) ?? {
          id: t.category_id,
          name,
          amount: 0,
          color: catColors[categoryColorKey(name, 'expense')],
          symbol: categorySymbol(cat?.icon ?? null, 'expense'),
        };
        entry.amount += t.amount;
        catMap.set(t.category_id, entry);
      }
    }

    const list = Array.from(catMap.values()).sort((a, b) => b.amount - a.amount);
    return {
      income: inc,
      expense: exp,
      balance: inc - exp,
      byCat: list,
      expenseTotal: list.reduce((s, x) => s + x.amount, 0),
    };
  }, [txnsQ.data, catsQ.data, period, catColors]);

  const loading = txnsQ.isLoading || catsQ.isLoading;
  const shiftMonth = (delta: number) => {
    const d = new Date(monthDate);
    d.setMonth(d.getMonth() + delta);
    setMonthDate(d);
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.header}>
          <ThemedText style={[styles.title, { color: palette.textPrimary }]}>报表</ThemedText>
        </View>

        {/* 月份切换 */}
        <View style={styles.monthBar}>
          <Pressable hitSlop={10} onPress={() => shiftMonth(-1)}>
            <SymbolView name="chevron.left" tintColor={palette.textSecondary} size={18} />
          </Pressable>
          <ThemedText style={[styles.monthLabel, { color: palette.textPrimary }]}>{monthLabel(monthDate)}</ThemedText>
          <Pressable hitSlop={10} onPress={() => shiftMonth(1)} disabled={isCurrentMonth}>
            <SymbolView
              name="chevron.right"
              tintColor={isCurrentMonth ? palette.textTertiary : palette.textSecondary}
              size={18}
            />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.content}>
            {/* 收支结余概览 */}
            <View style={[styles.card, styles.summary, { backgroundColor: palette.card }]}>
              <View style={styles.summaryItem}>
                <ThemedText style={[styles.summaryLabel, { color: palette.textSecondary }]}>支出</ThemedText>
                <ThemedText style={[styles.summaryAmount, { color: palette.expense }]}>
                  {formatAmount(expense, '-')}
                </ThemedText>
              </View>
              <View style={styles.summaryItem}>
                <ThemedText style={[styles.summaryLabel, { color: palette.textSecondary }]}>收入</ThemedText>
                <ThemedText style={[styles.summaryAmount, { color: palette.income }]}>
                  {formatAmount(income, '+')}
                </ThemedText>
              </View>
              <View style={styles.summaryItem}>
                <ThemedText style={[styles.summaryLabel, { color: palette.textSecondary }]}>结余</ThemedText>
                <ThemedText style={[styles.summaryAmount, { color: palette.textPrimary }]}>
                  {formatAmount(balance, signForNet(balance))}
                </ThemedText>
              </View>
            </View>

            {/* 支出分类占比 */}
            <View style={[styles.card, { backgroundColor: palette.card }]}>
              <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>支出分类占比</ThemedText>
              {byCat.length === 0 ? (
                <View style={styles.emptyBox}>
                  <SymbolView name="chart.pie" tintColor={palette.textTertiary} size={40} />
                  <ThemedText style={{ color: palette.textSecondary }}>这个月还没有支出记录</ThemedText>
                </View>
              ) : (
                <>
                  <View style={styles.donutWrap}>
                    <Donut slices={byCat.map((c) => ({ value: c.amount, color: c.color }))} trackColor={palette.base}>
                      <ThemedText style={[styles.donutCaption, { color: palette.textSecondary }]}>总支出</ThemedText>
                      <ThemedText style={[styles.donutTotal, { color: palette.textPrimary }]}>
                        {formatAmount(expenseTotal, '')}
                      </ThemedText>
                    </Donut>
                  </View>

                  {/* 分类明细（按金额降序，可点进下钻） */}
                  <View style={styles.list}>
                    {byCat.map((c, i) => {
                      const pct = expenseTotal > 0 ? Math.round((c.amount / expenseTotal) * 100) : 0;
                      return (
                        <View key={c.id}>
                          {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                          <Pressable style={styles.catRow} onPress={() => setDetail({ id: c.id, name: c.name })}>
                            <View style={[styles.catDot, { backgroundColor: c.color }]}>
                              <SymbolView name={c.symbol as SymbolViewProps['name']} tintColor="#FFFFFF" size={15} />
                            </View>
                            <ThemedText style={[styles.catName, { color: palette.textPrimary }]}>{c.name}</ThemedText>
                            <ThemedText style={[styles.catPct, { color: palette.textSecondary }]}>{pct}%</ThemedText>
                            <View style={styles.flex} />
                            <ThemedText style={[styles.catAmount, { color: palette.textPrimary }]}>
                              {formatAmount(c.amount, '')}
                            </ThemedText>
                            <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={12} />
                          </Pressable>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>

      {/* 分类流水明细下钻 */}
      <CategoryDetailSheet
        detail={detail}
        period={period}
        transactions={txnsQ.data ?? []}
        onClose={() => setDetail(null)}
      />
    </View>
  );
}

// ── 某分类本月流水明细（下钻）─────────────────────────────────────────────────
function CategoryDetailSheet({
  detail,
  period,
  transactions,
  onClose,
}: {
  detail: { id: string; name: string } | null;
  period: string;
  transactions: Transaction[];
  onClose: () => void;
}) {
  const palette = usePalette();
  const rows = useMemo(() => {
    if (!detail) return [];
    return transactions
      .filter((t) => t.category_id === detail.id && currentPeriod(new Date(t.occurred_at)) === period)
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }, [detail, period, transactions]);

  return (
    <Modal visible={!!detail} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView style={styles.flex}>
          <View style={styles.sheetBar}>
            <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>{detail?.name ?? ''}</Text>
            <Pressable hitSlop={8} onPress={onClose}>
              <Text style={[styles.sheetAction, { color: palette.textSecondary }]}>完成</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent}>
            {rows.map((t) => (
              <View key={t.id} style={[styles.detailRow, { backgroundColor: palette.card }]}>
                <View style={styles.flex}>
                  <Text style={[styles.detailNote, { color: palette.textPrimary }]}>{t.note || '（无备注）'}</Text>
                  <Text style={[styles.detailDate, { color: palette.textSecondary }]}>
                    {new Date(t.occurred_at).toLocaleDateString('zh-CN')}
                  </Text>
                </View>
                <Text style={[styles.detailAmount, { color: palette.expense }]}>{formatAmount(t.amount, '-')}</Text>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: Space[4], paddingTop: Space[2], paddingBottom: Space[2] },
  title: { fontSize: 34, fontWeight: '700' },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[6],
    paddingBottom: Space[3],
  },
  monthLabel: { fontSize: 17, fontWeight: '600', minWidth: 96, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Space[4], paddingBottom: Space[12], gap: Space[4] },
  card: { borderRadius: Radius.lg, padding: Space[4] },
  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryItem: { gap: Space[1] },
  summaryLabel: { fontSize: 13 },
  summaryAmount: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sectionTitle: { fontSize: 17, fontWeight: '600', marginBottom: Space[3] },
  emptyBox: { alignItems: 'center', justifyContent: 'center', gap: Space[2], paddingVertical: Space[8] },
  donutWrap: { alignItems: 'center', paddingVertical: Space[2] },
  donutCaption: { fontSize: 12 },
  donutTotal: { fontSize: 22, fontWeight: '700', fontVariant: ['tabular-nums'] },
  list: { marginTop: Space[4] },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 40 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3], paddingVertical: Space[3] },
  catDot: { width: 28, height: 28, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  catName: { fontSize: 16, fontWeight: '500' },
  catPct: { fontSize: 13, fontVariant: ['tabular-nums'] },
  catAmount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'], marginRight: Space[1] },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
  },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  sheetAction: { fontSize: 16 },
  sheetContent: { paddingHorizontal: Space[4], paddingBottom: Space[10], gap: Space[2] },
  detailRow: { flexDirection: 'row', alignItems: 'center', padding: Space[4], borderRadius: Radius.md },
  detailNote: { fontSize: 16 },
  detailDate: { fontSize: 13, marginTop: 2 },
  detailAmount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
