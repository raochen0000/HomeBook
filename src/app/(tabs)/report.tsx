/**
 * 报表（Tab 2，流程 9 完整版）：周/月/年维度切换 + 收支结余概览 + 结余率仪表 + 消费趋势折线
 * + 累计同期对比双线 + 收支对比双柱 + 支出分类占比环形图 + 分类环比 + 成员贡献条形图
 * + 大额支出 Top 5 + 收入结构环形图 + 分类明细下钻。
 * 月度总结入口已上移首页 hero「本月脉搏卡」（全屏可翻月，PRD §11），报表内不再设入口。
 * 口径（PRD §11）：收支结余 / 结余率统计全部流水（含储蓄类，对账）；分类占比 / 趋势 / 累计同期
 * / 分类环比 / 成员贡献 / 大额 Top N 仅算「支出 + source=normal」；收入结构仅算 source=normal 收入
 * （均排除储蓄类）。
 */
import { DatePicker, Host, Picker, Text as UIText } from '@expo/ui/swift-ui';
import { datePickerStyle, labelsHidden, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';

import {
  DEFAULT_ACCOUNTING_PREFS,
  useAccountingPrefs,
  useBudget,
  useCategories,
  useFamilyMembers,
  useMyProfile,
  useSavingsGoals,
  useTransactions,
  type Category,
  type SavingsGoal,
  type Transaction,
} from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, TabBarInset, useCategoryColors, usePalette } from '@/constants/design';
import { BudgetSheet } from '@/features/budget/budget-sheet';
import {
  CategoryMomCard,
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
import { daysToMonthEnd } from '@/lib/budget';
import {
  balanceRate,
  equalPeriodIncomeExpenseSeries,
  incomeExpenseSeries,
  inRange,
  isCurrentPeriod,
  periodRange,
  shiftAnchor,
  type Dimension,
} from '@/lib/report';

type CatSlice = { id: string; name: string; amount: number; color: string; symbol: string };
type Member = { id: string; name: string; amount: number; count: number };
type ReportScope = 'expense' | 'income' | 'balance';

const REPORT_SCOPES: { key: ReportScope; label: string }[] = [
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' },
  { key: 'balance', label: '结余' },
];

const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: 'week', label: '周' },
  { key: 'month', label: '月' },
  { key: 'year', label: '年' },
  { key: 'custom', label: '自定义' },
];

function startOfLocalDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fullDateLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function compactToolbarDateLabel(date: Date): string {
  return `${String(date.getFullYear()).slice(2)}/${date.getMonth() + 1}/${date.getDate()}`;
}

function rangeLabel(start: Date, endInclusive: Date): string {
  if (start.getTime() === endInclusive.getTime()) return fullDateLabel(start);
  const startText = `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`;
  const endText =
    start.getFullYear() === endInclusive.getFullYear()
      ? `${endInclusive.getMonth() + 1}/${endInclusive.getDate()}`
      : `${endInclusive.getFullYear()}/${endInclusive.getMonth() + 1}/${endInclusive.getDate()}`;
  return `${startText}–${endText}`;
}

function customRange(startInput: Date, endInput: Date): { start: Date; end: Date; label: string } {
  const a = startOfLocalDay(startInput);
  const b = startOfLocalDay(endInput);
  const start = a.getTime() <= b.getTime() ? a : b;
  const endInclusive = a.getTime() <= b.getTime() ? b : a;
  return { start, end: addDays(endInclusive, 1), label: rangeLabel(start, endInclusive) };
}

function previousEqualRange(start: Date, end: Date): { start: Date; end: Date; label: string } {
  const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
  const prevEnd = new Date(start);
  const prevStart = addDays(prevEnd, -days);
  return { start: prevStart, end: prevEnd, label: rangeLabel(prevStart, addDays(prevEnd, -1)) };
}

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
  const prefsQ = useAccountingPrefs();
  const savingsQ = useSavingsGoals();

  // 卡片显隐 / 排序 + 金额隐私（记账设置，个人级偏好）；行不存在回落默认。
  const prefs = prefsQ.data ?? DEFAULT_ACCOUNTING_PREFS;
  const privacy = prefs.amount_privacy;

  const [dimension, setDimension] = useState<Dimension>('month');
  const [scope, setScope] = useState<ReportScope>('expense');
  const [anchor, setAnchor] = useState(() => new Date());
  const [customStart, setCustomStart] = useState(() => {
    const d = startOfLocalDay(new Date());
    d.setDate(d.getDate() - 29);
    return d;
  });
  const [customEnd, setCustomEnd] = useState(() => startOfLocalDay(new Date()));
  const [customOpen, setCustomOpen] = useState(false);
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);
  const [memberDetail, setMemberDetail] = useState<Member | null>(null);
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [budgetOpen, setBudgetOpen] = useState(false);

  const range = useMemo(() => {
    if (dimension !== 'custom') return periodRange(dimension, anchor);
    return customRange(customStart, customEnd);
  }, [dimension, anchor, customStart, customEnd]);
  const prevRange = useMemo(() => {
    if (dimension !== 'custom') return periodRange(dimension, shiftAnchor(dimension, anchor, -1));
    return previousEqualRange(range.start, range.end);
  }, [dimension, anchor, range]);
  const isCurrent = useMemo(() => {
    if (dimension !== 'custom') return isCurrentPeriod(dimension, anchor);
    const today = startOfLocalDay(new Date());
    return range.start.getTime() <= today.getTime() && range.end.getTime() > today.getTime();
  }, [dimension, anchor, range]);
  const budgetPeriod = useMemo(() => currentPeriod(range.start), [range.start]);
  const budgetQ = useBudget(budgetPeriod);

  const {
    income,
    expense,
    balance,
    byCat,
    expenseTotal,
    members,
    balRate,
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
    const prevCatMap = new Map<string, number>(); // 上期分类消费额（环比基数）
    const bigExpenses: TopItem[] = [];

    for (const t of txns) {
      const inCur = inRange(t.occurred_at, range.start, range.end);
      const inPrev = inRange(t.occurred_at, prevRange.start, prevRange.end);
      if (!inCur && !inPrev) continue;

      const isConsumExpense = t.type === 'expense' && t.source === 'normal';

      if (inPrev) {
        if (isConsumExpense) {
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
      balRate: balanceRate(inc, inc - exp),
      // 近 6 期收支（对账口径，含储蓄类）：区间跨度超出本期/上期，传全量流水单独分桶。
      incomeExpense:
        dimension === 'custom'
          ? equalPeriodIncomeExpenseSeries(range, txns)
          : incomeExpenseSeries(dimension, range.start, txns),
      momItems: mom,
      topItems: bigExpenses.sort((a, b) => b.amount - a.amount).slice(0, 5),
      incomeSlices: Array.from(incomeMap.values()).sort((a, b) => b.amount - a.amount),
    };
  }, [txnsQ.data, catsQ.data, membersQ.data, profileQ.data, range, prevRange, dimension, catColors]);

  const loading = txnsQ.isLoading || catsQ.isLoading;
  const memberCountMax = Math.max(1, ...members.map((m) => m.count));
  const isMonthlyView = dimension === 'month';
  const currentMonthRange = useMemo(() => periodRange('month', new Date()), []);
  const selectedMonthIsCurrent = dimension === 'month' && range.start.getTime() === currentMonthRange.start.getTime();
  const monthElapsedDays = selectedMonthIsCurrent
    ? Math.max(1, Math.floor((startOfLocalDay(new Date()).getTime() - range.start.getTime()) / 86400000) + 1)
    : null;
  const monthTotalDays =
    dimension === 'month' ? Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86400000)) : 0;
  const projectedExpense =
    selectedMonthIsCurrent && monthElapsedDays ? Math.round((expenseTotal / monthElapsedDays) * monthTotalDays) : null;
  const periodText =
    dimension === 'week' ? '本周' : dimension === 'year' ? '全年' : dimension === 'month' ? '本月' : '本期';
  const customToolbarEnd = dimension === 'custom' ? addDays(range.end, -1) : range.start;
  const shiftPeriod = (delta: number) => {
    if (dimension !== 'custom') {
      setAnchor((a) => shiftAnchor(dimension, a, delta));
      return;
    }
    const days = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000));
    setCustomStart((d) => {
      const next = new Date(d);
      next.setDate(d.getDate() + delta * days);
      return next;
    });
    setCustomEnd((d) => {
      const next = new Date(d);
      next.setDate(d.getDate() + delta * days);
      return next;
    });
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
            {/* 报表主视角：先把信息架构固定为支出 / 收入 / 结余。 */}
            <Host ignoreSafeArea="all" style={styles.segmentHost}>
              <Picker
                modifiers={[pickerStyle('segmented')]}
                selection={scope}
                onSelectionChange={(value) => setScope(value as ReportScope)}
              >
                {REPORT_SCOPES.map((item) => (
                  <UIText key={item.key} modifiers={[tag(item.key)]}>
                    {item.label}
                  </UIText>
                ))}
              </Picker>
            </Host>

            {/* 周期 + 维度切换：压成一行，减少报表顶部控件高度。 */}
            <View style={styles.periodControlRow}>
              <View style={styles.periodBar}>
                <Pressable hitSlop={10} onPress={() => shiftPeriod(-1)}>
                  <SymbolView name="chevron.left" tintColor={palette.textSecondary} size={18} />
                </Pressable>
                <Pressable
                  disabled={dimension !== 'custom'}
                  onPress={() => setCustomOpen(true)}
                  style={styles.periodLabelButton}
                >
                  {dimension === 'custom' ? (
                    <View style={styles.customPeriodLabel}>
                      <ThemedText
                        style={[styles.customPeriodText, { color: palette.textPrimary }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                      >
                        {compactToolbarDateLabel(range.start)}
                      </ThemedText>
                      <SymbolView name="calendar" tintColor={palette.textTertiary} size={11} />
                      <ThemedText
                        style={[styles.customPeriodText, { color: palette.textPrimary }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.78}
                      >
                        {compactToolbarDateLabel(customToolbarEnd)}
                      </ThemedText>
                    </View>
                  ) : (
                    <ThemedText
                      style={[styles.periodLabel, { color: palette.textPrimary }]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.82}
                    >
                      {range.label}
                    </ThemedText>
                  )}
                </Pressable>
                <Pressable hitSlop={10} onPress={() => shiftPeriod(1)} disabled={isCurrent}>
                  <SymbolView
                    name="chevron.right"
                    tintColor={isCurrent ? palette.textTertiary : palette.textSecondary}
                    size={18}
                  />
                </Pressable>
              </View>
              <View style={styles.dimensionSegmentFrame}>
                <Host ignoreSafeArea="all" style={styles.dimensionSegmentHost}>
                  <Picker
                    modifiers={[pickerStyle('segmented')]}
                    selection={dimension}
                    onSelectionChange={(value) => {
                      const next = value as Dimension;
                      setDimension(next);
                      if (next === 'custom') setCustomOpen(true);
                      else setAnchor(new Date());
                    }}
                  >
                    {DIMENSIONS.map((d) => (
                      <UIText key={d.key} modifiers={[tag(d.key)]}>
                        {d.label}
                      </UIText>
                    ))}
                  </Picker>
                </Host>
              </View>
            </View>

            {isMonthlyView && scope === 'expense' ? (
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
                  topCategory={byCat[0] ?? null}
                  daysLeft={selectedMonthIsCurrent ? daysToMonthEnd() : null}
                  projected={projectedExpense}
                  palette={palette}
                  hidden={privacy}
                  onOpen={() => setBudgetOpen(true)}
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
                  emptyText="这个月还没有支出记录"
                />
                <CategoryMomCard items={momItems.slice(0, 5)} palette={palette} hidden={privacy} />
                <TopExpensesCard items={topItems} palette={palette} hidden={privacy} />
                <MonthlyMemberCard
                  members={members}
                  maxCount={memberCountMax}
                  periodText="本月"
                  palette={palette}
                  hidden={privacy}
                  onOpenMember={setMemberDetail}
                />
                <SavingsGoalsCard
                  goals={savingsQ.data ?? []}
                  loading={savingsQ.isLoading}
                  palette={palette}
                  hidden={privacy}
                  onOpen={() => setSavingsOpen(true)}
                />
              </>
            ) : isMonthlyView && scope === 'income' ? (
              <>
                <MonthlyIncomeOverviewCard
                  income={income}
                  slices={incomeSlices}
                  periodText="本月"
                  palette={palette}
                  hidden={privacy}
                />
                <MonthlyIncomeTrendCard series={incomeExpense} palette={palette} hidden={privacy} />
                <IncomeStructureCard slices={incomeSlices} palette={palette} hidden={privacy} />
              </>
            ) : isMonthlyView && scope === 'balance' ? (
              <>
                <MonthlyBalanceOverviewCard
                  expense={expense}
                  balance={balance}
                  rate={balRate}
                  periodText="本月"
                  palette={palette}
                  hidden={privacy}
                />
                <IncomeExpenseCard
                  series={incomeExpense}
                  palette={palette}
                  hidden={privacy}
                  currentPeriod={isCurrent}
                />
                <BalanceWaterfallCard
                  income={income}
                  expense={expense}
                  balance={balance}
                  categories={byCat}
                  palette={palette}
                  hidden={privacy}
                />
                <SavingsRateTrendCard series={incomeExpense} palette={palette} />
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
                {scope === 'expense' ? (
                  <>
                    <MonthlyOverviewCard
                      income={income}
                      expense={expense}
                      balance={balance}
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
                      emptyText="这个周期还没有支出记录"
                    />
                    <CategoryMomCard items={momItems.slice(0, 5)} palette={palette} hidden={privacy} />
                    <TopExpensesCard items={topItems} palette={palette} hidden={privacy} />
                    <MonthlyMemberCard
                      members={members}
                      maxCount={memberCountMax}
                      periodText={periodText}
                      palette={palette}
                      hidden={privacy}
                      onOpenMember={setMemberDetail}
                    />
                  </>
                ) : scope === 'income' ? (
                  <>
                    <MonthlyIncomeOverviewCard
                      income={income}
                      slices={incomeSlices}
                      periodText={periodText}
                      palette={palette}
                      hidden={privacy}
                    />
                    <MonthlyIncomeTrendCard series={incomeExpense} palette={palette} hidden={privacy} />
                    <IncomeStructureCard slices={incomeSlices} palette={palette} hidden={privacy} />
                  </>
                ) : (
                  <>
                    <MonthlyBalanceOverviewCard
                      expense={expense}
                      balance={balance}
                      rate={balRate}
                      periodText={periodText}
                      palette={palette}
                      hidden={privacy}
                    />
                    <IncomeExpenseCard
                      series={incomeExpense}
                      palette={palette}
                      hidden={privacy}
                      currentPeriod={isCurrent}
                    />
                    <BalanceWaterfallCard
                      income={income}
                      expense={expense}
                      balance={balance}
                      categories={byCat}
                      palette={palette}
                      hidden={privacy}
                    />
                    <SavingsRateTrendCard series={incomeExpense} palette={palette} />
                    <SavingsGoalsCard
                      goals={savingsQ.data ?? []}
                      loading={savingsQ.isLoading}
                      palette={palette}
                      hidden={privacy}
                      onOpen={() => setSavingsOpen(true)}
                    />
                  </>
                )}
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
        dimension={dimension}
        transactions={txnsQ.data ?? []}
        hidden={privacy}
        onClose={() => setDetail(null)}
      />
      <MemberAnalysisSheet
        member={memberDetail}
        range={range}
        dimension={dimension}
        transactions={txnsQ.data ?? []}
        categories={catsQ.data ?? []}
        hidden={privacy}
        onClose={() => setMemberDetail(null)}
      />
      <CustomRangeSheet
        visible={customOpen}
        start={customStart}
        end={customEnd}
        onChangeStart={setCustomStart}
        onChangeEnd={setCustomEnd}
        onClose={() => setCustomOpen(false)}
      />
      <SavingsSheet visible={savingsOpen} onClose={() => setSavingsOpen(false)} />
      <BudgetSheet visible={budgetOpen} onClose={() => setBudgetOpen(false)} />
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

function MonthlyIncomeOverviewCard({
  income,
  slices,
  periodText = '本月',
  palette,
  hidden,
}: {
  income: number;
  slices: IncomeSlice[];
  periodText?: string;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const top = slices[0];
  const cells = [
    { label: `${periodText}收入`, value: maskAmount(formatAmount(income, '+'), hidden), color: palette.income },
    { label: '收入来源', value: `${slices.length} 类`, color: palette.textPrimary },
    {
      label: '最高来源',
      value: top ? top.name : '暂无',
      color: palette.textPrimary,
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
            {cell.value}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

function MonthlyBalanceOverviewCard({
  expense,
  balance,
  rate,
  periodText = '本月',
  palette,
  hidden,
}: {
  expense: number;
  balance: number;
  rate: number | null;
  periodText?: string;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const rateText = rate == null ? '—' : `${Math.round(rate * 100)}%`;
  const cells = [
    {
      label: `${periodText}结余`,
      value: maskAmount(formatAmount(balance, signForNet(balance)), hidden),
      color: balance < 0 ? palette.danger : palette.info,
    },
    { label: '储蓄率', value: rateText, color: rate != null && rate < 0 ? palette.danger : palette.textPrimary },
    {
      label: `${periodText}支出`,
      value: maskAmount(formatAmount(expense, '-'), hidden),
      color: palette.expense,
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
            {cell.value}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

function MonthlyIncomeTrendCard({
  series,
  palette,
  hidden,
}: {
  series: { label: string; income: number; expense: number }[];
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const W = 320;
  const H = 142;
  const chartBottom = H - 18;
  const padY = 14;
  const max = Math.max(1, ...series.map((s) => s.income));
  const avg = series.length > 0 ? Math.round(series.reduce((sum, item) => sum + item.income, 0) / series.length) : 0;
  const groupW = W / Math.max(1, series.length);
  const barW = Math.min(22, groupW * 0.42);
  const hasData = series.some((s) => s.income > 0);
  const yOf = (value: number) => chartBottom - ((chartBottom - padY) * value) / max;

  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>收入趋势</ThemedText>
        <ThemedText style={[styles.chartMeta, { color: palette.textSecondary }]}>
          均线 {maskAmount(formatAmount(avg, ''), hidden)}
        </ThemedText>
      </View>
      {!hasData ? (
        <View style={styles.emptyBox}>
          <SymbolView name="chart.bar.xaxis" tintColor={palette.textTertiary} size={36} />
          <ThemedText style={{ color: palette.textSecondary }}>近几期还没有收入记录</ThemedText>
        </View>
      ) : (
        <>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            <Line
              x1="0"
              y1={yOf(avg)}
              x2={W}
              y2={yOf(avg)}
              stroke={palette.warning}
              strokeWidth="1.5"
              strokeDasharray="5 5"
            />
            <Line x1="0" y1={chartBottom} x2={W} y2={chartBottom} stroke={palette.separator} strokeWidth="1" />
            {series.map((item, index) => {
              const h = item.income > 0 ? Math.max(3, chartBottom - yOf(item.income)) : 0;
              const x = groupW * index + (groupW - barW) / 2;
              return h > 0 ? (
                <Rect key={item.label} x={x} y={chartBottom - h} width={barW} height={h} rx={4} fill={palette.income} />
              ) : null;
            })}
          </Svg>
          <View style={styles.trendLabels}>
            {series.map((item) => (
              <Text key={item.label} style={[styles.trendLabel, { color: palette.textTertiary }]}>
                {item.label}
              </Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function BalanceWaterfallCard({
  income,
  expense,
  balance,
  categories,
  palette,
  hidden,
}: {
  income: number;
  expense: number;
  balance: number;
  categories: CatSlice[];
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const topCategories = categories.slice(0, 4);
  const topTotal = topCategories.reduce((sum, item) => sum + item.amount, 0);
  const otherExpense = Math.max(0, expense - topTotal);
  const rows: { label: string; amount: number; color: string; sign: '+' | '-' | '' }[] = [
    { label: '收入', amount: income, color: palette.income, sign: '+' },
    ...topCategories.map((category) => ({
      label: category.name,
      amount: category.amount,
      color: category.color,
      sign: '-' as const,
    })),
    ...(otherExpense > 0
      ? [{ label: '其他', amount: otherExpense, color: palette.textTertiary, sign: '-' as const }]
      : []),
    {
      label: '结余',
      amount: Math.abs(balance),
      color: balance < 0 ? palette.danger : palette.info,
      sign: signForNet(balance),
    },
  ];
  const max = Math.max(1, ...rows.map((row) => row.amount));

  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>结余拆解</ThemedText>
      <View style={styles.waterfallList}>
        {rows.map((row) => (
          <View key={row.label} style={styles.waterfallRow}>
            <ThemedText style={[styles.waterfallLabel, { color: palette.textSecondary }]}>{row.label}</ThemedText>
            <View style={[styles.waterfallTrack, { backgroundColor: palette.base }]}>
              <View
                style={[
                  styles.waterfallFill,
                  { backgroundColor: row.color, width: `${Math.max(6, (row.amount / max) * 100)}%` },
                ]}
              />
            </View>
            <ThemedText
              style={[styles.waterfallAmount, { color: row.color }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.82}
            >
              {maskAmount(formatAmount(row.amount, row.sign), hidden)}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

function SavingsRateTrendCard({
  series,
  palette,
}: {
  series: { label: string; income: number; expense: number }[];
  palette: ReturnType<typeof usePalette>;
}) {
  const rates = series.map((item) => ({
    label: item.label,
    rate: item.income > 0 ? (item.income - item.expense) / item.income : null,
  }));
  const values = rates.map((item) => item.rate).filter((value): value is number => value != null);
  const hasData = values.length > 0;
  const W = 320;
  const H = 122;
  const padX = 8;
  const padY = 12;
  const min = Math.min(0, ...values);
  const max = Math.max(0.5, ...values);
  const span = Math.max(0.1, max - min);
  const stepX = rates.length > 1 ? (W - padX * 2) / (rates.length - 1) : 0;
  const xOf = (i: number) => padX + i * stepX;
  const yOf = (rate: number) => padY + (H - padY * 2) * (1 - (rate - min) / span);
  const points = rates
    .map((item, index) => (item.rate == null ? null : `${xOf(index)},${yOf(item.rate)}`))
    .filter((point): point is string => point != null)
    .join(' ');
  const latest = rates[rates.length - 1]?.rate;

  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          储蓄率趋势
        </ThemedText>
        <ThemedText style={[styles.chartMeta, { color: palette.textSecondary }]}>
          {latest == null ? '暂无收入' : `本期 ${Math.round(latest * 100)}%`}
        </ThemedText>
      </View>
      {!hasData ? (
        <View style={styles.emptyBox}>
          <SymbolView name="chart.line.uptrend.xyaxis" tintColor={palette.textTertiary} size={36} />
          <ThemedText style={{ color: palette.textSecondary }}>收入为 0 时暂不计算储蓄率</ThemedText>
        </View>
      ) : (
        <>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            <Line x1="0" y1={yOf(0)} x2={W} y2={yOf(0)} stroke={palette.separator} strokeWidth="1" />
            <Polyline
              points={points}
              fill="none"
              stroke={palette.info}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {rates.map((item, index) =>
              item.rate == null ? null : (
                <Circle key={item.label} cx={xOf(index)} cy={yOf(item.rate)} r={3} fill={palette.info} />
              ),
            )}
          </Svg>
          <View style={styles.trendLabels}>
            {rates.map((item) => (
              <Text key={item.label} style={[styles.trendLabel, { color: palette.textTertiary }]}>
                {item.label}
              </Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function MonthlyBudgetCard({
  total,
  used,
  topCategory,
  daysLeft,
  projected,
  palette,
  hidden,
  onOpen,
}: {
  total: number | null;
  used: number;
  topCategory: CatSlice | null;
  daysLeft: number | null;
  projected: number | null;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onOpen: () => void;
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
        <Pressable style={[styles.budgetAction, { borderColor: palette.separator }]} onPress={onOpen}>
          <SymbolView name="plus.circle" tintColor={palette.accent} size={17} />
          <ThemedText style={[styles.budgetActionText, { color: palette.accent }]}>设置预算</ThemedText>
        </Pressable>
      </View>
    );
  }

  const percent = Math.round((used / total) * 100);
  const remaining = total - used;
  const over = remaining < 0;
  const progress = Math.min(100, Math.max(0, percent));
  const color = over ? palette.danger : percent >= 80 ? palette.warning : palette.expense;
  const statusText = over
    ? `已超支 ${maskAmount(formatAmount(Math.abs(remaining), ''), hidden)}`
    : `剩 ${maskAmount(formatAmount(remaining, ''), hidden)}`;
  const forecastOver = projected != null && projected > total;

  return (
    <Pressable style={[styles.card, styles.budgetCard, { backgroundColor: palette.card }]} onPress={onOpen}>
      <View style={styles.budgetHeading}>
        <View style={styles.budgetTitleRow}>
          <SymbolView name="target" tintColor={palette.textSecondary} size={18} />
          <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
            本月预算
          </ThemedText>
        </View>
        <ThemedText style={{ color: over ? palette.danger : palette.textPrimary, fontWeight: '600' }}>
          {statusText}
        </ThemedText>
      </View>
      <View style={[styles.budgetTrack, { backgroundColor: palette.base }]}>
        <View style={[styles.budgetFill, { width: `${progress}%`, backgroundColor: color }]} />
      </View>
      <ThemedText style={[styles.budgetMeta, { color: palette.textSecondary }]}>
        已用 {maskAmount(formatAmount(used, ''), hidden)} / {maskAmount(formatAmount(total, ''), hidden)} · {percent}%
      </ThemedText>
      <View style={[styles.budgetInsight, { backgroundColor: palette.base }]}>
        <View style={styles.budgetInsightIcon}>
          <SymbolView
            name={over || forecastOver ? 'exclamationmark.triangle.fill' : 'checkmark.circle.fill'}
            tintColor={over || forecastOver ? palette.warning : palette.expense}
            size={17}
          />
        </View>
        <ThemedText style={[styles.budgetInsightText, { color: palette.textSecondary }]}>
          {over
            ? `${topCategory?.name ?? '本期支出'}是主要压力项`
            : forecastOver
              ? `按当前节奏，月末预计 ${maskAmount(formatAmount(projected ?? 0, ''), hidden)}`
              : daysLeft != null
                ? `距月底 ${daysLeft} 天，预算仍在可控范围`
                : '预算执行正常'}
        </ThemedText>
        <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
      </View>
    </Pressable>
  );
}

function MonthlyExpenseCategoryCard({
  categories,
  total,
  palette,
  hidden,
  onOpenDetail,
  emptyText = '这个月还没有支出记录',
}: {
  categories: CatSlice[];
  total: number;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onOpenDetail: (detail: { id: string; name: string }) => void;
  emptyText?: string;
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
          <ThemedText style={{ color: palette.textSecondary }}>{emptyText}</ThemedText>
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
  periodText = '本月',
  palette,
  hidden,
  onOpenMember,
}: {
  members: Member[];
  maxCount: number;
  periodText?: string;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onOpenMember: (member: Member) => void;
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
          <ThemedText style={{ color: palette.textSecondary }}>{periodText}还没有成员记账</ThemedText>
        </View>
      ) : (
        <View style={styles.memberList}>
          {members.map((member) => (
            <Pressable key={member.id} style={styles.memberRow} onPress={() => onOpenMember(member)}>
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
              <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
            </Pressable>
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

function CustomRangeSheet({
  visible,
  start,
  end,
  onChangeStart,
  onChangeEnd,
  onClose,
}: {
  visible: boolean;
  start: Date;
  end: Date;
  onChangeStart: (date: Date) => void;
  onChangeEnd: (date: Date) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const selectedDays = Math.max(1, Math.abs(Math.round((start.getTime() - end.getTime()) / 86400000)) + 1);
  const resetLast30Days = () => {
    const today = startOfLocalDay(new Date());
    onChangeEnd(today);
    onChangeStart(addDays(today, -29));
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView style={styles.flex}>
          <View style={styles.sheetBar}>
            <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>自定义周期</Text>
            <Pressable hitSlop={8} onPress={onClose}>
              <Text style={[styles.sheetAction, { color: palette.textSecondary }]}>完成</Text>
            </Pressable>
          </View>
          <View style={styles.customRangeContent}>
            <View style={[styles.customDateCard, { backgroundColor: palette.card }]}>
              <View style={styles.customDateRow}>
                <View style={styles.flex}>
                  <Text style={[styles.customDateLabel, { color: palette.textSecondary }]}>开始日期</Text>
                  <Text style={[styles.customDateValue, { color: palette.textPrimary }]}>{fullDateLabel(start)}</Text>
                </View>
                <Host matchContents style={styles.customDatePicker}>
                  <DatePicker
                    selection={start}
                    displayedComponents={['date']}
                    onDateChange={(date) => onChangeStart(startOfLocalDay(date))}
                    modifiers={[datePickerStyle('compact'), labelsHidden()]}
                  />
                </Host>
              </View>
              <View style={[styles.customDateDivider, { backgroundColor: palette.separator }]} />
              <View style={styles.customDateRow}>
                <View style={styles.flex}>
                  <Text style={[styles.customDateLabel, { color: palette.textSecondary }]}>结束日期</Text>
                  <Text style={[styles.customDateValue, { color: palette.textPrimary }]}>{fullDateLabel(end)}</Text>
                </View>
                <Host matchContents style={styles.customDatePicker}>
                  <DatePicker
                    selection={end}
                    displayedComponents={['date']}
                    onDateChange={(date) => onChangeEnd(startOfLocalDay(date))}
                    modifiers={[datePickerStyle('compact'), labelsHidden()]}
                  />
                </Host>
              </View>
            </View>
            <Text style={[styles.customSelectedText, { color: palette.textSecondary }]}>已选择 {selectedDays} 天</Text>
            <Pressable
              style={[styles.customResetButton, { backgroundColor: palette.card, borderColor: palette.separator }]}
              onPress={resetLast30Days}
            >
              <SymbolView name="arrow.counterclockwise" tintColor={palette.accent} size={16} />
              <Text style={[styles.customResetText, { color: palette.accent }]}>最近 30 天</Text>
            </Pressable>
            <Text style={[styles.customHint, { color: palette.textSecondary }]}>
              自定义报表会自动对比上一段等长周期。
            </Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

// ── 某分类区间流水明细（下钻）────────────────────────────────────────────────
function CategoryDetailSheet({
  detail,
  range,
  dimension,
  transactions,
  hidden,
  onClose,
}: {
  detail: { id: string; name: string } | null;
  range: { start: Date; end: Date };
  dimension: Dimension;
  transactions: Transaction[];
  hidden: boolean;
  onClose: () => void;
}) {
  const palette = usePalette();
  const { rows, periodExpense, totalExpense, noteGroups, trend } = useMemo(() => {
    const empty = {
      rows: [] as Transaction[],
      periodExpense: 0,
      totalExpense: 0,
      noteGroups: [] as { name: string; amount: number; count: number }[],
      trend: [] as { label: string; expense: number }[],
    };
    if (!detail) return empty;

    const periodRows: Transaction[] = [];
    let categoryAmount = 0;
    let allExpense = 0;
    const groupMap = new Map<string, { name: string; amount: number; count: number }>();

    for (const t of transactions) {
      const isConsumExpense = t.type === 'expense' && t.source === 'normal';
      const inPeriod = inRange(t.occurred_at, range.start, range.end);
      if (!isConsumExpense || !inPeriod) continue;
      allExpense += t.amount;
      if (t.category_id !== detail.id) continue;

      categoryAmount += t.amount;
      periodRows.push(t);

      const name = normalizeDetailNote(t.note);
      const group = groupMap.get(name) ?? { name, amount: 0, count: 0 };
      group.amount += t.amount;
      group.count += 1;
      groupMap.set(name, group);
    }

    const categoryTxns = transactions.filter(
      (t) => t.category_id === detail.id && t.type === 'expense' && t.source === 'normal',
    );
    const series =
      dimension === 'custom'
        ? equalPeriodIncomeExpenseSeries(range, categoryTxns)
        : incomeExpenseSeries(dimension, range.start, categoryTxns);

    return {
      rows: periodRows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
      periodExpense: categoryAmount,
      totalExpense: allExpense,
      noteGroups: Array.from(groupMap.values())
        .sort((a, b) => b.amount - a.amount || b.count - a.count)
        .slice(0, 5),
      trend: series.map((item) => ({ label: item.label, expense: item.expense })),
    };
  }, [detail, dimension, range, transactions]);

  const share = totalExpense > 0 ? Math.round((periodExpense / totalExpense) * 100) : 0;
  const days = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000));
  const dailyAvg = Math.round(periodExpense / days);
  const maxGroupAmount = Math.max(1, ...noteGroups.map((item) => item.amount));

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
            <View style={[styles.detailSummaryCard, { backgroundColor: palette.card }]}>
              <Text style={[styles.detailSummaryLabel, { color: palette.textSecondary }]}>
                本期{detail?.name ?? ''}支出
              </Text>
              <Text style={[styles.detailSummaryAmount, { color: palette.expense }]}>
                {maskAmount(formatAmount(periodExpense, '-'), hidden)}
              </Text>
              <Text style={[styles.detailSummaryMeta, { color: palette.textSecondary }]}>
                占支出 {share}% · {rows.length} 笔 · 日均 {maskAmount(formatAmount(dailyAvg, ''), hidden)}
              </Text>
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>常见项目</Text>
                <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>按备注聚合</Text>
              </View>
              {noteGroups.length === 0 ? (
                <View style={styles.emptyBox}>
                  <SymbolView name="text.bubble" tintColor={palette.textTertiary} size={34} />
                  <Text style={{ color: palette.textSecondary }}>暂无可聚合的支出记录</Text>
                </View>
              ) : (
                <View style={styles.detailGroupList}>
                  {noteGroups.map((item) => (
                    <View key={item.name} style={styles.detailGroupRow}>
                      <Text style={[styles.detailGroupName, { color: palette.textPrimary }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={[styles.detailGroupTrack, { backgroundColor: palette.base }]}>
                        <View
                          style={[
                            styles.detailGroupFill,
                            {
                              backgroundColor: palette.expense,
                              width: `${Math.max(6, (item.amount / maxGroupAmount) * 100)}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.detailGroupAmount, { color: palette.expense }]} numberOfLines={1}>
                        {maskAmount(formatAmount(item.amount, '-'), hidden)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>
                  {detail?.name ?? ''}趋势
                </Text>
                <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>近 6 期</Text>
              </View>
              <CategoryDetailTrendChart series={trend} palette={palette} />
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>明细流水</Text>
                <Text style={[styles.detailSectionMeta, { color: palette.accent }]}>全部 {rows.length} 笔</Text>
              </View>
              {rows.length === 0 ? (
                <View style={styles.emptyBox}>
                  <SymbolView name="list.bullet.rectangle" tintColor={palette.textTertiary} size={34} />
                  <Text style={{ color: palette.textSecondary }}>这个周期还没有该分类支出</Text>
                </View>
              ) : (
                rows.map((t) => (
                  <View key={t.id} style={[styles.detailRow, { borderBottomColor: palette.separator }]}>
                    <View style={styles.flex}>
                      <Text style={[styles.detailNote, { color: palette.textPrimary }]} numberOfLines={1}>
                        {t.note || '（无备注）'}
                      </Text>
                      <Text style={[styles.detailDate, { color: palette.textSecondary }]}>
                        {new Date(t.occurred_at).toLocaleDateString('zh-CN')}
                      </Text>
                    </View>
                    <Text style={[styles.detailAmount, { color: palette.expense }]} numberOfLines={1}>
                      {maskAmount(formatAmount(t.amount, '-'), hidden)}
                    </Text>
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function normalizeDetailNote(note: string | null): string {
  const text = note?.trim();
  if (!text) return '未填写备注';
  return text.length > 12 ? `${text.slice(0, 12)}…` : text;
}

function CategoryDetailTrendChart({
  series,
  palette,
}: {
  series: { label: string; expense: number }[];
  palette: ReturnType<typeof usePalette>;
}) {
  const W = 320;
  const H = 126;
  const chartBottom = H - 18;
  const padY = 12;
  const max = Math.max(1, ...series.map((item) => item.expense));
  const groupW = W / Math.max(1, series.length);
  const barW = Math.min(24, groupW * 0.44);
  const hasData = series.some((item) => item.expense > 0);

  if (!hasData) {
    return (
      <View style={styles.emptyBox}>
        <SymbolView name="chart.bar.xaxis" tintColor={palette.textTertiary} size={34} />
        <Text style={{ color: palette.textSecondary }}>近 6 期还没有该分类支出</Text>
      </View>
    );
  }

  return (
    <>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <Line x1="0" y1={chartBottom} x2={W} y2={chartBottom} stroke={palette.separator} strokeWidth="1" />
        {series.map((item, index) => {
          const height = item.expense > 0 ? Math.max(4, ((chartBottom - padY) * item.expense) / max) : 0;
          const x = groupW * index + (groupW - barW) / 2;
          return height > 0 ? (
            <Rect
              key={item.label}
              x={x}
              y={chartBottom - height}
              width={barW}
              height={height}
              rx={5}
              fill={palette.expense}
            />
          ) : null;
        })}
      </Svg>
      <View style={styles.trendLabels}>
        {series.map((item) => (
          <Text key={item.label} style={[styles.trendLabel, { color: palette.textTertiary }]}>
            {item.label}
          </Text>
        ))}
      </View>
    </>
  );
}

// ── 成员分析下钻：参与度 + 按记账人聚合的收支分布 ─────────────────────────────
function MemberAnalysisSheet({
  member,
  range,
  dimension,
  transactions,
  categories,
  hidden,
  onClose,
}: {
  member: Member | null;
  range: { start: Date; end: Date };
  dimension: Dimension;
  transactions: Transaction[];
  categories: Category[];
  hidden: boolean;
  onClose: () => void;
}) {
  const palette = usePalette();
  const catColors = useCategoryColors();
  const { rows, income, expense, categoryRows, trend } = useMemo(() => {
    const empty = {
      rows: [] as Transaction[],
      income: 0,
      expense: 0,
      categoryRows: [] as { id: string; name: string; amount: number; color: string }[],
      trend: [] as { label: string; expense: number }[],
    };
    if (!member) return empty;

    const catById = new Map(categories.map((category) => [category.id, category]));
    const categoryMap = new Map<string, { id: string; name: string; amount: number; color: string }>();
    const periodRows: Transaction[] = [];
    let incomeTotal = 0;
    let expenseTotal = 0;

    for (const t of transactions) {
      if (t.recorder_user_id !== member.id || !inRange(t.occurred_at, range.start, range.end)) continue;
      periodRows.push(t);
      if (t.type === 'income') incomeTotal += t.amount;
      else expenseTotal += t.amount;

      if (t.type === 'expense' && t.source === 'normal') {
        const cat = catById.get(t.category_id);
        const name = cat?.name ?? '未分类';
        const entry = categoryMap.get(t.category_id) ?? {
          id: t.category_id,
          name,
          amount: 0,
          color: catColors[categoryColorKey(name, 'expense')],
        };
        entry.amount += t.amount;
        categoryMap.set(t.category_id, entry);
      }
    }

    const memberTxns = transactions.filter(
      (t) => t.recorder_user_id === member.id && t.type === 'expense' && t.source === 'normal',
    );
    const series =
      dimension === 'custom'
        ? equalPeriodIncomeExpenseSeries(range, memberTxns)
        : incomeExpenseSeries(dimension, range.start, memberTxns);

    return {
      rows: periodRows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
      income: incomeTotal,
      expense: expenseTotal,
      categoryRows: Array.from(categoryMap.values())
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 5),
      trend: series.map((item) => ({ label: item.label, expense: item.expense })),
    };
  }, [member, range, dimension, transactions, categories, catColors]);

  const maxCategoryAmount = Math.max(1, ...categoryRows.map((item) => item.amount));
  const avg = rows.length > 0 ? Math.round((income + expense) / rows.length) : 0;

  return (
    <Modal visible={!!member} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView style={styles.flex}>
          <View style={styles.sheetBar}>
            <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>{member?.name ?? ''}</Text>
            <Pressable hitSlop={8} onPress={onClose}>
              <Text style={[styles.sheetAction, { color: palette.textSecondary }]}>完成</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetContent}>
            <View style={[styles.detailSummaryCard, { backgroundColor: palette.card }]}>
              <Text style={[styles.detailSummaryLabel, { color: palette.textSecondary }]}>本期记账参与</Text>
              <Text style={[styles.detailSummaryAmount, { color: palette.accent }]}>
                {hidden ? '****' : rows.length} 笔
              </Text>
              <Text style={[styles.detailSummaryMeta, { color: palette.textSecondary }]}>
                收入 {maskAmount(formatAmount(income, '+'), hidden)} · 支出{' '}
                {maskAmount(formatAmount(expense, '-'), hidden)} · 笔均 {maskAmount(formatAmount(avg, ''), hidden)}
              </Text>
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>支出偏好</Text>
                <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>按记账人聚合</Text>
              </View>
              {categoryRows.length === 0 ? (
                <View style={styles.emptyBox}>
                  <SymbolView name="chart.pie" tintColor={palette.textTertiary} size={34} />
                  <Text style={{ color: palette.textSecondary }}>本期没有普通支出记录</Text>
                </View>
              ) : (
                <View style={styles.detailGroupList}>
                  {categoryRows.map((item) => (
                    <View key={item.id} style={styles.detailGroupRow}>
                      <Text style={[styles.detailGroupName, { color: palette.textPrimary }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={[styles.detailGroupTrack, { backgroundColor: palette.base }]}>
                        <View
                          style={[
                            styles.detailGroupFill,
                            {
                              backgroundColor: item.color,
                              width: `${Math.max(6, (item.amount / maxCategoryAmount) * 100)}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.detailGroupAmount, { color: item.color }]} numberOfLines={1}>
                        {maskAmount(formatAmount(item.amount, '-'), hidden)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>参与趋势</Text>
                <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>近 6 期支出</Text>
              </View>
              <CategoryDetailTrendChart series={trend} palette={palette} />
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>记账明细</Text>
                <Text style={[styles.detailSectionMeta, { color: palette.accent }]}>全部 {rows.length} 笔</Text>
              </View>
              {rows.length === 0 ? (
                <View style={styles.emptyBox}>
                  <SymbolView name="list.bullet.rectangle" tintColor={palette.textTertiary} size={34} />
                  <Text style={{ color: palette.textSecondary }}>这个周期还没有该成员记录</Text>
                </View>
              ) : (
                rows.map((t) => (
                  <View key={t.id} style={[styles.detailRow, { borderBottomColor: palette.separator }]}>
                    <View style={styles.flex}>
                      <Text style={[styles.detailNote, { color: palette.textPrimary }]} numberOfLines={1}>
                        {t.note || '（无备注）'}
                      </Text>
                      <Text style={[styles.detailDate, { color: palette.textSecondary }]}>
                        {new Date(t.occurred_at).toLocaleDateString('zh-CN')}
                      </Text>
                    </View>
                    <Text
                      style={[styles.detailAmount, { color: t.type === 'income' ? palette.income : palette.expense }]}
                      numberOfLines={1}
                    >
                      {maskAmount(formatAmount(t.amount, t.type === 'income' ? '+' : '-'), hidden)}
                    </Text>
                  </View>
                ))
              )}
            </View>
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
  segmentHost: { height: 44, justifyContent: 'center' },
  dimensionSegmentFrame: { flex: 1, height: 44, justifyContent: 'center', minWidth: 0 },
  dimensionSegmentHost: { height: 34, justifyContent: 'center', minWidth: 0 },
  periodControlRow: { height: 44, flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  periodBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: Space[1],
    width: 144,
    height: 44,
  },
  periodLabel: { fontSize: 16, fontWeight: '600', maxWidth: 92, textAlign: 'center' },
  periodLabelButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space[1] },
  customPeriodLabel: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  customPeriodText: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
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
  budgetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[2],
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Space[3],
  },
  budgetActionText: { fontSize: 15, fontWeight: '600' },
  budgetInsight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    borderRadius: Radius.md,
    paddingHorizontal: Space[3],
    paddingVertical: Space[2],
  },
  budgetInsightIcon: { width: 20, alignItems: 'center' },
  budgetInsightText: { flex: 1, fontSize: 13, lineHeight: 18 },
  chartMeta: { fontSize: 13, fontWeight: '500', fontVariant: ['tabular-nums'] },
  categoryHint: { fontSize: 13, fontWeight: '500' },
  monthlyCategoryBody: { flexDirection: 'row', alignItems: 'center', gap: Space[3], paddingTop: Space[3] },
  monthlyDonutTotal: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  monthlyCategoryList: { flex: 1, minWidth: 0, gap: Space[2] },
  monthlyCategoryRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingVertical: 2 },
  monthlyCategoryName: { flex: 1, fontSize: 16, fontWeight: '500' },
  monthlyCategoryPercent: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  waterfallList: { gap: Space[3] },
  waterfallRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  waterfallLabel: { width: 38, fontSize: 14 },
  waterfallTrack: { flex: 1, height: 12, borderRadius: Radius.full, overflow: 'hidden' },
  waterfallFill: { height: '100%', borderRadius: Radius.full },
  waterfallAmount: { width: 116, textAlign: 'right', fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
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
  customRangeContent: { paddingHorizontal: Space[4], paddingBottom: Space[10], gap: Space[3] },
  customDateCard: { borderRadius: Radius.lg, paddingHorizontal: Space[4] },
  customDateRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  customDateDivider: { height: StyleSheet.hairlineWidth },
  customDateLabel: { fontSize: 13 },
  customDateValue: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  customDatePicker: { minWidth: 130, minHeight: 30, alignSelf: 'center' },
  customSelectedText: { fontSize: 13, textAlign: 'center', fontVariant: ['tabular-nums'] },
  customResetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[2],
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: Space[3],
  },
  customResetText: { fontSize: 16, fontWeight: '600' },
  customHint: { fontSize: 13, textAlign: 'center' },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
  },
  sheetTitle: { fontSize: 20, fontWeight: '700' },
  sheetAction: { fontSize: 16 },
  sheetContent: { paddingHorizontal: Space[4], paddingBottom: Space[10], gap: Space[3] },
  detailSummaryCard: { borderRadius: Radius.lg, padding: Space[4], gap: Space[2] },
  detailSummaryLabel: { fontSize: 14, fontWeight: '600' },
  detailSummaryAmount: { fontSize: 36, lineHeight: 42, fontWeight: '700', fontVariant: ['tabular-nums'] },
  detailSummaryMeta: { fontSize: 14, fontWeight: '500', fontVariant: ['tabular-nums'] },
  detailCard: { borderRadius: Radius.lg, padding: Space[4], gap: Space[3] },
  detailSectionTitle: { fontSize: 18, fontWeight: '700' },
  detailSectionMeta: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  detailGroupList: { gap: Space[3] },
  detailGroupRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  detailGroupName: { width: 72, fontSize: 15, fontWeight: '600' },
  detailGroupTrack: { flex: 1, height: 10, borderRadius: Radius.full, overflow: 'hidden' },
  detailGroupFill: { height: '100%', borderRadius: Radius.full },
  detailGroupAmount: { width: 92, textAlign: 'right', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingVertical: Space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  detailNote: { fontSize: 16 },
  detailDate: { fontSize: 13, marginTop: 2 },
  detailAmount: { width: 96, textAlign: 'right', fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
