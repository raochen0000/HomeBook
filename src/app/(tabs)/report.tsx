/**
 * 报表（Tab 2，流程 9 完整版）：周/月/年维度切换 + 收支结余概览 + 结余率仪表 + 消费趋势折线
 * + 累计同期对比双线 + 收支对比双柱 + 支出分类占比环形图 + 分类环比 + 成员贡献条形图
 * + 大额支出 Top 5 + 收入结构环形图 + 分类明细下钻。
 * 月度总结入口已上移首页 hero「本月脉搏卡」（全屏可翻月，PRD §11），报表内不再设入口。
 * 口径（PRD §11）：收支结余 / 结余率统计全部流水（含储蓄类，对账）；分类占比 / 趋势 / 累计同期
 * / 分类环比 / 成员贡献 / 大额 Top N 仅算「支出 + source=normal」；收入结构仅算 source=normal 收入
 * （均排除储蓄类）。
 */
import { useRouter, type Href } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Polyline } from 'react-native-svg';

import {
  DEFAULT_ACCOUNTING_PREFS,
  useAccountingPrefs,
  useBudget,
  useCategories,
  useFamilyMembers,
  useMyProfile,
  useSavingsGoals,
  useTransactions,
  type SavingsGoal,
  type Transaction,
} from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, TabBarInset, useCategoryColors, usePalette } from '@/constants/design';
import {
  BalanceGaugeCard,
  CategoryMomCard,
  CumulativeCard,
  IncomeExpenseCard,
  IncomeStructureCard,
  TopExpensesCard,
  type IncomeSlice,
  type MomItem,
  type TopItem,
} from '@/features/report/advanced';
import { Donut } from '@/features/report/donut';
import { SavingsSheet } from '@/features/savings/savings-sheet';
import { HeaderSearchButton } from '@/features/search/search-provider';
import { useCollapsibleHeader } from '@/features/shared/use-collapsible-header';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { currentPeriod, formatAmount, maskAmount, signForNet } from '@/lib/format';
import { resolveCardLayout, type ReportCardId } from '@/lib/report-cards';
import {
  balanceRate,
  cumulativeSeries,
  incomeExpenseSeries,
  inRange,
  isCurrentPeriod,
  periodRange,
  shiftAnchor,
  trendBuckets,
  type Dimension,
} from '@/lib/report';

type CatSlice = { id: string; name: string; amount: number; color: string; symbol: string };
type Member = { id: string; name: string; amount: number; count: number };

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
  const router = useRouter();
  const txnsQ = useTransactions();
  const catsQ = useCategories();
  const membersQ = useFamilyMembers();
  const profileQ = useMyProfile();
  const prefsQ = useAccountingPrefs();
  const savingsQ = useSavingsGoals();

  // 卡片显隐 / 排序 + 金额隐私（记账设置，个人级偏好）；行不存在回落默认。
  const prefs = prefsQ.data ?? DEFAULT_ACCOUNTING_PREFS;
  const privacy = prefs.amount_privacy;
  const layout = resolveCardLayout(prefs.report_card_order, prefs.report_card_hidden);

  const [dimension, setDimension] = useState<Dimension>('month');
  const [anchor, setAnchor] = useState(() => new Date());
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);
  const [savingsOpen, setSavingsOpen] = useState(false);

  const range = useMemo(() => periodRange(dimension, anchor), [dimension, anchor]);
  const prevRange = useMemo(() => periodRange(dimension, shiftAnchor(dimension, anchor, -1)), [dimension, anchor]);
  const isCurrent = isCurrentPeriod(dimension, anchor);
  const budgetPeriod = useMemo(() => currentPeriod(range.start), [range.start]);
  const budgetQ = useBudget(budgetPeriod);

  const {
    income,
    expense,
    balance,
    byCat,
    expenseTotal,
    members,
    trend,
    balRate,
    cumulative,
    incomeExpense,
    momItems,
    topItems,
    incomeSlices,
  } = useMemo(() => {
    const txns = txnsQ.data ?? [];
    const cats = catsQ.data ?? [];
    const mem = membersQ.data ?? [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const nameById = new Map(mem.map((m) => [m.id, m.nickname]));
    const myId = profileQ.data?.id;

    // 分类展示信息（识别色 + 图标），分类环比里上期独有分类也要用。
    const catDisplay = (id: string, type: 'income' | 'expense') => {
      const cat = catById.get(id);
      const cname = cat?.name ?? (type === 'income' ? '其他收入' : '未分类');
      return {
        name: cname,
        color: catColors[categoryColorKey(cname, type)],
        symbol: categorySymbol(cat?.icon ?? null, type),
      };
    };

    let inc = 0;
    let exp = 0;
    const catMap = new Map<string, CatSlice>();
    const memMap = new Map<string, Member>();
    const incomeMap = new Map<string, IncomeSlice>();
    const consumExpenses: { occurred_at: string; amount: number }[] = [];
    const prevConsumExpenses: { occurred_at: string; amount: number }[] = [];
    const prevCatMap = new Map<string, number>(); // 上期分类消费额（环比基数）
    const bigExpenses: TopItem[] = [];

    for (const t of txns) {
      const inCur = inRange(t.occurred_at, range.start, range.end);
      const inPrev = inRange(t.occurred_at, prevRange.start, prevRange.end);
      if (!inCur && !inPrev) continue;

      const isConsumExpense = t.type === 'expense' && t.source === 'normal';

      if (inPrev) {
        if (isConsumExpense) {
          prevConsumExpenses.push({ occurred_at: t.occurred_at, amount: t.amount });
          prevCatMap.set(t.category_id, (prevCatMap.get(t.category_id) ?? 0) + t.amount);
        }
        if (!inCur) continue; // 仅用于环比基数 / 累计上期线，不参与本期统计
      }

      // —— 以下为本期（inCur）——
      if (t.type === 'income') inc += t.amount;
      else exp += t.amount;

      // 收入结构：仅 source=normal 收入（排除储蓄取出）
      if (t.type === 'income' && t.source === 'normal') {
        const d = catDisplay(t.category_id, 'income');
        const entry = incomeMap.get(t.category_id) ?? { id: t.category_id, ...d, amount: 0 };
        entry.amount += t.amount;
        incomeMap.set(t.category_id, entry);
      }

      // 分类占比 / 成员贡献 / 趋势 / 大额 Top N：仅支出 + 普通流水（排除储蓄类）
      if (isConsumExpense) {
        consumExpenses.push({ occurred_at: t.occurred_at, amount: t.amount });

        const d = catDisplay(t.category_id, 'expense');
        const entry = catMap.get(t.category_id) ?? { id: t.category_id, ...d, amount: 0 };
        entry.amount += t.amount;
        catMap.set(t.category_id, entry);

        const who = t.recorder_user_id === myId ? '我' : (nameById.get(t.recorder_user_id) ?? '成员');
        const me = memMap.get(t.recorder_user_id) ?? { id: t.recorder_user_id, name: who, amount: 0, count: 0 };
        me.amount += t.amount;
        me.count += 1;
        memMap.set(t.recorder_user_id, me);

        bigExpenses.push({
          id: t.id,
          note: t.note ?? '',
          category: d.name,
          color: d.color,
          symbol: d.symbol,
          amount: t.amount,
          date: new Date(t.occurred_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }),
        });
      }
    }

    const list = Array.from(catMap.values()).sort((a, b) => b.amount - a.amount);

    // 分类环比：本期分类 + 仅上期出现的分类（本期为 0），按本期金额降序。
    const momMap = new Map<string, MomItem>();
    for (const c of list)
      momMap.set(c.id, {
        id: c.id,
        name: c.name,
        color: c.color,
        symbol: c.symbol,
        cur: c.amount,
        prev: prevCatMap.get(c.id) ?? 0,
      });
    for (const [id, prevAmt] of prevCatMap) {
      if (momMap.has(id)) continue;
      const d = catDisplay(id, 'expense');
      momMap.set(id, { id, ...d, cur: 0, prev: prevAmt });
    }
    const mom = Array.from(momMap.values()).sort((a, b) => b.cur - a.cur || b.prev - a.prev);

    return {
      income: inc,
      expense: exp,
      balance: inc - exp,
      byCat: list,
      expenseTotal: list.reduce((s, x) => s + x.amount, 0),
      members: Array.from(memMap.values()).sort((a, b) => b.amount - a.amount),
      trend: trendBuckets(dimension, range, consumExpenses),
      balRate: balanceRate(inc, inc - exp),
      cumulative: cumulativeSeries(dimension, range, prevRange, isCurrent, consumExpenses, prevConsumExpenses),
      // 近 6 期收支（对账口径，含储蓄类）：区间跨度超出本期/上期，传全量流水单独分桶。
      incomeExpense: incomeExpenseSeries(dimension, range.start, txns),
      momItems: mom,
      topItems: bigExpenses.sort((a, b) => b.amount - a.amount).slice(0, 5),
      incomeSlices: Array.from(incomeMap.values()).sort((a, b) => b.amount - a.amount),
    };
  }, [txnsQ.data, catsQ.data, membersQ.data, profileQ.data, range, prevRange, isCurrent, dimension, catColors]);

  const loading = txnsQ.isLoading || catsQ.isLoading;
  const memberMax = Math.max(1, ...members.map((m) => m.amount));
  const memberCountMax = Math.max(1, ...members.map((m) => m.count));
  const isMonthlyExpenseView = dimension === 'month';

  // 按卡片 id 分发渲染；顺序 / 显隐由 layout.visible 决定（记账设置 → 报表卡片）。
  // 「成员贡献」本就无成员不渲染，与显隐叠加即可。
  const renderCard = (id: ReportCardId): ReactNode => {
    switch (id) {
      case 'overview':
        return (
          <View style={[styles.card, styles.summary, { backgroundColor: palette.card }]}>
            <View style={styles.summaryItem}>
              <ThemedText style={[styles.summaryLabel, { color: palette.textSecondary }]}>支出</ThemedText>
              <ThemedText style={[styles.summaryAmount, { color: palette.expense }]}>
                {maskAmount(formatAmount(expense, '-'), privacy)}
              </ThemedText>
            </View>
            <View style={styles.summaryItem}>
              <ThemedText style={[styles.summaryLabel, { color: palette.textSecondary }]}>收入</ThemedText>
              <ThemedText style={[styles.summaryAmount, { color: palette.income }]}>
                {maskAmount(formatAmount(income, '+'), privacy)}
              </ThemedText>
            </View>
            <View style={styles.summaryItem}>
              <ThemedText style={[styles.summaryLabel, { color: palette.textSecondary }]}>结余</ThemedText>
              <ThemedText style={[styles.summaryAmount, { color: palette.textPrimary }]}>
                {maskAmount(formatAmount(balance, signForNet(balance)), privacy)}
              </ThemedText>
            </View>
          </View>
        );
      case 'balance_rate':
        return <BalanceGaugeCard rate={balRate} palette={palette} />;
      case 'trend':
        return (
          <View style={[styles.card, { backgroundColor: palette.card }]}>
            <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>消费趋势</ThemedText>
            <TrendChart buckets={trend} palette={palette} />
          </View>
        );
      case 'cumulative':
        return <CumulativeCard series={cumulative} palette={palette} hidden={privacy} />;
      case 'income_expense':
        return <IncomeExpenseCard series={incomeExpense} palette={palette} hidden={privacy} />;
      case 'expense_category':
        return (
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
                      {maskAmount(formatAmount(expenseTotal, ''), privacy)}
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
                            {maskAmount(formatAmount(c.amount, ''), privacy)}
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
        );
      case 'category_mom':
        return <CategoryMomCard items={momItems} palette={palette} hidden={privacy} />;
      case 'member':
        return members.length > 0 ? (
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
                    {maskAmount(formatAmount(m.amount, ''), privacy)}
                  </ThemedText>
                </View>
              ))}
            </View>
          </View>
        ) : null;
      case 'top_expenses':
        return <TopExpensesCard items={topItems} palette={palette} hidden={privacy} />;
      case 'income_structure':
        return <IncomeStructureCard slices={incomeSlices} palette={palette} hidden={privacy} />;
      default:
        return null;
    }
  };

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

            {isMonthlyExpenseView ? (
              <>
                <MonthlyOverviewCard
                  income={income}
                  expense={expense}
                  balance={balance}
                  palette={palette}
                  hidden={privacy}
                />
                <MonthlyBudgetCard
                  total={budgetQ.data?.budget?.total_amount ?? null}
                  used={expenseTotal}
                  palette={palette}
                  hidden={privacy}
                />
                <IncomeExpenseCard
                  series={incomeExpense}
                  palette={palette}
                  hidden={privacy}
                  currentPeriod={isCurrent}
                />
                <MonthlyExpenseCategoryCard
                  categories={byCat}
                  total={expenseTotal}
                  palette={palette}
                  hidden={privacy}
                  onOpenDetail={setDetail}
                />
                <MonthlyMemberCard members={members} maxCount={memberCountMax} palette={palette} hidden={privacy} />
                <SavingsGoalsCard
                  goals={savingsQ.data ?? []}
                  loading={savingsQ.isLoading}
                  palette={palette}
                  hidden={privacy}
                  onOpen={() => setSavingsOpen(true)}
                />
              </>
            ) : (
              <>
                {/* 其他时间维度暂保持原有可配置卡片布局。 */}
                {layout.visible.map((id) => (
                  <Fragment key={id}>{renderCard(id)}</Fragment>
                ))}
                {layout.hidden.length > 0 ? (
                  <Pressable
                    style={[styles.addCard, { borderColor: palette.separator }]}
                    onPress={() => router.push('/settings/report-cards' as Href)}
                  >
                    <SymbolView name="plus.circle" tintColor={palette.accent} size={18} />
                    <ThemedText style={[styles.addCardText, { color: palette.accent }]}>添加数据卡片</ThemedText>
                  </Pressable>
                ) : null}
              </>
            )}
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
      <SavingsSheet visible={savingsOpen} onClose={() => setSavingsOpen(false)} />
    </View>
  );
}

function MonthlyOverviewCard({
  income,
  expense,
  balance,
  palette,
  hidden,
}: {
  income: number;
  expense: number;
  balance: number;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const cells = [
    { label: '收入', amount: income, sign: '+' as const, color: palette.income },
    { label: '支出', amount: expense, sign: '-' as const, color: palette.expense },
    {
      label: '结余',
      amount: balance,
      sign: signForNet(balance),
      color: balance < 0 ? palette.danger : palette.textPrimary,
    },
  ];
  return (
    <View style={[styles.monthlyOverview, { backgroundColor: palette.card }]}>
      {cells.map((cell) => (
        <View key={cell.label} style={styles.monthlyOverviewCell}>
          <ThemedText style={[styles.monthlyOverviewLabel, { color: palette.textSecondary }]}>{cell.label}</ThemedText>
          <ThemedText
            style={[styles.monthlyOverviewAmount, { color: cell.color }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {maskAmount(formatAmount(cell.amount, cell.sign), hidden)}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

function MonthlyBudgetCard({
  total,
  used,
  palette,
  hidden,
}: {
  total: number | null;
  used: number;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  if (!total || total <= 0) {
    return (
      <View style={[styles.card, styles.budgetCard, { backgroundColor: palette.card }]}>
        <View style={styles.budgetHeading}>
          <View style={styles.budgetTitleRow}>
            <SymbolView name="target" tintColor={palette.textSecondary} size={18} />
            <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
              本月预算
            </ThemedText>
          </View>
          <ThemedText style={{ color: palette.textSecondary }}>暂未设置</ThemedText>
        </View>
        <ThemedText style={{ color: palette.textSecondary }}>设置预算后，可在这里查看本月支出进度。</ThemedText>
      </View>
    );
  }

  const percent = Math.round((used / total) * 100);
  const remaining = total - used;
  const over = remaining < 0;
  const progress = Math.min(100, Math.max(0, percent));
  const color = over ? palette.danger : percent >= 80 ? palette.warning : palette.expense;

  return (
    <View style={[styles.card, styles.budgetCard, { backgroundColor: palette.card }]}>
      <View style={styles.budgetHeading}>
        <View style={styles.budgetTitleRow}>
          <SymbolView name="target" tintColor={palette.textSecondary} size={18} />
          <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
            本月预算
          </ThemedText>
        </View>
        <ThemedText style={{ color: over ? palette.danger : palette.textPrimary, fontWeight: '600' }}>
          {over ? '超支 ' : '剩 '}
          {maskAmount(formatAmount(Math.abs(remaining), ''), hidden)}
        </ThemedText>
      </View>
      <View style={[styles.budgetTrack, { backgroundColor: palette.base }]}>
        <View style={[styles.budgetFill, { width: `${progress}%`, backgroundColor: color }]} />
      </View>
      <ThemedText style={[styles.budgetMeta, { color: palette.textSecondary }]}>
        已用 {maskAmount(formatAmount(used, ''), hidden)} / {maskAmount(formatAmount(total, ''), hidden)} · {percent}%
      </ThemedText>
    </View>
  );
}

function MonthlyExpenseCategoryCard({
  categories,
  total,
  palette,
  hidden,
  onOpenDetail,
}: {
  categories: CatSlice[];
  total: number;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onOpenDetail: (detail: { id: string; name: string }) => void;
}) {
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>支出构成</ThemedText>
        {categories.length > 0 ? (
          <ThemedText style={[styles.categoryHint, { color: palette.accent }]}>点击类别查看明细</ThemedText>
        ) : null}
      </View>
      {categories.length === 0 ? (
        <View style={styles.emptyBox}>
          <SymbolView name="chart.pie" tintColor={palette.textTertiary} size={40} />
          <ThemedText style={{ color: palette.textSecondary }}>这个月还没有支出记录</ThemedText>
        </View>
      ) : (
        <View style={styles.monthlyCategoryBody}>
          <Donut
            slices={categories.map((c) => ({ value: c.amount, color: c.color }))}
            size={150}
            strokeWidth={24}
            trackColor={palette.base}
          >
            <ThemedText style={[styles.donutCaption, { color: palette.textSecondary }]}>总支出</ThemedText>
            <ThemedText style={[styles.monthlyDonutTotal, { color: palette.textPrimary }]}>
              {maskAmount(formatAmount(total, ''), hidden)}
            </ThemedText>
          </Donut>
          <View style={styles.monthlyCategoryList}>
            {categories.slice(0, 5).map((category) => {
              const percent = total > 0 ? Math.round((category.amount / total) * 100) : 0;
              return (
                <Pressable
                  key={category.id}
                  style={styles.monthlyCategoryRow}
                  onPress={() => onOpenDetail({ id: category.id, name: category.name })}
                >
                  <ThemedText style={[styles.monthlyCategoryName, { color: palette.textPrimary }]} numberOfLines={1}>
                    {category.name}
                  </ThemedText>
                  <ThemedText style={[styles.monthlyCategoryPercent, { color: palette.textPrimary }]}>
                    {percent}%
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

function MonthlyMemberCard({
  members,
  maxCount,
  palette,
  hidden,
}: {
  members: Member[];
  maxCount: number;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <View style={styles.memberTitleRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          成员记账参与
        </ThemedText>
        <SymbolView name="info.circle" tintColor={palette.textTertiary} size={17} />
      </View>
      {members.length === 0 ? (
        <View style={styles.emptyBox}>
          <SymbolView name="person.2" tintColor={palette.textTertiary} size={34} />
          <ThemedText style={{ color: palette.textSecondary }}>本月还没有成员记账</ThemedText>
        </View>
      ) : (
        <View style={styles.memberList}>
          {members.map((member) => (
            <View key={member.id} style={styles.memberRow}>
              <ThemedText style={[styles.memberName, { color: palette.textPrimary }]} numberOfLines={1}>
                {member.name}
              </ThemedText>
              <View style={styles.memberBarWrap}>
                <View style={[styles.memberBarTrack, { backgroundColor: palette.base }]}>
                  <View
                    style={[
                      styles.memberBarFill,
                      { backgroundColor: palette.accent, width: `${(member.count / maxCount) * 100}%` },
                    ]}
                  />
                </View>
              </View>
              <ThemedText style={[styles.memberCount, { color: palette.textPrimary }]}>
                {hidden ? '****' : member.count}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function SavingsGoalsCard({
  goals,
  loading,
  palette,
  hidden,
  onOpen,
}: {
  goals: SavingsGoal[];
  loading: boolean;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onOpen: () => void;
}) {
  if (loading) {
    return (
      <View style={[styles.card, styles.goalsCard, { backgroundColor: palette.card }]}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (goals.length === 0) {
    return (
      <View
        style={[styles.card, styles.emptyGoalsCard, { backgroundColor: palette.card, borderColor: palette.separator }]}
      >
        <SymbolView name="target" tintColor={palette.textTertiary} size={38} />
        <ThemedText style={[styles.emptyGoalTitle, { color: palette.textPrimary }]}>开始你的第一个存钱目标</ThemedText>
        <ThemedText style={[styles.emptyGoalCopy, { color: palette.textSecondary }]}>
          为家庭设个小目标，报表里实时追踪进度
        </ThemedText>
        <Pressable style={[styles.newGoalButton, { borderColor: palette.separator }]} onPress={onOpen}>
          <SymbolView name="plus" tintColor={palette.textPrimary} size={18} />
          <ThemedText style={[styles.newGoalText, { color: palette.textPrimary }]}>新建目标</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, styles.goalsCard, { backgroundColor: palette.card }]}>
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>存钱目标</ThemedText>
        <ThemedText style={{ color: palette.textSecondary }}>{goals.length} 个进行中</ThemedText>
      </View>
      {goals.slice(0, 3).map((goal, index) => {
        const progress = goal.target_amount > 0 ? Math.min(1, goal.saved_amount / goal.target_amount) : 0;
        const progressColor = index % 2 === 0 ? palette.info : palette.expense;
        return (
          <Pressable
            key={goal.id}
            style={[
              styles.goalRow,
              index > 0 && { borderTopColor: palette.separator, borderTopWidth: StyleSheet.hairlineWidth },
            ]}
            onPress={onOpen}
          >
            <Donut
              size={54}
              strokeWidth={7}
              trackColor={palette.base}
              slices={[
                { value: progress, color: progressColor },
                { value: Math.max(0, 1 - progress), color: palette.base },
              ]}
            >
              <ThemedText style={[styles.goalPercent, { color: palette.textPrimary }]}>
                {Math.round(progress * 100)}%
              </ThemedText>
            </Donut>
            <View style={styles.goalText}>
              <ThemedText style={[styles.goalName, { color: palette.textPrimary }]} numberOfLines={1}>
                {goal.name}
              </ThemedText>
              <ThemedText style={[styles.goalAmount, { color: palette.textSecondary }]} numberOfLines={1}>
                {maskAmount(formatAmount(goal.saved_amount, ''), hidden)} /{' '}
                {maskAmount(formatAmount(goal.target_amount, ''), hidden)}
              </ThemedText>
            </View>
            <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={15} />
          </Pressable>
        );
      })}
      <Pressable style={[styles.newGoalRow, { borderTopColor: palette.separator }]} onPress={onOpen}>
        <SymbolView name="plus" tintColor={palette.accent} size={18} />
        <ThemedText style={[styles.newGoalRowText, { color: palette.accent }]}>新建存钱目标</ThemedText>
      </Pressable>
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
  noMargin: { marginBottom: 0 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space[3] },
  monthlyOverview: { flexDirection: 'row', gap: Space[3], borderRadius: Radius.lg, padding: Space[4] },
  monthlyOverviewCell: { flex: 1, minWidth: 0, gap: Space[1] },
  monthlyOverviewLabel: { fontSize: 13 },
  monthlyOverviewAmount: { fontSize: 18, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  budgetCard: { gap: Space[3] },
  budgetHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space[3] },
  budgetTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  budgetTrack: { height: 10, borderRadius: Radius.full, overflow: 'hidden' },
  budgetFill: { height: '100%', borderRadius: Radius.full },
  budgetMeta: { fontSize: 14, fontVariant: ['tabular-nums'] },
  categoryHint: { fontSize: 13, fontWeight: '500' },
  monthlyCategoryBody: { flexDirection: 'row', alignItems: 'center', gap: Space[3], paddingTop: Space[3] },
  monthlyDonutTotal: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  monthlyCategoryList: { flex: 1, minWidth: 0, gap: Space[2] },
  monthlyCategoryRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingVertical: 2 },
  monthlyCategoryName: { flex: 1, fontSize: 16, fontWeight: '500' },
  monthlyCategoryPercent: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  addCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[2],
    paddingVertical: Space[4],
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  addCardText: { fontSize: 15, fontWeight: '600' },
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
  memberTitleRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2], marginBottom: Space[3] },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  memberName: { fontSize: 14, width: 56 },
  memberBarWrap: { flex: 1 },
  memberBarTrack: { height: 10, borderRadius: Radius.full, overflow: 'hidden' },
  memberBarFill: { height: '100%', borderRadius: Radius.full },
  memberAmount: { fontSize: 13, fontVariant: ['tabular-nums'], width: 76, textAlign: 'right' },
  memberCount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'], width: 28, textAlign: 'right' },
  goalsCard: { gap: Space[2] },
  emptyGoalsCard: {
    alignItems: 'center',
    gap: Space[3],
    paddingVertical: Space[8],
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyGoalTitle: { fontSize: 20, fontWeight: '700', marginTop: Space[1] },
  emptyGoalCopy: { fontSize: 15, textAlign: 'center' },
  newGoalButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
    marginTop: Space[1],
  },
  newGoalText: { fontSize: 17, fontWeight: '600' },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3], paddingVertical: Space[3] },
  goalText: { flex: 1, minWidth: 0, gap: Space[1] },
  goalName: { fontSize: 16, fontWeight: '600' },
  goalAmount: { fontSize: 13, fontVariant: ['tabular-nums'] },
  goalPercent: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  newGoalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Space[2],
    paddingTop: Space[3],
    marginTop: Space[1],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  newGoalRowText: { fontSize: 16, fontWeight: '600' },
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
