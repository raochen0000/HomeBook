/**
 * 报表（Tab 2，流程 9 完整版）：周/月/年维度切换 + 收支结余概览 + 支出分类占比环形图
 * + 成员贡献条形图 + 消费趋势折线图 + 月度总结入口 + 分类明细下钻。
 * 口径（PRD §11）：收支结余统计全部流水（含储蓄类，对账）；分类占比/趋势/成员贡献仅算
 * 「支出 + source=normal」（排除储蓄类）。
 */
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { useCategories, useFamilyMembers, useMyProfile, useTransactions, type Transaction } from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, TabBarInset, useCategoryColors, usePalette } from '@/constants/design';
import { Donut } from '@/features/report/donut';
import { MonthlySummarySheet } from '@/features/report/monthly-summary';
import { HeaderSearchButton } from '@/features/search/search-provider';
import { useCollapsibleHeader } from '@/features/shared/use-collapsible-header';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { currentPeriod, formatAmount, signForNet } from '@/lib/format';
import { inRange, isCurrentPeriod, periodRange, shiftAnchor, trendBuckets, type Dimension } from '@/lib/report';

type CatSlice = { id: string; name: string; amount: number; color: string; symbol: string };
type Member = { id: string; name: string; amount: number };

const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
];

export default function ReportScreen() {
  const palette = usePalette();
  const catColors = useCategoryColors();
  const insets = useSafeAreaInsets();
  // estimate 必须等于实测头高（paddingTop 8 + 标题 41 + paddingBottom 12），否则裁切框（overflow:hidden）
  // 偏小会在首帧切掉标题底部。
  const { scrollRef, headerHeight, headerStyle, onHeaderLayout } = useCollapsibleHeader(insets.top + 61);
  const txnsQ = useTransactions();
  const catsQ = useCategories();
  const membersQ = useFamilyMembers();
  const profileQ = useMyProfile();

  const [dimension, setDimension] = useState<Dimension>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  const range = useMemo(() => periodRange(dimension, anchor), [dimension, anchor]);
  const isCurrent = isCurrentPeriod(dimension, anchor);

  const { income, expense, balance, byCat, expenseTotal, members, trend } = useMemo(() => {
    const txns = txnsQ.data ?? [];
    const cats = catsQ.data ?? [];
    const mem = membersQ.data ?? [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const nameById = new Map(mem.map((m) => [m.id, m.nickname]));
    const myId = profileQ.data?.id;

    let inc = 0;
    let exp = 0;
    const catMap = new Map<string, CatSlice>();
    const memMap = new Map<string, Member>();
    const consumExpenses: { occurred_at: string; amount: number }[] = [];

    for (const t of txns) {
      if (!inRange(t.occurred_at, range.start, range.end)) continue;
      if (t.type === 'income') inc += t.amount;
      else exp += t.amount;

      // 分类占比 / 成员贡献 / 趋势：仅支出 + 普通流水（排除储蓄类）
      if (t.type === 'expense' && t.source === 'normal') {
        consumExpenses.push({ occurred_at: t.occurred_at, amount: t.amount });

        const cat = catById.get(t.category_id);
        const cname = cat?.name ?? '未分类';
        const entry = catMap.get(t.category_id) ?? {
          id: t.category_id,
          name: cname,
          amount: 0,
          color: catColors[categoryColorKey(cname, 'expense')],
          symbol: categorySymbol(cat?.icon ?? null, 'expense'),
        };
        entry.amount += t.amount;
        catMap.set(t.category_id, entry);

        const who = t.recorder_user_id === myId ? '我' : (nameById.get(t.recorder_user_id) ?? '成员');
        const me = memMap.get(t.recorder_user_id) ?? { id: t.recorder_user_id, name: who, amount: 0 };
        me.amount += t.amount;
        memMap.set(t.recorder_user_id, me);
      }
    }

    const list = Array.from(catMap.values()).sort((a, b) => b.amount - a.amount);
    return {
      income: inc,
      expense: exp,
      balance: inc - exp,
      byCat: list,
      expenseTotal: list.reduce((s, x) => s + x.amount, 0),
      members: Array.from(memMap.values()).sort((a, b) => b.amount - a.amount),
      trend: trendBuckets(dimension, range, consumExpenses),
    };
  }, [txnsQ.data, catsQ.data, membersQ.data, profileQ.data, range, dimension, catColors]);

  const loading = txnsQ.isLoading || catsQ.isLoading;
  const memberMax = Math.max(1, ...members.map((m) => m.amount));

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <View style={styles.flex}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : (
          <Animated.ScrollView
            ref={scrollRef}
            scrollEventThrottle={16}
            contentContainerStyle={[styles.content, { paddingTop: headerHeight + Space[2] }]}
            scrollIndicatorInsets={{ top: headerHeight, bottom: TabBarInset }}
          >
            {/* 维度切换 */}
            <View style={[styles.segment, { backgroundColor: palette.card }]}>
              {DIMENSIONS.map((d) => {
                const active = dimension === d.key;
                return (
                  <Pressable
                    key={d.key}
                    style={[styles.segmentItem, active && { backgroundColor: palette.base, borderRadius: Radius.sm }]}
                    onPress={() => {
                      setDimension(d.key);
                      setAnchor(new Date());
                    }}
                  >
                    <Text
                      style={{
                        color: active ? palette.textPrimary : palette.textSecondary,
                        fontWeight: active ? '600' : '400',
                      }}
                    >
                      {d.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* 周期切换 */}
            <View style={styles.periodBar}>
              <Pressable hitSlop={10} onPress={() => setAnchor((a) => shiftAnchor(dimension, a, -1))}>
                <SymbolView name="chevron.left" tintColor={palette.textSecondary} size={18} />
              </Pressable>
              <ThemedText style={[styles.periodLabel, { color: palette.textPrimary }]}>{range.label}</ThemedText>
              <Pressable
                hitSlop={10}
                onPress={() => setAnchor((a) => shiftAnchor(dimension, a, 1))}
                disabled={isCurrent}
              >
                <SymbolView
                  name="chevron.right"
                  tintColor={isCurrent ? palette.textTertiary : palette.textSecondary}
                  size={18}
                />
              </Pressable>
            </View>

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

            {/* 消费趋势 */}
            <View style={[styles.card, { backgroundColor: palette.card }]}>
              <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>消费趋势</ThemedText>
              <TrendChart buckets={trend} palette={palette} />
            </View>

            {/* 支出分类占比 */}
            <View style={[styles.card, { backgroundColor: palette.card }]}>
              <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>支出分类占比</ThemedText>
              {byCat.length === 0 ? (
                <View style={styles.emptyBox}>
                  <SymbolView name="chart.pie" tintColor={palette.textTertiary} size={40} />
                  <ThemedText style={{ color: palette.textSecondary }}>这个周期还没有支出记录</ThemedText>
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

            {/* 成员贡献 */}
            {members.length > 0 ? (
              <View style={[styles.card, { backgroundColor: palette.card }]}>
                <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>成员贡献</ThemedText>
                <View style={styles.memberList}>
                  {members.map((m) => (
                    <View key={m.id} style={styles.memberRow}>
                      <ThemedText style={[styles.memberName, { color: palette.textPrimary }]} numberOfLines={1}>
                        {m.name}
                      </ThemedText>
                      <View style={styles.memberBarWrap}>
                        <View style={[styles.memberBarTrack, { backgroundColor: palette.base }]}>
                          <View
                            style={[
                              styles.memberBarFill,
                              { backgroundColor: palette.accent, width: `${(m.amount / memberMax) * 100}%` },
                            ]}
                          />
                        </View>
                      </View>
                      <ThemedText style={[styles.memberAmount, { color: palette.textSecondary }]}>
                        {formatAmount(m.amount, '')}
                      </ThemedText>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* 月度总结入口 */}
            <Pressable
              style={[styles.summaryEntry, { backgroundColor: palette.card }]}
              onPress={() => setSummaryOpen(true)}
            >
              <SymbolView name="doc.text.fill" tintColor={palette.accent} size={20} />
              <ThemedText style={[styles.summaryEntryText, { color: palette.textPrimary }]}>查看月度总结</ThemedText>
              <View style={styles.flex} />
              <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
            </Pressable>
          </Animated.ScrollView>
        )}

        {/* 标题：绝对覆盖层，随滚动上移淡出 */}
        <View style={[styles.headerClip, { height: headerHeight }]} pointerEvents="box-none">
          <Animated.View
            style={[styles.header, { backgroundColor: palette.base, paddingTop: insets.top + Space[2] }, headerStyle]}
            onLayout={onHeaderLayout}
          >
            <ThemedText style={[styles.title, { color: palette.textPrimary }]}>报表</ThemedText>
            <HeaderSearchButton />
          </Animated.View>
        </View>
      </View>

      {/* 分类流水明细下钻 */}
      <CategoryDetailSheet
        detail={detail}
        range={range}
        transactions={txnsQ.data ?? []}
        onClose={() => setDetail(null)}
      />

      {/* 月度总结卡（按当前锚点所在月） */}
      <MonthlySummarySheet visible={summaryOpen} period={currentPeriod(anchor)} onClose={() => setSummaryOpen(false)} />
    </View>
  );
}

// ── 消费趋势折线（react-native-svg 自绘）──────────────────────────────────────
function TrendChart({
  buckets,
  palette,
}: {
  buckets: { label: string; value: number }[];
  palette: ReturnType<typeof usePalette>;
}) {
  const W = 320;
  const H = 120;
  const padX = 6;
  const padY = 10;
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const n = buckets.length;
  const stepX = n > 1 ? (W - padX * 2) / (n - 1) : 0;
  const points = buckets
    .map((b, i) => {
      const x = padX + i * stepX;
      const y = padY + (H - padY * 2) * (1 - b.value / max);
      return `${x},${y}`;
    })
    .join(' ');
  const hasData = buckets.some((b) => b.value > 0);

  // x 轴稀疏标签（最多约 6 个）
  const labelEvery = Math.max(1, Math.ceil(n / 6));

  return (
    <View>
      {!hasData ? (
        <View style={styles.emptyBox}>
          <SymbolView name="chart.xyaxis.line" tintColor={palette.textTertiary} size={36} />
          <ThemedText style={{ color: palette.textSecondary }}>这个周期还没有消费</ThemedText>
        </View>
      ) : (
        <>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            <Polyline
              points={points}
              fill="none"
              stroke={palette.expense}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {buckets.map((b, i) =>
              b.value > 0 ? (
                <Circle
                  key={i}
                  cx={padX + i * stepX}
                  cy={padY + (H - padY * 2) * (1 - b.value / max)}
                  r={2.5}
                  fill={palette.expense}
                />
              ) : null,
            )}
          </Svg>
          <View style={styles.trendLabels}>
            {buckets.map((b, i) => (
              <Text key={i} style={[styles.trendLabel, { color: palette.textTertiary }]}>
                {i % labelEvery === 0 ? b.label : ''}
              </Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

// ── 某分类区间流水明细（下钻）────────────────────────────────────────────────
function CategoryDetailSheet({
  detail,
  range,
  transactions,
  onClose,
}: {
  detail: { id: string; name: string } | null;
  range: { start: Date; end: Date };
  transactions: Transaction[];
  onClose: () => void;
}) {
  const palette = usePalette();
  const rows = useMemo(() => {
    if (!detail) return [];
    return transactions
      .filter((t) => t.category_id === detail.id && inRange(t.occurred_at, range.start, range.end))
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  }, [detail, range, transactions]);

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
  headerClip: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden', zIndex: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[4],
    paddingTop: Space[2],
    paddingBottom: Space[3],
  },
  title: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  segment: { flexDirection: 'row', borderRadius: Radius.md, padding: 3 },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: Space[2] },
  periodBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[6],
  },
  periodLabel: { fontSize: 17, fontWeight: '600', minWidth: 120, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: Space[4], paddingBottom: TabBarInset, gap: Space[4] },
  card: { borderRadius: Radius.lg, padding: Space[4] },
  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  summaryItem: { gap: Space[1] },
  summaryLabel: { fontSize: 13 },
  summaryAmount: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sectionTitle: { fontSize: 17, fontWeight: '600', marginBottom: Space[3] },
  emptyBox: { alignItems: 'center', justifyContent: 'center', gap: Space[2], paddingVertical: Space[6] },
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
  trendLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Space[1] },
  trendLabel: { fontSize: 10, flex: 1, textAlign: 'center' },
  memberList: { gap: Space[3] },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  memberName: { fontSize: 14, width: 56 },
  memberBarWrap: { flex: 1 },
  memberBarTrack: { height: 10, borderRadius: Radius.full, overflow: 'hidden' },
  memberBarFill: { height: '100%', borderRadius: Radius.full },
  memberAmount: { fontSize: 13, fontVariant: ['tabular-nums'], width: 76, textAlign: 'right' },
  summaryEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    padding: Space[4],
    borderRadius: Radius.lg,
  },
  summaryEntryText: { fontSize: 16, fontWeight: '500' },
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
