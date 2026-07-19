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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type Href, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
  type TxnRange,
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
import { resolveCardLayout, type ReportCardId } from '@/lib/report-cards';

type CatSlice = { id: string; name: string; amount: number; color: string; symbol: string };
type Member = { id: string; name: string; amount: number; count: number };
type ReportScope = 'expense' | 'income' | 'balance';
type ReportFilters = { memberIds: string[]; categoryIds: string[] };
type IncomeTargets = { annual: number; custom: number; activeRatio: number };
type FinancialInsight = { title: string; body: string; action: string; tone: 'ok' | 'warn' | 'danger' };

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

const EMPTY_FILTERS: ReportFilters = { memberIds: [], categoryIds: [] };
const DEFAULT_INCOME_TARGETS: IncomeTargets = { annual: 0, custom: 0, activeRatio: 70 };
const INCOME_TARGETS_KEY = 'homebook:report-income-targets:v1';

function arrayToggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function filterTransactions(txns: Transaction[], filters: ReportFilters): Transaction[] {
  return txns.filter((t) => {
    if (filters.memberIds.length > 0 && !filters.memberIds.includes(t.recorder_user_id)) return false;
    if (filters.categoryIds.length > 0 && !filters.categoryIds.includes(t.category_id)) return false;
    return true;
  });
}

function filterCountInRange(txns: Transaction[], filters: ReportFilters, range: { start: Date; end: Date }): number {
  return filterTransactions(txns, filters).filter((t) => inRange(t.occurred_at, range.start, range.end)).length;
}

function activeFilterCount(filters: ReportFilters): number {
  return filters.memberIds.length + filters.categoryIds.length;
}

function isPassiveIncomeName(name: string): boolean {
  return /利息|理财|投资|股息|分红|租金|被动/.test(name);
}

function targetForDimension(targets: IncomeTargets, dimension: Dimension): number {
  return dimension === 'year' ? targets.annual : targets.custom;
}

function projectionForRange(amount: number, range: { start: Date; end: Date }, isCurrent: boolean): number | null {
  if (!isCurrent) return null;
  const today = startOfLocalDay(new Date());
  const elapsed = Math.max(1, Math.floor((today.getTime() - range.start.getTime()) / 86400000) + 1);
  const total = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000));
  return Math.round((amount / elapsed) * total);
}

function renderOrderedCards(nodes: Partial<Record<ReportCardId, ReactNode>>, order: ReportCardId[]): ReactNode[] {
  return order.map((id) => (nodes[id] ? <View key={id}>{nodes[id]}</View> : null)).filter(Boolean);
}

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

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  const router = useRouter();
  const palette = usePalette();
  const catColors = useCategoryColors();
  const insets = useSafeAreaInsets();
  // estimate 必须等于实测头高（paddingTop 8 + 标题 41 + paddingBottom 12），否则裁切框（overflow:hidden）
  // 偏小会在首帧切掉标题底部。
  const { scrollRef, headerHeight, headerStyle, onHeaderLayout } = useCollapsibleHeader(insets.top + 61);
  const catsQ = useCategories();
  const membersQ = useFamilyMembers();
  const profileQ = useMyProfile();
  const prefsQ = useAccountingPrefs();
  const savingsQ = useSavingsGoals();

  // 卡片显隐 / 排序 + 金额隐私（记账设置，个人级偏好）；行不存在回落默认。
  const prefs = prefsQ.data ?? DEFAULT_ACCOUNTING_PREFS;
  const privacy = prefs.amount_privacy;
  const cardLayout = resolveCardLayout(prefs.report_card_order, prefs.report_card_hidden);

  const [dimension, setDimension] = useState<Dimension>('month');
  const [scope, setScope] = useState<ReportScope>('expense');
  const [anchor, setAnchor] = useState(() => new Date());
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [incomeTargets, setIncomeTargets] = useState<IncomeTargets>(DEFAULT_INCOME_TARGETS);
  const [incomeTargetOpen, setIncomeTargetOpen] = useState(false);
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

  // 流水拉取窗：覆盖「锚点期往前 6 期」——「收支对比」最多回看 6 期（incomeExpenseSeries /
  // equalPeriodIncomeExpenseSeries 的默认 count），是所有卡片里最宽的回看跨度。半开区间 [from, to)
  // 与前端 inRange 口径一致；切维度 / 翻期时窗口变化，useTransactions 会按 key 自动重取。
  const fetchRange = useMemo<TxnRange>(() => {
    const HISTORY_PERIODS = 6;
    let from: Date;
    if (dimension === 'custom') {
      const length = Math.max(86400000, range.end.getTime() - range.start.getTime());
      from = new Date(range.start.getTime() - (HISTORY_PERIODS - 1) * length);
    } else {
      from = periodRange(dimension, shiftAnchor(dimension, anchor, -(HISTORY_PERIODS - 1))).start;
    }
    return { from: from.toISOString(), to: range.end.toISOString() };
  }, [dimension, anchor, range]);
  const txnsQ = useTransactions(fetchRange);
  const rawTxns = useMemo(() => txnsQ.data ?? [], [txnsQ.data]);
  const filteredTxns = useMemo(() => filterTransactions(rawTxns, filters), [rawTxns, filters]);
  const filteredCount = useMemo(() => filterCountInRange(rawTxns, filters, range), [rawTxns, filters, range]);
  const activeFilters = activeFilterCount(filters);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(INCOME_TARGETS_KEY)
      .then((raw) => {
        if (!raw || !alive) return;
        setIncomeTargets({ ...DEFAULT_INCOME_TARGETS, ...JSON.parse(raw) });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const saveIncomeTargets = (next: IncomeTargets) => {
    setIncomeTargets(next);
    AsyncStorage.setItem(INCOME_TARGETS_KEY, JSON.stringify(next)).catch(() => {});
  };

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
    passiveIncome,
  } = useMemo(() => {
    const txns = filteredTxns;
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
    let passiveInc = 0;

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
        if (isPassiveIncomeName(d.name)) passiveInc += t.amount;
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
      passiveIncome: passiveInc,
    };
  }, [filteredTxns, catsQ.data, membersQ.data, profileQ.data, range, prevRange, dimension, catColors]);

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
  const projectedIncome = projectionForRange(income, range, isCurrent);
  const incomeTarget = targetForDimension(incomeTargets, dimension);
  const activeIncome = Math.max(0, income - passiveIncome);
  const periodText =
    dimension === 'week' ? '本周' : dimension === 'year' ? '全年' : dimension === 'month' ? '本月' : '本期';
  const customToolbarEnd = dimension === 'custom' ? addDays(range.end, -1) : range.start;
  const visibleCards = cardLayout.visible;
  const hiddenCards = cardLayout.hidden;
  const openCardSettings = () => router.push('/settings/report-cards' as Href);
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

  const commonInsightCard = (
    <FinancialInsightsCard
      income={income}
      expense={expense}
      expenseTotal={expenseTotal}
      projectedExpense={projectedExpense}
      projectedIncome={projectedIncome}
      budgetTotal={budgetQ.data?.budget?.total_amount ?? null}
      topCategory={byCat[0] ?? null}
      topExpense={topItems[0] ?? null}
      goals={savingsQ.data ?? []}
      incomeTarget={incomeTarget}
      palette={palette}
      hidden={privacy}
    />
  );
  const commonStatsCard = (
    <MoreStatsCard transactions={filteredTxns} range={range} palette={palette} hidden={privacy} />
  );
  const addCardEntry =
    hiddenCards.length > 0 ? (
      <AddReportCardButton hiddenCount={hiddenCards.length} palette={palette} onPress={openCardSettings} />
    ) : null;

  const expenseCards: Partial<Record<ReportCardId, ReactNode>> = {
    overview: (
      <MonthlyOverviewCard income={income} expense={expense} balance={balance} palette={palette} hidden={privacy} />
    ),
    ...(isMonthlyView
      ? {
          budget: (
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
          ),
        }
      : {}),
    insights: commonInsightCard,
    income_expense: (
      <IncomeExpenseCard series={incomeExpense} palette={palette} hidden={privacy} currentPeriod={isCurrent} />
    ),
    expense_category: (
      <MonthlyExpenseCategoryCard
        categories={byCat}
        total={expenseTotal}
        palette={palette}
        hidden={privacy}
        onOpenDetail={setDetail}
        emptyText={isMonthlyView ? '这个月还没有支出记录' : '这个周期还没有支出记录'}
      />
    ),
    category_mom: <CategoryMomCard items={momItems.slice(0, 5)} palette={palette} hidden={privacy} />,
    top_expenses: <TopExpensesCard items={topItems} palette={palette} hidden={privacy} />,
    member: (
      <MonthlyMemberCard
        members={members}
        maxCount={memberCountMax}
        periodText={periodText}
        palette={palette}
        hidden={privacy}
        onOpenMember={setMemberDetail}
      />
    ),
    ...(isMonthlyView
      ? {
          savings_goals: (
            <SavingsGoalsCard
              goals={savingsQ.data ?? []}
              loading={savingsQ.isLoading}
              palette={palette}
              hidden={privacy}
              onOpen={() => setSavingsOpen(true)}
            />
          ),
        }
      : {}),
    more_stats: commonStatsCard,
  };

  const incomeCards: Partial<Record<ReportCardId, ReactNode>> = {
    overview: (
      <MonthlyIncomeOverviewCard
        income={income}
        slices={incomeSlices}
        periodText={periodText}
        palette={palette}
        hidden={privacy}
      />
    ),
    income_target: (
      <IncomeTargetCard
        income={income}
        activeIncome={activeIncome}
        passiveIncome={passiveIncome}
        target={incomeTarget}
        targets={incomeTargets}
        dimension={dimension}
        projected={projectedIncome}
        palette={palette}
        hidden={privacy}
        onOpen={() => setIncomeTargetOpen(true)}
      />
    ),
    insights: commonInsightCard,
    income_trend: <MonthlyIncomeTrendCard series={incomeExpense} palette={palette} hidden={privacy} />,
    income_structure: <IncomeStructureCard slices={incomeSlices} palette={palette} hidden={privacy} />,
    more_stats: commonStatsCard,
  };

  const balanceCards: Partial<Record<ReportCardId, ReactNode>> = {
    overview: (
      <MonthlyBalanceOverviewCard
        expense={expense}
        balance={balance}
        rate={balRate}
        periodText={periodText}
        palette={palette}
        hidden={privacy}
      />
    ),
    insights: commonInsightCard,
    income_expense: (
      <IncomeExpenseCard series={incomeExpense} palette={palette} hidden={privacy} currentPeriod={isCurrent} />
    ),
    balance_waterfall: (
      <BalanceWaterfallCard
        income={income}
        expense={expense}
        balance={balance}
        categories={byCat}
        palette={palette}
        hidden={privacy}
      />
    ),
    savings_rate: <SavingsRateTrendCard series={incomeExpense} palette={palette} />,
    savings_goals: (
      <SavingsGoalsCard
        goals={savingsQ.data ?? []}
        loading={savingsQ.isLoading}
        palette={palette}
        hidden={privacy}
        onOpen={() => setSavingsOpen(true)}
      />
    ),
    more_stats: commonStatsCard,
  };
  const scopeCards = scope === 'expense' ? expenseCards : scope === 'income' ? incomeCards : balanceCards;

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

            <ReportFilterBar
              activeCount={activeFilters}
              matchedCount={filteredCount}
              palette={palette}
              onPress={() => setFilterOpen(true)}
            />

            {renderOrderedCards(scopeCards, visibleCards)}
            {addCardEntry}
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
        transactions={filteredTxns}
        hidden={privacy}
        onClose={() => setDetail(null)}
      />
      <MemberAnalysisSheet
        member={memberDetail}
        range={range}
        dimension={dimension}
        transactions={filteredTxns}
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
      <ReportFilterSheet
        visible={filterOpen}
        filters={filters}
        members={membersQ.data ?? []}
        categories={catsQ.data ?? []}
        matchedCount={filteredCount}
        onChange={setFilters}
        onClose={() => setFilterOpen(false)}
      />
      <IncomeTargetSheet
        visible={incomeTargetOpen}
        targets={incomeTargets}
        onSave={saveIncomeTargets}
        onClose={() => setIncomeTargetOpen(false)}
      />
      <SavingsSheet visible={savingsOpen} onClose={() => setSavingsOpen(false)} />
      <BudgetSheet visible={budgetOpen} onClose={() => setBudgetOpen(false)} />
    </View>
  );
}

function ReportFilterBar({
  activeCount,
  matchedCount,
  palette,
  onPress,
}: {
  activeCount: number;
  matchedCount: number;
  palette: ReturnType<typeof usePalette>;
  onPress: () => void;
}) {
  const active = activeCount > 0;
  return (
    <Pressable
      style={[
        styles.filterBar,
        {
          backgroundColor: active ? palette.card : palette.cardPill,
          borderColor: active ? palette.accent : palette.separator,
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`报表筛选，已启用 ${activeCount} 个条件，当前周期命中 ${matchedCount} 笔流水`}
    >
      <View style={styles.filterBarLeft}>
        <View style={[styles.filterIconBadge, { backgroundColor: active ? palette.accent : palette.card }]}>
          <SymbolView
            name="line.3.horizontal.decrease"
            tintColor={active ? palette.onAccent : palette.textSecondary}
            size={15}
          />
        </View>
        <ThemedText style={[styles.filterBarText, { color: active ? palette.accent : palette.textPrimary }]}>
          {active ? `筛选 ${activeCount} 项` : '筛选全部数据'}
        </ThemedText>
      </View>
      <View style={styles.filterBarRight}>
        <ThemedText style={[styles.filterBarMeta, { color: palette.textSecondary }]}>{matchedCount} 笔流水</ThemedText>
        <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
      </View>
    </Pressable>
  );
}

function AddReportCardButton({
  hiddenCount,
  palette,
  onPress,
}: {
  hiddenCount: number;
  palette: ReturnType<typeof usePalette>;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.addCard, { borderColor: palette.separator }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`添加数据卡片，当前有 ${hiddenCount} 张卡片已隐藏`}
    >
      <SymbolView name="plus.circle" tintColor={palette.accent} size={18} />
      <ThemedText style={[styles.addCardText, { color: palette.accent }]}>添加数据卡片</ThemedText>
      <ThemedText style={[styles.addCardCount, { color: palette.textSecondary }]}>{hiddenCount}</ThemedText>
    </Pressable>
  );
}

function ReportFilterSheet({
  visible,
  filters,
  members,
  categories,
  matchedCount,
  onChange,
  onClose,
}: {
  visible: boolean;
  filters: ReportFilters;
  members: { id: string; nickname: string }[];
  categories: Category[];
  matchedCount: number;
  onChange: (filters: ReportFilters) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const incomeCategories = categories.filter((c) => c.type === 'income');
  const setMember = (id: string) => onChange({ ...filters, memberIds: arrayToggle(filters.memberIds, id) });
  const setCategory = (id: string) => onChange({ ...filters, categoryIds: arrayToggle(filters.categoryIds, id) });
  const reset = () => onChange(EMPTY_FILTERS);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView style={styles.flex}>
          <View style={styles.sheetBar}>
            <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>全局筛选</Text>
            <Pressable hitSlop={8} onPress={onClose}>
              <Text style={[styles.sheetAction, { color: palette.textSecondary }]}>应用</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <View style={[styles.filterSummaryCard, { backgroundColor: palette.card }]}>
              <View style={[styles.filterSummaryIcon, { backgroundColor: palette.cardPill }]}>
                <SymbolView name="line.3.horizontal.decrease" tintColor={palette.accent} size={18} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.filterSummaryTitle, { color: palette.textPrimary }]}>统一筛选报表数据</Text>
                <Text style={[styles.filterSummaryText, { color: palette.textSecondary }]}>
                  摘要、趋势、构成、下钻与洞察会使用同一套条件。
                </Text>
              </View>
            </View>
            <FilterSection title="成员" palette={palette}>
              {members.map((member) => (
                <FilterChip
                  key={member.id}
                  label={member.nickname}
                  selected={filters.memberIds.includes(member.id)}
                  palette={palette}
                  onPress={() => setMember(member.id)}
                />
              ))}
            </FilterSection>
            <FilterSection title="支出分类" palette={palette}>
              {expenseCategories.map((category) => (
                <FilterChip
                  key={category.id}
                  label={category.name}
                  selected={filters.categoryIds.includes(category.id)}
                  palette={palette}
                  onPress={() => setCategory(category.id)}
                />
              ))}
            </FilterSection>
            <FilterSection title="收入分类" palette={palette}>
              {incomeCategories.map((category) => (
                <FilterChip
                  key={category.id}
                  label={category.name}
                  selected={filters.categoryIds.includes(category.id)}
                  palette={palette}
                  onPress={() => setCategory(category.id)}
                />
              ))}
            </FilterSection>
            <View style={[styles.pendingFilterCard, { backgroundColor: palette.card }]}>
              <SymbolView name="tray" tintColor={palette.textTertiary} size={20} />
              <View style={styles.flex}>
                <Text style={[styles.pendingFilterTitle, { color: palette.textPrimary }]}>账户 / 标签</Text>
                <Text style={[styles.pendingFilterText, { color: palette.textSecondary }]}>
                  当前流水模型还没有账户与标签字段，后续补模型和记账入口后可接入同一套筛选。
                </Text>
              </View>
            </View>
          </ScrollView>
          <View style={[styles.filterFooter, { backgroundColor: palette.base, borderTopColor: palette.separator }]}>
            <Text style={[styles.filterFooterMeta, { color: palette.textSecondary }]}>
              当前周期命中 {matchedCount} 笔
            </Text>
            <Pressable style={[styles.filterReset, { borderColor: palette.separator }]} onPress={reset}>
              <Text style={[styles.filterResetText, { color: palette.textPrimary }]}>重置</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function FilterSection({
  title,
  palette,
  children,
}: {
  title: string;
  palette: ReturnType<typeof usePalette>;
  children: ReactNode;
}) {
  return (
    <View style={[styles.filterSection, { backgroundColor: palette.card }]}>
      <Text style={[styles.filterSectionTitle, { color: palette.textPrimary }]}>{title}</Text>
      <View style={styles.filterChips}>{children}</View>
    </View>
  );
}

function FilterChip({
  label,
  selected,
  palette,
  onPress,
}: {
  label: string;
  selected: boolean;
  palette: ReturnType<typeof usePalette>;
  onPress: () => void;
}) {
  return (
    <Pressable
      hitSlop={4}
      style={[
        styles.filterChip,
        {
          borderColor: selected ? palette.accent : palette.separator,
          backgroundColor: selected ? palette.accent : 'transparent',
        },
      ]}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
    >
      {selected ? <SymbolView name="checkmark" tintColor={palette.onAccent} size={12} /> : null}
      <Text style={[styles.filterChipText, { color: selected ? palette.onAccent : palette.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function centsToYuanText(value: number): string {
  return value > 0 ? String(Math.round(value / 100)) : '';
}

function yuanTextToCents(text: string): number {
  const n = Number(text.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function IncomeTargetCard({
  income,
  activeIncome,
  passiveIncome,
  target,
  targets,
  dimension,
  projected,
  palette,
  hidden,
  onOpen,
}: {
  income: number;
  activeIncome: number;
  passiveIncome: number;
  target: number;
  targets: IncomeTargets;
  dimension: Dimension;
  projected: number | null;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onOpen: () => void;
}) {
  const progress = target > 0 ? Math.min(1, income / target) : 0;
  const activeTarget = target > 0 ? Math.round(target * (targets.activeRatio / 100)) : 0;
  const passiveTarget = Math.max(0, target - activeTarget);
  const projectedText = projected == null ? '非当前周期不预测' : maskAmount(formatAmount(projected, ''), hidden);
  const targetLabel = dimension === 'year' ? '年度收入目标' : '自定义收入目标';
  const progressPct = Math.round(progress * 100);
  const targetText = maskAmount(formatAmount(target, ''), hidden);

  return (
    <Pressable
      style={[styles.card, styles.incomeTargetCard, { backgroundColor: palette.card }]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${targetLabel}，当前收入 ${formatAmount(income, '')}`}
    >
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          {targetLabel}
        </ThemedText>
        <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={14} />
      </View>
      {target <= 0 ? (
        <View style={[styles.incomeTargetEmpty, { backgroundColor: palette.base }]}>
          <View style={[styles.targetEmptyIcon, { backgroundColor: palette.card }]}>
            <SymbolView name="flag.checkered" tintColor={palette.textTertiary} size={30} />
          </View>
          <View style={styles.flex}>
            <ThemedText style={[styles.targetEmptyTitle, { color: palette.textPrimary }]}>
              还没有设置收入目标
            </ThemedText>
            <ThemedText style={[styles.targetEmptyText, { color: palette.textSecondary }]}>
              设置后可查看完成率、预计收入与主动 / 被动结构。
            </ThemedText>
          </View>
        </View>
      ) : (
        <>
          <View style={styles.incomeTargetHero}>
            <Donut
              size={76}
              strokeWidth={9}
              trackColor={palette.base}
              slices={[
                { value: progress, color: palette.income },
                { value: Math.max(0, 1 - progress), color: palette.base },
              ]}
              accessibilityLabel={`${targetLabel}完成 ${progressPct}%`}
            >
              <ThemedText style={[styles.targetHeroPct, { color: palette.textPrimary }]}>{progressPct}%</ThemedText>
            </Donut>
            <View style={styles.flex}>
              <ThemedText style={[styles.targetHeroAmount, { color: palette.income }]} numberOfLines={1}>
                {maskAmount(formatAmount(income, '+'), hidden)}
              </ThemedText>
              <ThemedText style={[styles.targetHeroMeta, { color: palette.textSecondary }]}>
                目标 {targetText} · 预计 {projectedText}
              </ThemedText>
            </View>
          </View>
          <View style={[styles.incomeStructureTrack, { backgroundColor: palette.base }]}>
            <View
              style={[
                styles.incomeStructureActive,
                { width: `${targets.activeRatio}%`, backgroundColor: palette.income },
              ]}
            />
            <View style={[styles.incomeStructurePassive, { flex: 1, backgroundColor: palette.info }]} />
          </View>
          <View style={styles.incomeTargetGrid}>
            <TargetMetric
              label="主动收入"
              value={activeIncome}
              target={activeTarget}
              color={palette.income}
              hidden={hidden}
            />
            <TargetMetric
              label="被动收入"
              value={passiveIncome}
              target={passiveTarget}
              color={palette.info}
              hidden={hidden}
            />
          </View>
        </>
      )}
    </Pressable>
  );
}

function TargetMetric({
  label,
  value,
  target,
  color,
  hidden,
}: {
  label: string;
  value: number;
  target: number;
  color: string;
  hidden: boolean;
}) {
  const pct = target > 0 ? Math.round((value / target) * 100) : 0;
  return (
    <View style={styles.targetMetric}>
      <ThemedText style={[styles.targetMetricLabel, { color }]}>{label}</ThemedText>
      <ThemedText style={styles.targetMetricValue} numberOfLines={1} adjustsFontSizeToFit>
        {maskAmount(formatAmount(value, ''), hidden)}
      </ThemedText>
      <ThemedText style={styles.targetMetricMeta}>{target > 0 ? `${pct}% / 目标` : '未拆分目标'}</ThemedText>
    </View>
  );
}

function IncomeTargetSheet({
  visible,
  targets,
  onSave,
  onClose,
}: {
  visible: boolean;
  targets: IncomeTargets;
  onSave: (targets: IncomeTargets) => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const [annual, setAnnual] = useState(() => centsToYuanText(targets.annual));
  const [custom, setCustom] = useState(() => centsToYuanText(targets.custom));
  const [activeRatio, setActiveRatio] = useState(() => String(targets.activeRatio));

  const save = () => {
    const ratio = Math.max(0, Math.min(100, Math.round(Number(activeRatio) || DEFAULT_INCOME_TARGETS.activeRatio)));
    onSave({ annual: yuanTextToCents(annual), custom: yuanTextToCents(custom), activeRatio: ratio });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView style={styles.flex}>
          <View style={styles.sheetBar}>
            <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>收入目标</Text>
            <Pressable hitSlop={8} onPress={save}>
              <Text style={[styles.sheetAction, { color: palette.accent }]}>保存</Text>
            </Pressable>
          </View>
          <View style={styles.customRangeContent}>
            <TargetInputCard label="年度目标" value={annual} onChangeText={setAnnual} palette={palette} />
            <TargetInputCard label="自定义周期目标" value={custom} onChangeText={setCustom} palette={palette} />
            <TargetInputCard
              label="主动收入占比（%）"
              value={activeRatio}
              onChangeText={setActiveRatio}
              palette={palette}
            />
            <Text style={[styles.customHint, { color: palette.textSecondary }]}>
              被动收入暂按分类名中的利息、理财、投资、分红、租金识别；未来可接入独立收入类型。
            </Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function TargetInputCard({
  label,
  value,
  onChangeText,
  palette,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  palette: ReturnType<typeof usePalette>;
}) {
  return (
    <View style={[styles.targetInputCard, { backgroundColor: palette.card }]}>
      <Text style={[styles.customDateLabel, { color: palette.textSecondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        placeholder="0"
        placeholderTextColor={palette.textTertiary}
        style={[styles.targetInput, { color: palette.textPrimary }]}
      />
    </View>
  );
}

function FinancialInsightsCard({
  income,
  expense,
  expenseTotal,
  projectedExpense,
  projectedIncome,
  budgetTotal,
  topCategory,
  topExpense,
  goals,
  incomeTarget,
  palette,
  hidden,
}: {
  income: number;
  expense: number;
  expenseTotal: number;
  projectedExpense: number | null;
  projectedIncome: number | null;
  budgetTotal: number | null;
  topCategory: CatSlice | null;
  topExpense: TopItem | null;
  goals: SavingsGoal[];
  incomeTarget: number;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const [nowMs] = useState(() => Date.now());
  const insights: FinancialInsight[] = [];
  if (budgetTotal && budgetTotal > 0 && projectedExpense != null && projectedExpense > budgetTotal) {
    insights.push({
      title: '预算风险',
      body: `按当前节奏，月末支出预计到 ${maskAmount(formatAmount(projectedExpense, ''), hidden)}。`,
      action: topCategory ? `先看 ${topCategory.name}，它是当前主要压力项。` : '先检查最近几笔大额支出。',
      tone: 'warn',
    });
  }
  if (topExpense && expenseTotal > 0 && topExpense.amount / expenseTotal >= 0.25) {
    insights.push({
      title: '异常支出',
      body: `${topExpense.category} 单笔占本期普通支出 ${Math.round((topExpense.amount / expenseTotal) * 100)}%。`,
      action: '建议点开大额支出明细，确认是否为一次性消费。',
      tone: 'danger',
    });
  }
  if (projectedIncome != null && incomeTarget > 0) {
    const gap = projectedIncome - incomeTarget;
    insights.push({
      title: '收入目标预测',
      body:
        gap >= 0
          ? `按当前节奏，预计超过目标 ${maskAmount(formatAmount(gap, ''), hidden)}。`
          : `按当前节奏，距目标还差 ${maskAmount(formatAmount(Math.abs(gap), ''), hidden)}。`,
      action: gap >= 0 ? '可以把超出部分转入存钱目标。' : '优先补齐稳定收入或调低本期目标。',
      tone: gap >= 0 ? 'ok' : 'warn',
    });
  }
  const urgentGoal = goals
    .filter((g) => g.deadline && g.target_amount > g.saved_amount)
    .map((g) => ({
      goal: g,
      days: Math.ceil((new Date(g.deadline as string).getTime() - nowMs) / 86400000),
    }))
    .filter((x) => x.days >= 0)
    .sort((a, b) => a.days - b.days)[0];
  if (urgentGoal) {
    const gap = urgentGoal.goal.target_amount - urgentGoal.goal.saved_amount;
    insights.push({
      title: '目标进度预测',
      body: `${urgentGoal.goal.name} 距截止还有 ${urgentGoal.days} 天，差 ${maskAmount(formatAmount(gap, ''), hidden)}。`,
      action: '建议拆成本周可执行的小额转入。',
      tone: urgentGoal.days <= 30 ? 'warn' : 'ok',
    });
  }
  if (insights.length === 0) {
    insights.push({
      title: '本期状态平稳',
      body: `收入 ${maskAmount(formatAmount(income, '+'), hidden)}，支出 ${maskAmount(formatAmount(expense, '-'), hidden)}。`,
      action: '继续保持记录，数据越完整预测越准。',
      tone: 'ok',
    });
  }
  const lead = insights[0];
  const rest = insights.slice(1, 3);
  const leadColor = insightToneColor(lead.tone, palette);

  return (
    <View style={[styles.card, styles.insightsCard, { backgroundColor: palette.card }]}>
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>财务洞察</ThemedText>
        <ThemedText style={[styles.chartMeta, { color: palette.textSecondary }]}>{insights.length} 条</ThemedText>
      </View>
      <View style={[styles.insightLead, { backgroundColor: palette.base }]}>
        <View style={[styles.insightLeadIcon, { backgroundColor: leadColor }]}>
          <SymbolView name={insightToneIcon(lead.tone)} tintColor={palette.onAccent} size={18} />
        </View>
        <View style={styles.flex}>
          <ThemedText style={[styles.insightLeadTitle, { color: palette.textPrimary }]}>{lead.title}</ThemedText>
          <ThemedText style={[styles.insightLeadBody, { color: palette.textSecondary }]}>{lead.body}</ThemedText>
          <View style={[styles.insightActionPill, { borderColor: leadColor }]}>
            <ThemedText style={[styles.insightActionText, { color: leadColor }]}>{lead.action}</ThemedText>
          </View>
        </View>
      </View>
      {rest.length > 0 ? (
        <View style={styles.insightMinorList}>
          {rest.map((item) => {
            const color = insightToneColor(item.tone, palette);
            return (
              <View key={item.title} style={styles.insightMinorRow}>
                <View style={[styles.insightDot, { backgroundColor: color }]} />
                <ThemedText style={[styles.insightMinorTitle, { color: palette.textPrimary }]} numberOfLines={1}>
                  {item.title}
                </ThemedText>
                <ThemedText style={[styles.insightMinorBody, { color: palette.textSecondary }]} numberOfLines={1}>
                  {item.body}
                </ThemedText>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function insightToneColor(tone: FinancialInsight['tone'], palette: ReturnType<typeof usePalette>): string {
  if (tone === 'danger') return palette.danger;
  if (tone === 'warn') return palette.warning;
  return palette.info;
}

function insightToneIcon(tone: FinancialInsight['tone']): string {
  if (tone === 'danger' || tone === 'warn') return 'exclamationmark.triangle.fill';
  return 'checkmark.circle.fill';
}

function MoreStatsCard({
  transactions,
  range,
  palette,
  hidden,
}: {
  transactions: Transaction[];
  range: { start: Date; end: Date };
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const stats = useMemo(() => {
    const rows = transactions.filter(
      (t) => t.type === 'expense' && t.source === 'normal' && inRange(t.occurred_at, range.start, range.end),
    );
    const weekday = new Array<number>(7).fill(0);
    const byDate = new Map<string, number>();
    let weekend = 0;
    let workday = 0;
    let total = 0;
    for (const t of rows) {
      const d = new Date(t.occurred_at);
      const day = d.getDay();
      weekday[day] += t.amount;
      const key = localDateKey(d);
      byDate.set(key, (byDate.get(key) ?? 0) + t.amount);
      total += t.amount;
      if (day === 0 || day === 6) weekend += t.amount;
      else workday += t.amount;
    }
    const days = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000));
    const visibleDays = Math.min(42, days);
    const heatDays = Array.from({ length: visibleDays }, (_, index) => {
      const date = addDays(range.start, index);
      const key = localDateKey(date);
      return { key, amount: byDate.get(key) ?? 0 };
    });
    return {
      rows,
      weekday,
      byDate,
      heatDays,
      weekend,
      workday,
      total,
      dailyAvg: Math.round(total / Math.max(1, byDate.size)),
      completeness: Math.round((byDate.size / days) * 100),
    };
  }, [transactions, range]);
  const max = Math.max(1, ...stats.weekday);
  const heatMax = Math.max(1, ...stats.heatDays.map((item) => item.amount));
  const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];
  const topWeekdayIndex = stats.weekday.reduce(
    (maxIndex, amount, index) => (amount > stats.weekday[maxIndex] ? index : maxIndex),
    0,
  );
  const heatRows = Array.from({ length: Math.ceil(stats.heatDays.length / 7) }, (_, rowIndex) =>
    Array.from({ length: 7 }, (_, colIndex) => stats.heatDays[rowIndex * 7 + colIndex] ?? null),
  );

  return (
    <View style={[styles.card, styles.moreStatsCard, { backgroundColor: palette.card }]}>
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>更多统计</ThemedText>
        <ThemedText style={[styles.chartMeta, { color: palette.textSecondary }]}>
          完整度 {stats.completeness}%
        </ThemedText>
      </View>
      <View style={styles.statsMetricRow}>
        <StatsMetric label="记录天数" value={`${stats.byDate.size} 天`} palette={palette} />
        <StatsMetric label="日均支出" value={maskAmount(formatAmount(stats.dailyAvg, ''), hidden)} palette={palette} />
        <StatsMetric label="高峰星期" value={weekdayLabels[topWeekdayIndex]} palette={palette} />
      </View>
      <View style={[styles.heatPanel, { backgroundColor: palette.base }]}>
        <View style={styles.heatPanelHeader}>
          <Text style={[styles.heatTitle, { color: palette.textPrimary }]}>消费热力</Text>
          <View style={styles.heatLegend}>
            <Text style={[styles.heatLegendText, { color: palette.textSecondary }]}>少</Text>
            {[0.25, 0.5, 0.75, 1].map((opacity) => (
              <View key={opacity} style={[styles.heatLegendCell, { backgroundColor: palette.expense, opacity }]} />
            ))}
            <Text style={[styles.heatLegendText, { color: palette.textSecondary }]}>多</Text>
          </View>
        </View>
        <View accessibilityLabel="消费热力图，颜色越深代表当日支出越高" style={styles.heatRows}>
          {heatRows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.heatWeekRow}>
              {row.map((item) => (
                <View
                  key={item?.key ?? `empty-${rowIndex}-${row.indexOf(item)}`}
                  style={[
                    styles.heatCell,
                    {
                      backgroundColor: item && item.amount > 0 ? palette.expense : palette.card,
                      opacity: item == null ? 0 : item.amount > 0 ? 0.25 + (item.amount / heatMax) * 0.75 : 1,
                    },
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </View>
      <View style={styles.weekdayRows}>
        {weekdayLabels.map((label, index) => (
          <View key={label} style={styles.weekdayRow}>
            <Text style={[styles.weekdayLabel, { color: palette.textSecondary }]}>{label}</Text>
            <View style={[styles.weekdayTrack, { backgroundColor: palette.base }]}>
              <View
                style={[
                  styles.weekdayFill,
                  { width: `${(stats.weekday[index] / max) * 100}%`, backgroundColor: palette.expense },
                ]}
              />
            </View>
            <Text style={[styles.weekdayAmount, { color: palette.textPrimary }]}>
              {maskAmount(formatAmount(stats.weekday[index], ''), hidden)}
            </Text>
          </View>
        ))}
      </View>
      <Text style={[styles.moreStatsMeta, { color: palette.textSecondary }]}>
        工作日 {maskAmount(formatAmount(stats.workday, ''), hidden)} · 周末{' '}
        {maskAmount(formatAmount(stats.weekend, ''), hidden)} · 普通支出 {stats.rows.length} 笔
      </Text>
    </View>
  );
}

function StatsMetric({
  label,
  value,
  palette,
}: {
  label: string;
  value: string;
  palette: ReturnType<typeof usePalette>;
}) {
  return (
    <View style={[styles.statsMetric, { backgroundColor: palette.base }]}>
      <Text style={[styles.statsMetricLabel, { color: palette.textSecondary }]}>{label}</Text>
      <Text style={[styles.statsMetricValue, { color: palette.textPrimary }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
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
  const [selected, setSelected] = useState<{ label: string; income: number } | null>(null);
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
                <Rect
                  key={item.label}
                  x={x}
                  y={chartBottom - h}
                  width={barW}
                  height={h}
                  rx={4}
                  fill={selected?.label === item.label ? palette.accent : palette.income}
                  onPress={() => setSelected({ label: item.label, income: item.income })}
                  accessibilityLabel={`${item.label}收入 ${formatAmount(item.income, '')}`}
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
          <ThemedText style={[styles.chartSelection, { color: palette.textSecondary }]}>
            {selected
              ? `${selected.label}收入 ${maskAmount(formatAmount(selected.income, '+'), hidden)}`
              : `图表摘要：近 ${series.length} 期平均收入 ${maskAmount(formatAmount(avg, ''), hidden)}`}
          </ThemedText>
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
  const [selected, setSelected] = useState<{ label: string; rate: number } | null>(null);
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
                <Circle
                  key={item.label}
                  cx={xOf(index)}
                  cy={yOf(item.rate)}
                  r={selected?.label === item.label ? 5 : 3}
                  fill={selected?.label === item.label ? palette.accent : palette.info}
                  onPress={() => setSelected({ label: item.label, rate: item.rate ?? 0 })}
                  accessibilityLabel={`${item.label}储蓄率 ${Math.round((item.rate ?? 0) * 100)}%`}
                />
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
          <ThemedText style={[styles.chartSelection, { color: palette.textSecondary }]}>
            {selected
              ? `${selected.label}储蓄率 ${Math.round(selected.rate * 100)}%`
              : `图表摘要：最新储蓄率 ${latest == null ? '暂无' : `${Math.round(latest * 100)}%`}`}
          </ThemedText>
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
  const [selected, setSelected] = useState<CatSlice | null>(null);
  const selectedPercent = selected && total > 0 ? Math.round((selected.amount / total) * 100) : 0;
  return (
    <View
      style={[styles.card, { backgroundColor: palette.card }]}
      accessible
      accessibilityLabel={`支出构成，合计 ${formatAmount(total, '')}，共 ${categories.length} 个分类`}
    >
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
            accessibilityLabel={`支出构成环形图，最大分类 ${categories[0]?.name ?? '暂无'}`}
            onSlicePress={(index) => setSelected(categories[index] ?? null)}
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
      {selected ? (
        <ThemedText style={[styles.chartSelection, { color: palette.textSecondary }]}>
          {selected.name} {selectedPercent}% · {maskAmount(formatAmount(selected.amount, '-'), hidden)}
        </ThemedText>
      ) : null}
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
  const [selected, setSelected] = useState<{ label: string; expense: number } | null>(null);
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
              fill={selected?.label === item.label ? palette.accent : palette.expense}
              onPress={() => setSelected({ label: item.label, expense: item.expense })}
              accessibilityLabel={`${item.label}支出 ${formatAmount(item.expense, '')}`}
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
      <Text style={[styles.chartSelection, { color: palette.textSecondary }]}>
        {selected ? `${selected.label}支出 ${formatAmount(selected.expense, '-')}` : '点按柱形可查看精确金额'}
      </Text>
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
  filterBar: {
    minHeight: 46,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space[3],
  },
  filterBarLeft: { flexDirection: 'row', alignItems: 'center', gap: Space[2], flex: 1, minWidth: 0 },
  filterBarRight: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  filterBarText: { fontSize: 15, fontWeight: '600' },
  filterBarMeta: { fontSize: 13, fontVariant: ['tabular-nums'] },
  filterIconBadge: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterSummaryCard: { borderRadius: Radius.lg, padding: Space[4], flexDirection: 'row', gap: Space[3] },
  filterSummaryIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterSummaryTitle: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  filterSummaryText: { fontSize: 13, lineHeight: 18 },
  filterSection: { borderRadius: Radius.lg, padding: Space[4], gap: Space[3] },
  filterSectionTitle: { fontSize: 16, fontWeight: '700' },
  filterChips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space[2] },
  filterChip: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[1],
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space[3],
    paddingVertical: Space[2],
  },
  filterChipText: { fontSize: 14, fontWeight: '600' },
  pendingFilterCard: { borderRadius: Radius.lg, padding: Space[4], flexDirection: 'row', gap: Space[3] },
  pendingFilterTitle: { fontSize: 16, fontWeight: '700', marginBottom: Space[1] },
  pendingFilterText: { fontSize: 13, lineHeight: 18 },
  filterFooter: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space[4],
    paddingTop: Space[3],
    paddingBottom: Space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space[3],
  },
  filterFooterMeta: { fontSize: 14, fontVariant: ['tabular-nums'] },
  filterReset: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Space[4],
    paddingVertical: Space[2],
  },
  filterResetText: { fontSize: 15, fontWeight: '600' },
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
  addCardCount: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  chartSelection: { marginTop: Space[2], fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  incomeTargetCard: { gap: Space[3] },
  incomeTargetHero: { flexDirection: 'row', alignItems: 'center', gap: Space[4] },
  targetHeroPct: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  targetHeroAmount: { fontSize: 28, lineHeight: 34, fontWeight: '700', fontVariant: ['tabular-nums'] },
  targetHeroMeta: { fontSize: 13, lineHeight: 18, fontVariant: ['tabular-nums'] },
  incomeTargetEmpty: { minHeight: 96, borderRadius: Radius.md, padding: Space[3], flexDirection: 'row', gap: Space[3] },
  targetEmptyIcon: {
    width: 54,
    height: 54,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetEmptyTitle: { fontSize: 16, fontWeight: '700', marginBottom: 2 },
  targetEmptyText: { fontSize: 13, lineHeight: 18 },
  incomeStructureTrack: {
    height: 10,
    borderRadius: Radius.full,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  incomeStructureActive: { height: '100%', borderTopLeftRadius: Radius.full, borderBottomLeftRadius: Radius.full },
  incomeStructurePassive: { height: '100%', borderTopRightRadius: Radius.full, borderBottomRightRadius: Radius.full },
  incomeTargetGrid: { flexDirection: 'row', gap: Space[3] },
  targetMetric: { flex: 1, minWidth: 0, gap: Space[1] },
  targetMetricLabel: { fontSize: 13, fontWeight: '700' },
  targetMetricValue: { fontSize: 18, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  targetMetricMeta: { fontSize: 12, opacity: 0.7 },
  targetInputCard: { borderRadius: Radius.lg, padding: Space[4], gap: Space[2] },
  targetInput: { fontSize: 28, lineHeight: 34, fontWeight: '700', fontVariant: ['tabular-nums'], padding: 0 },
  insightsCard: { gap: Space[3] },
  insightLead: { flexDirection: 'row', gap: Space[3], borderRadius: Radius.lg, padding: Space[3] },
  insightLeadIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightLeadTitle: { fontSize: 16, fontWeight: '700', marginBottom: 3 },
  insightLeadBody: { fontSize: 13, lineHeight: 18 },
  insightActionPill: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.full,
    paddingHorizontal: Space[3],
    paddingVertical: Space[1],
    marginTop: Space[2],
  },
  insightActionText: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  insightMinorList: { gap: Space[2] },
  insightMinorRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  insightDot: { width: 8, height: 8, borderRadius: Radius.full, marginTop: 6 },
  insightMinorTitle: { width: 82, fontSize: 13, fontWeight: '700' },
  insightMinorBody: { flex: 1, fontSize: 13 },
  moreStatsCard: { gap: Space[3] },
  statsMetricRow: { flexDirection: 'row', gap: Space[2] },
  statsMetric: {
    flex: 1,
    minWidth: 0,
    borderRadius: Radius.md,
    paddingHorizontal: Space[3],
    paddingVertical: Space[2],
  },
  statsMetricLabel: { fontSize: 11, marginBottom: 2 },
  statsMetricValue: { fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  heatPanel: { borderRadius: Radius.md, padding: Space[3], gap: Space[2] },
  heatPanelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space[2] },
  heatTitle: { fontSize: 13, fontWeight: '700' },
  heatLegend: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heatLegendText: { fontSize: 11 },
  heatLegendCell: { width: 8, height: 8, borderRadius: 2 },
  heatRows: { gap: 4 },
  heatWeekRow: { flexDirection: 'row', gap: 4 },
  heatCell: { flex: 1, height: 12, borderRadius: 3 },
  weekdayRows: { gap: Space[2] },
  weekdayRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  weekdayLabel: { width: 18, fontSize: 12, textAlign: 'center' },
  weekdayTrack: { flex: 1, height: 9, borderRadius: Radius.full, overflow: 'hidden' },
  weekdayFill: { height: '100%', borderRadius: Radius.full },
  weekdayAmount: { width: 82, textAlign: 'right', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  moreStatsMeta: { fontSize: 13, lineHeight: 18 },
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
