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
import { useRouter, type Href } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import {
  DEFAULT_ACCOUNTING_PREFS,
  useAccountingPrefs,
  useBudget,
  useCategoryDetail,
  useCategories,
  useFamilyMembers,
  useMyFamily,
  useMyProfile,
  useReportAnalytics,
  useSavingsGoals,
  EMPTY_REPORT_ANALYTICS,
  type ReportAnalytics,
  type Category,
  type ReportAnalyticsInput,
  type SavingsGoal,
} from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, TabBarInset, useCategoryColors, usePalette, useSheetPalette } from '@/constants/design';
import { BudgetSheet } from '@/features/budget/budget-sheet';
import {
  CategoryMomCard,
  IncomeExpenseCard,
  IncomeStructureCard,
  TopExpensesCard,
  type TopItem,
} from '@/features/report/advanced';
import { Donut } from '@/features/report/donut';
import { SavingsSheet } from '@/features/savings/savings-sheet';
import { HeaderSearchButton } from '@/features/search/search-provider';
import { useCollapsibleHeader } from '@/features/shared/use-collapsible-header';
import { displayCategoryName, i18n, INTL_LOCALE, t, useLocalePreference } from '@/i18n';
import { fromI18nLanguage } from '@/i18n/locale';
import { daysToMonthEnd } from '@/lib/budget';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import {
  calendarDateInTimeZone,
  currentPeriod,
  formatAmount,
  formatMonthDay,
  maskAmount,
  signForNet,
} from '@/lib/format';
import {
  balanceRate,
  equalPeriodIncomeExpenseSeries,
  incomeExpenseSeries,
  inRange,
  periodRange,
  shiftAnchor,
  type Dimension,
} from '@/lib/report';
import { resolveCardLayout, type ReportCardId } from '@/lib/report-cards';

type CatSlice = { id: string; name: string; amount: number; color: string; symbol: string };
/** 分类下钻：单类用 id；「其它」聚合用 categoryIds。 */
type CategoryDetail = { id: string; name: string; categoryIds?: string[] };
type DisplayCatSlice = CatSlice & { categoryIds?: string[] };
type Member = { id: string; name: string; amount: number; count: number };
type ReportDay = {
  date: string;
  incomeAmount: number;
  expenseAmount: number;
  incomeNormalAmount: number;
  expenseNormalAmount: number;
};
const EXPENSE_CATEGORY_TOP_COUNT = 5;
const EXPENSE_CATEGORY_OTHER_ID = '__other__';
type ReportScope = 'expense' | 'income' | 'balance';
type ReportFilters = { memberIds: string[]; categoryIds: string[] };
type IncomeTargets = { annual: number; custom: number; activeRatio: number };
type FinancialInsight = { title: string; body: string; action: string; tone: 'ok' | 'warn' | 'danger' };
type HeatmapScope = ReportScope;

const HEATMAP_COLUMN_GAP = 1;
const HEATMAP_ROW_GAP = 2;
const HEATMAP_MIN_CELL_SIZE = 3;
const HEATMAP_FALLBACK_CELL_SIZE = 5;

const REPORT_SCOPES: { key: ReportScope; labelKey: string }[] = [
  { key: 'expense', labelKey: 'record.expense' },
  { key: 'income', labelKey: 'record.income' },
  { key: 'balance', labelKey: 'report.balance' },
];

const DIMENSIONS: { key: Dimension; labelKey: string }[] = [
  { key: 'week', labelKey: 'dates.dimWeek' },
  { key: 'month', labelKey: 'dates.dimMonth' },
  { key: 'year', labelKey: 'dates.dimYear' },
  { key: 'custom', labelKey: 'dates.dimCustom' },
];

const WEEKDAY_KEYS = [
  'dates.weekdaySun',
  'dates.weekdayMon',
  'dates.weekdayTue',
  'dates.weekdayWed',
  'dates.weekdayThu',
  'dates.weekdayFri',
  'dates.weekdaySat',
] as const;

function intlLocale(): string {
  return INTL_LOCALE[fromI18nLanguage(i18n.language)];
}

function periodName(dimension: Dimension): string {
  return dimension === 'week'
    ? t('dates.thisWeek')
    : dimension === 'year'
      ? t('report.wholeYear')
      : dimension === 'month'
        ? t('dates.thisMonth')
        : t('report.thisPeriod');
}

const EMPTY_FILTERS: ReportFilters = { memberIds: [], categoryIds: [] };
const DEFAULT_INCOME_TARGETS: IncomeTargets = { annual: 0, custom: 0, activeRatio: 70 };
const INCOME_TARGETS_KEY = 'homebook:report-income-targets:v1';

function arrayToggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
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

/**
 * 首次进入报表时按 PRD 的视角推荐顺序呈现；用户在「报表卡片」页手动排序后，
 * 则完整尊重个人顺序。这样不会把同一数据在顶部重复解释，也保留自定义能力。
 */
const DEFAULT_SCOPE_CARD_ORDER: Record<ReportScope, ReportCardId[]> = {
  expense: [
    'overview',
    'budget',
    'expense_trend',
    'expense_category',
    'category_mom',
    'member',
    'savings_goals',
    'more_stats',
    'insights',
    'top_expenses',
  ],
  income: ['overview', 'income_trend', 'income_structure', 'income_target', 'more_stats', 'insights'],
  balance: [
    'overview',
    'income_expense',
    'balance_waterfall',
    'savings_rate',
    'savings_goals',
    'more_stats',
    'insights',
  ],
};

function recommendedCardOrder(scope: ReportScope, visible: ReportCardId[], hasCustomOrder: boolean): ReportCardId[] {
  const source = hasCustomOrder ? visible : DEFAULT_SCOPE_CARD_ORDER[scope];
  const scoped = source.filter((id) => visible.includes(id));
  const withMissing = [...scoped, ...visible.filter((id) => !scoped.includes(id))];
  const overview = withMissing.includes('overview') ? ['overview' as const] : [];
  const middle = withMissing.filter((id) => id !== 'overview' && id !== 'insights');
  const insights = withMissing.includes('insights') ? ['insights' as const] : [];
  return [...overview, ...middle, ...insights];
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
  return date.toLocaleDateString(intlLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
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
  const { locale } = useLocalePreference();
  const catColors = useCategoryColors();
  const insets = useSafeAreaInsets();
  // estimate 必须等于实测头高（paddingTop 8 + 标题 41 + paddingBottom 12），否则裁切框（overflow:hidden）
  // 偏小会在首帧切掉标题底部。
  const { scrollRef, headerHeight, headerStyle, onHeaderLayout } = useCollapsibleHeader(insets.top + 61);
  const catsQ = useCategories();
  const membersQ = useFamilyMembers();
  const familyQ = useMyFamily();
  const profileQ = useMyProfile();
  const prefsQ = useAccountingPrefs();
  const savingsQ = useSavingsGoals();

  // 卡片显隐 / 排序 + 金额隐私（记账设置，个人级偏好）；行不存在回落默认。
  const prefs = prefsQ.data ?? DEFAULT_ACCOUNTING_PREFS;
  const privacy = prefs.amount_privacy;
  const cardLayout = resolveCardLayout(prefs.report_card_order, prefs.report_card_hidden);

  const [dimension, setDimension] = useState<Dimension>('month');
  const [scope, setScope] = useState<ReportScope>('expense');
  const todayInFamilyTimeZone = useMemo(() => calendarDateInTimeZone(familyQ.data?.timezone), [familyQ.data?.timezone]);
  const [anchorOverride, setAnchor] = useState<Date | null>(null);
  const anchor = anchorOverride ?? todayInFamilyTimeZone;
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [incomeTargets, setIncomeTargets] = useState<IncomeTargets>(DEFAULT_INCOME_TARGETS);
  const [incomeTargetOpen, setIncomeTargetOpen] = useState(false);
  const [customStart, setCustomStart] = useState(() => {
    const d = startOfLocalDay(todayInFamilyTimeZone);
    d.setDate(d.getDate() - 29);
    return d;
  });
  const [customEnd, setCustomEnd] = useState(() => startOfLocalDay(todayInFamilyTimeZone));
  const [customOpen, setCustomOpen] = useState(false);
  const [detail, setDetail] = useState<CategoryDetail | null>(null);
  const [memberAnalysisOpen, setMemberAnalysisOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [moreStatsOpen, setMoreStatsOpen] = useState(false);
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
  const statsYearRange = useMemo(() => periodRange('year', range.start), [range.start]);
  const isCurrent = useMemo(() => {
    if (dimension !== 'custom') {
      return (
        periodRange(dimension, anchor).start.getTime() === periodRange(dimension, todayInFamilyTimeZone).start.getTime()
      );
    }
    const today = startOfLocalDay(todayInFamilyTimeZone);
    return range.start.getTime() <= today.getTime() && range.end.getTime() > today.getTime();
  }, [dimension, anchor, range, todayInFamilyTimeZone]);
  const budgetPeriod = useMemo(() => currentPeriod(range.start), [range.start]);
  const budgetQ = useBudget(budgetPeriod);

  // 服务端聚合窗：覆盖「锚点期往前 6 期」及本年统计；只返回有限分组与按日分桶。
  const analyticsInput = useMemo(() => {
    const HISTORY_PERIODS = 6;
    let from: Date;
    if (dimension === 'custom') {
      const length = Math.max(86400000, range.end.getTime() - range.start.getTime());
      from = new Date(range.start.getTime() - (HISTORY_PERIODS - 1) * length);
    } else {
      from = periodRange(dimension, shiftAnchor(dimension, anchor, -(HISTORY_PERIODS - 1))).start;
    }
    const statsFrom = statsYearRange.start;
    const historyStart = new Date(Math.min(from.getTime(), statsFrom.getTime()));
    return {
      start: localDateKey(range.start),
      end: localDateKey(range.end),
      previousStart: localDateKey(prevRange.start),
      historyStart: localDateKey(historyStart),
      memberIds: filters.memberIds,
      categoryIds: filters.categoryIds,
    };
  }, [dimension, anchor, range, prevRange, statsYearRange, filters]);
  const reportQ = useReportAnalytics(analyticsInput);
  const reportData = reportQ.data;
  const filteredCount = reportData?.summary.transactionCount ?? 0;
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
    void locale;
    const analytics = reportData;
    const cats = catsQ.data ?? [];
    const mem = membersQ.data ?? [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const myId = profileQ.data?.id;
    const uncategorized = t('common.uncategorized');
    const otherIncome = t('categories.otherIncome');
    const memberFallback = t('common.member');
    const memberNameById = new Map(mem.map((member) => [member.id, member.nickname]));
    if (myId) memberNameById.set(myId, t('common.me'));

    // 分类展示信息（识别色 + 图标）按分类预先计算；流水循环只查 Map。
    const categoryDisplayById = new Map(
      cats.map((category) => [
        category.id,
        {
          name: displayCategoryName(category.name, category.is_system),
          color:
            catColors[
              categoryColorKey(category.name, category.type === 'income' ? 'income' : 'expense', category.color_key)
            ],
          symbol: categorySymbol(category.icon, category.type === 'income' ? 'income' : 'expense'),
        },
      ]),
    );
    const catDisplay = (id: string, type: 'income' | 'expense') => {
      return (
        categoryDisplayById.get(id) ?? {
          name: type === 'income' ? otherIncome : uncategorized,
          color: catColors[categoryColorKey(type === 'income' ? '其他收入' : '未分类', type)],
          symbol: categorySymbol(null, type),
        }
      );
    };

    const list = (analytics?.expenseCategories ?? []).map(({ categoryId, currentAmount }) => ({
      id: categoryId,
      ...catDisplay(categoryId, 'expense'),
      amount: currentAmount,
    }));
    const mom = (analytics?.expenseCategories ?? [])
      .map(({ categoryId, currentAmount, previousAmount }) => ({
        id: categoryId,
        ...catDisplay(categoryId, 'expense'),
        cur: currentAmount,
        prev: previousAmount,
      }))
      .sort((a, b) => b.cur - a.cur || b.prev - a.prev);
    const dailyFlows = (analytics?.days ?? []).flatMap((day) => [
      { occurred_at: `${day.date}T12:00:00.000Z`, type: 'income' as const, amount: day.incomeAmount },
      { occurred_at: `${day.date}T12:00:00.000Z`, type: 'expense' as const, amount: day.expenseAmount },
    ]);
    const incomeSlices = (analytics?.incomeCategories ?? []).map(({ categoryId, amount }) => ({
      id: categoryId,
      ...catDisplay(categoryId, 'income'),
      amount,
    }));
    const topItems = (analytics?.topExpenses ?? []).map((item) => ({
      id: item.id,
      note: item.note ?? '',
      category: catDisplay(item.categoryId, 'expense').name,
      color: catDisplay(item.categoryId, 'expense').color,
      symbol: catDisplay(item.categoryId, 'expense').symbol,
      amount: item.amount,
      date: formatMonthDay(item.occurredAt),
    }));
    const memberRows = (analytics?.members ?? []).map((item) => ({
      id: item.userId,
      name: memberNameById.get(item.userId) ?? memberFallback,
      amount: item.expenseNormalAmount,
      count: item.count,
    }));
    const inc = analytics?.summary.incomeAmount ?? 0;
    const exp = analytics?.summary.expenseAmount ?? 0;
    const passiveInc = incomeSlices.reduce(
      (total, item) => total + (isPassiveIncomeName(catById.get(item.id)?.name ?? '') ? item.amount : 0),
      0,
    );

    return {
      income: inc,
      expense: exp,
      balance: inc - exp,
      byCat: list,
      expenseTotal: analytics?.summary.expenseNormalAmount ?? 0,
      members: memberRows,
      balRate: balanceRate(inc, inc - exp),
      // 近 6 期收支（对账口径，含储蓄类）：区间跨度超出本期/上期，传全量流水单独分桶。
      incomeExpense:
        dimension === 'custom'
          ? equalPeriodIncomeExpenseSeries(range, dailyFlows)
          : incomeExpenseSeries(dimension, range.start, dailyFlows),
      momItems: mom,
      topItems,
      incomeSlices,
      passiveIncome: passiveInc,
    };
  }, [reportData, catsQ.data, membersQ.data, profileQ.data, range, dimension, catColors, locale]);

  const loading = reportQ.isLoading || catsQ.isLoading;
  const memberCountMax = Math.max(1, ...members.map((m) => m.count));
  const isMonthlyView = dimension === 'month';
  const currentMonthRange = useMemo(() => periodRange('month', todayInFamilyTimeZone), [todayInFamilyTimeZone]);
  const selectedMonthIsCurrent = dimension === 'month' && range.start.getTime() === currentMonthRange.start.getTime();
  const monthElapsedDays = selectedMonthIsCurrent
    ? Math.max(1, Math.floor((startOfLocalDay(todayInFamilyTimeZone).getTime() - range.start.getTime()) / 86400000) + 1)
    : null;
  const monthTotalDays =
    dimension === 'month' ? Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86400000)) : 0;
  const projectedExpense =
    selectedMonthIsCurrent && monthElapsedDays ? Math.round((expenseTotal / monthElapsedDays) * monthTotalDays) : null;
  const projectedIncome = projectionForRange(income, range, isCurrent);
  const incomeTarget = targetForDimension(incomeTargets, dimension);
  const activeIncome = Math.max(0, income - passiveIncome);
  const periodText = periodName(dimension);
  const customToolbarEnd = dimension === 'custom' ? addDays(range.end, -1) : range.start;
  const visibleCards = cardLayout.visible;
  const hiddenCards = cardLayout.hidden;
  const cardOrder = recommendedCardOrder(scope, visibleCards, prefs.report_card_order.length > 0);
  const openCardSettings = () => router.push('/settings/report-cards' as Href);
  const shiftPeriod = (delta: number) => {
    if (dimension !== 'custom') {
      setAnchor((a) => shiftAnchor(dimension, a ?? todayInFamilyTimeZone, delta));
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
      onPress={() => setInsightsOpen(true)}
    />
  );
  const commonStatsCard = (
    <MoreStatsEntryCard
      scope={scope}
      days={reportData?.days ?? []}
      range={statsYearRange}
      palette={palette}
      hidden={privacy}
      onPress={() => setMoreStatsOpen(true)}
    />
  );
  const addCardEntry =
    hiddenCards.length > 0 ? (
      <AddReportCardButton hiddenCount={hiddenCards.length} palette={palette} onPress={openCardSettings} />
    ) : null;

  const expenseCards: Partial<Record<ReportCardId, ReactNode>> = {
    overview: (
      <MonthlyOverviewCard
        income={income}
        expense={expense}
        balance={balance}
        periodText={periodText}
        currentPeriod={isCurrent}
        palette={palette}
        hidden={privacy}
      />
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
    expense_trend: (
      <MonthlyExpenseTrendCard
        series={incomeExpense}
        budgetTotal={isMonthlyView ? (budgetQ.data?.budget?.total_amount ?? null) : null}
        palette={palette}
        hidden={privacy}
        currentPeriod={isCurrent}
      />
    ),
    expense_category: (
      <MonthlyExpenseCategoryCard
        categories={byCat}
        total={expenseTotal}
        palette={palette}
        hidden={privacy}
        onOpenDetail={setDetail}
        emptyText={isMonthlyView ? t('report.emptyMonthExpense') : t('report.emptyPeriodExpense')}
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
        onOpen={() => setMemberAnalysisOpen(true)}
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
        expense={expense}
        balance={balance}
        rate={balRate}
        periodText={periodText}
        currentPeriod={isCurrent}
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
        income={income}
        expense={expense}
        balance={balance}
        rate={balRate}
        periodText={periodText}
        currentPeriod={isCurrent}
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
            <Host key={locale} ignoreSafeArea="all" style={styles.segmentHost}>
              <Picker
                modifiers={[pickerStyle('segmented')]}
                selection={scope}
                onSelectionChange={(value) => setScope(value as ReportScope)}
              >
                {REPORT_SCOPES.map((item) => (
                  <UIText key={item.key} modifiers={[tag(item.key)]}>
                    {t(item.labelKey)}
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
                <Host key={locale} ignoreSafeArea="all" style={styles.dimensionSegmentHost}>
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
                        {t(d.labelKey)}
                      </UIText>
                    ))}
                  </Picker>
                </Host>
              </View>
            </View>

            <ReportFilterBar
              activeCount={activeFilters}
              matchedCount={filteredCount}
              periodLabel={periodText}
              currentPeriod={isCurrent}
              palette={palette}
              onPress={() => setFilterOpen(true)}
            />

            {filteredCount > 0 && filteredCount < 3 ? (
              <ReportDataReadinessCard count={filteredCount} palette={palette} />
            ) : null}
            {renderOrderedCards(scopeCards, cardOrder)}
            {addCardEntry}
          </Animated.ScrollView>
        )}

        {/* 标题：绝对覆盖层，随滚动上移淡出 */}
        <View style={[styles.headerClip, { height: headerHeight }]} pointerEvents="box-none">
          <Animated.View
            style={[styles.header, { backgroundColor: palette.base, paddingTop: insets.top + Space[2] }, headerStyle]}
            onLayout={onHeaderLayout}
          >
            <ThemedText style={[styles.title, { color: palette.textPrimary }]}>{t('tabs.report')}</ThemedText>
            <HeaderSearchButton />
          </Animated.View>
        </View>
      </View>

      {/* 分类流水明细下钻 */}
      <CategoryDetailSheet
        detail={detail}
        range={range}
        dimension={dimension}
        analyticsInput={analyticsInput}
        totalExpense={expenseTotal}
        hidden={privacy}
        onClose={() => setDetail(null)}
      />
      <MemberAnalysisSheet
        visible={memberAnalysisOpen}
        dimension={dimension}
        analytics={reportData ?? EMPTY_REPORT_ANALYTICS}
        members={membersQ.data ?? []}
        categories={catsQ.data ?? []}
        hidden={privacy}
        onClose={() => setMemberAnalysisOpen(false)}
      />
      <FinancialInsightsDetailSheet
        visible={insightsOpen}
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
        hidden={privacy}
        onClose={() => setInsightsOpen(false)}
      />
      <MoreStatsSheet
        visible={moreStatsOpen}
        scope={scope}
        range={statsYearRange}
        days={reportData?.days ?? []}
        hidden={privacy}
        onClose={() => setMoreStatsOpen(false)}
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
  periodLabel,
  currentPeriod,
  palette,
  onPress,
}: {
  activeCount: number;
  matchedCount: number;
  periodLabel: string;
  currentPeriod: boolean;
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
      accessibilityLabel={t('report.filterA11y', {
        period: currentPeriod ? t('report.currentPeriodStatus') : t('report.historicalSettled'),
        active: activeCount,
        matched: matchedCount,
      })}
      accessibilityHint={t('report.filterHint')}
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
          {active ? t('report.filterCount', { count: activeCount }) : t('report.filterAll')}
        </ThemedText>
      </View>
      <View style={styles.filterBarRight}>
        <View style={[styles.periodStatus, { backgroundColor: currentPeriod ? palette.bannerTint : palette.cardPill }]}>
          <View
            style={[styles.periodStatusDot, { backgroundColor: currentPeriod ? palette.info : palette.textTertiary }]}
          />
          <ThemedText
            style={[styles.periodStatusText, { color: currentPeriod ? palette.info : palette.textSecondary }]}
          >
            {currentPeriod ? t('report.currentInProgress', { period: periodLabel }) : t('dates.settled')}
          </ThemedText>
        </View>
        <ThemedText style={[styles.filterBarMeta, { color: palette.textSecondary }]}>
          {t('report.countWithUnit', { count: matchedCount })}
        </ThemedText>
        <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
      </View>
    </Pressable>
  );
}

function ReportDataReadinessCard({ count, palette }: { count: number; palette: ReturnType<typeof usePalette> }) {
  return (
    <View
      style={[styles.dataReadinessCard, { backgroundColor: palette.card, borderColor: palette.separator }]}
      accessible
      accessibilityRole="text"
      accessibilityLabel={t('report.readinessA11y', { count })}
    >
      <View style={[styles.dataReadinessIcon, { backgroundColor: palette.bannerTint }]}>
        <SymbolView name="chart.line.uptrend.xyaxis" tintColor={palette.info} size={20} />
      </View>
      <View style={styles.flex}>
        <ThemedText style={[styles.dataReadinessTitle, { color: palette.textPrimary }]}>
          {t('report.readinessTitle')}
        </ThemedText>
        <ThemedText style={[styles.dataReadinessBody, { color: palette.textSecondary }]}>
          {t('report.readinessBody', { count })}
        </ThemedText>
      </View>
    </View>
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
      accessibilityLabel={t('report.addCardA11y', { count: hiddenCount })}
    >
      <SymbolView name="plus.circle" tintColor={palette.accent} size={18} />
      <ThemedText style={[styles.addCardText, { color: palette.accent }]}>{t('report.addCard')}</ThemedText>
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
  const palette = useSheetPalette();
  const expenseCategories = categories.filter((c) => c.type === 'expense');
  const incomeCategories = categories.filter((c) => c.type === 'income');
  const setMember = (id: string) => onChange({ ...filters, memberIds: arrayToggle(filters.memberIds, id) });
  const setCategory = (id: string) => onChange({ ...filters, categoryIds: arrayToggle(filters.categoryIds, id) });
  const reset = () => onChange(EMPTY_FILTERS);

  return (
    <PageSheet visible={visible} onClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          <SheetHeader title={t('report.globalFilter')} />
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <View style={[styles.filterSummaryCard, { backgroundColor: palette.card }]}>
              <View style={[styles.filterSummaryIcon, { backgroundColor: palette.cardPill }]}>
                <SymbolView name="line.3.horizontal.decrease" tintColor={palette.accent} size={18} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.filterSummaryTitle, { color: palette.textPrimary }]}>
                  {t('report.filterUnify')}
                </Text>
                <Text style={[styles.filterSummaryText, { color: palette.textSecondary }]}>
                  {t('report.filterUnifyHint')}
                </Text>
              </View>
            </View>
            <FilterSection title={t('report.filterMembers')} palette={palette}>
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
            <FilterSection title={t('report.filterExpenseCats')} palette={palette}>
              {expenseCategories.map((category) => (
                <FilterChip
                  key={category.id}
                  label={displayCategoryName(category.name, category.is_system)}
                  selected={filters.categoryIds.includes(category.id)}
                  palette={palette}
                  onPress={() => setCategory(category.id)}
                />
              ))}
            </FilterSection>
            <FilterSection title={t('report.filterIncomeCats')} palette={palette}>
              {incomeCategories.map((category) => (
                <FilterChip
                  key={category.id}
                  label={displayCategoryName(category.name, category.is_system)}
                  selected={filters.categoryIds.includes(category.id)}
                  palette={palette}
                  onPress={() => setCategory(category.id)}
                />
              ))}
            </FilterSection>
            <View style={[styles.pendingFilterCard, { backgroundColor: palette.card }]}>
              <SymbolView name="tray" tintColor={palette.textTertiary} size={20} />
              <View style={styles.flex}>
                <Text style={[styles.pendingFilterTitle, { color: palette.textPrimary }]}>
                  {t('report.pendingAccount')}
                </Text>
                <Text style={[styles.pendingFilterText, { color: palette.textSecondary }]}>
                  {t('report.pendingAccountHint')}
                </Text>
              </View>
            </View>
          </ScrollView>
          <View style={[styles.filterFooter, { backgroundColor: palette.base, borderTopColor: palette.separator }]}>
            <Text style={[styles.filterFooterMeta, { color: palette.textSecondary }]}>
              {t('report.matchedCount', { count: matchedCount })}
            </Text>
            <Pressable style={[styles.filterReset, { borderColor: palette.separator }]} onPress={reset}>
              <Text style={[styles.filterResetText, { color: palette.textPrimary }]}>{t('common.reset')}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    </PageSheet>
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
  const projectedText = projected == null ? t('report.noForecast') : maskAmount(formatAmount(projected, ''), hidden);
  const targetLabel = dimension === 'year' ? t('report.annualIncomeTarget') : t('report.customIncomeTarget');
  const progressPct = Math.round(progress * 100);
  const targetText = maskAmount(formatAmount(target, ''), hidden);

  return (
    <Pressable
      style={[styles.card, styles.incomeTargetCard, { backgroundColor: palette.card }]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={t('report.incomeTargetA11y', { label: targetLabel, amount: formatAmount(income, '') })}
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
              {t('report.noIncomeTarget')}
            </ThemedText>
            <ThemedText style={[styles.targetEmptyText, { color: palette.textSecondary }]}>
              {t('report.noIncomeTargetHint')}
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
              accessibilityLabel={t('report.incomeTargetDoneA11y', { label: targetLabel, pct: progressPct })}
            >
              <ThemedText style={[styles.targetHeroPct, { color: palette.textPrimary }]}>{progressPct}%</ThemedText>
            </Donut>
            <View style={styles.flex}>
              <ThemedText style={[styles.targetHeroAmount, { color: palette.income }]} numberOfLines={1}>
                {maskAmount(formatAmount(income, '+'), hidden)}
              </ThemedText>
              <ThemedText style={[styles.targetHeroMeta, { color: palette.textSecondary }]}>
                {t('report.targetProjected', { target: targetText, projected: projectedText })}
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
              label={t('report.activeIncome')}
              value={activeIncome}
              target={activeTarget}
              color={palette.income}
              hidden={hidden}
            />
            <TargetMetric
              label={t('report.passiveIncome')}
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
      <ThemedText style={styles.targetMetricMeta}>
        {target > 0 ? t('report.ofTarget', { pct }) : t('report.noSplitTarget')}
      </ThemedText>
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
  const palette = useSheetPalette();
  const [annual, setAnnual] = useState(() => centsToYuanText(targets.annual));
  const [custom, setCustom] = useState(() => centsToYuanText(targets.custom));
  const [activeRatio, setActiveRatio] = useState(() => String(targets.activeRatio));

  const save = () => {
    const ratio = Math.max(0, Math.min(100, Math.round(Number(activeRatio) || DEFAULT_INCOME_TARGETS.activeRatio)));
    onSave({ annual: yuanTextToCents(annual), custom: yuanTextToCents(custom), activeRatio: ratio });
    onClose();
  };

  return (
    <PageSheet visible={visible} onClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          <SheetHeader title={t('report.incomeTarget')} onClose={onClose} onConfirm={save} />
          <View style={styles.customRangeContent}>
            <TargetInputCard
              label={t('report.annualTarget')}
              value={annual}
              onChangeText={setAnnual}
              palette={palette}
            />
            <TargetInputCard
              label={t('report.customTarget')}
              value={custom}
              onChangeText={setCustom}
              palette={palette}
            />
            <TargetInputCard
              label={t('report.activeShare')}
              value={activeRatio}
              onChangeText={setActiveRatio}
              palette={palette}
            />
            <Text style={[styles.customHint, { color: palette.textSecondary }]}>{t('report.passiveHint')}</Text>
          </View>
        </SafeAreaView>
      </View>
    </PageSheet>
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

function buildFinancialInsights({
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
  hidden,
  nowMs,
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
  hidden: boolean;
  nowMs: number;
}): FinancialInsight[] {
  const insights: FinancialInsight[] = [];
  if (budgetTotal && budgetTotal > 0 && projectedExpense != null && projectedExpense > budgetTotal) {
    insights.push({
      title: t('report.insightRisk'),
      body: t('report.insightRiskBody', { amount: maskAmount(formatAmount(projectedExpense, ''), hidden) }),
      action: topCategory
        ? t('report.insightRiskActionCat', { name: topCategory.name })
        : t('report.insightRiskAction'),
      tone: 'warn',
    });
  }
  if (topExpense && expenseTotal > 0 && topExpense.amount / expenseTotal >= 0.25) {
    insights.push({
      title: t('report.insightSpike'),
      body: t('report.insightSpikeBody', {
        category: topExpense.category,
        pct: Math.round((topExpense.amount / expenseTotal) * 100),
      }),
      action: t('report.insightSpikeAction'),
      tone: 'danger',
    });
  }
  if (projectedIncome != null && incomeTarget > 0) {
    const gap = projectedIncome - incomeTarget;
    insights.push({
      title: t('report.insightIncome'),
      body:
        gap >= 0
          ? t('report.insightIncomeOver', { amount: maskAmount(formatAmount(gap, ''), hidden) })
          : t('report.insightIncomeShort', { amount: maskAmount(formatAmount(Math.abs(gap), ''), hidden) }),
      action: gap >= 0 ? t('report.insightIncomeOverAction') : t('report.insightIncomeShortAction'),
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
      title: t('report.insightGoal'),
      body: t('report.insightGoalBody', {
        name: urgentGoal.goal.name,
        days: urgentGoal.days,
        amount: maskAmount(formatAmount(gap, ''), hidden),
      }),
      action: t('report.insightGoalAction'),
      tone: urgentGoal.days <= 30 ? 'warn' : 'ok',
    });
  }
  if (insights.length === 0) {
    insights.push({
      title: t('report.insightCalm'),
      body: t('report.insightCalmBody', {
        income: maskAmount(formatAmount(income, '+'), hidden),
        expense: maskAmount(formatAmount(expense, '-'), hidden),
      }),
      action: t('report.insightCalmAction'),
      tone: 'ok',
    });
  }
  return insights;
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
  onPress,
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
  onPress: () => void;
}) {
  const [nowMs] = useState(() => Date.now());
  const insights = buildFinancialInsights({
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
    hidden,
    nowMs,
  });
  const lead = insights[0];
  const rest = insights.slice(1, 3);
  const leadColor = insightToneColor(lead.tone, palette);

  return (
    <Pressable
      style={[styles.card, styles.insightsCard, { backgroundColor: palette.card }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint={t('report.insightHint')}
    >
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          {t('report.insights')}
        </ThemedText>
        <View style={styles.cardHeaderAction}>
          <ThemedText style={[styles.chartMeta, { color: palette.textSecondary }]}>
            {t('report.insightCountShort', { count: insights.length })}
          </ThemedText>
          <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
        </View>
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
    </Pressable>
  );
}

function insightToneColor(tone: FinancialInsight['tone'], palette: ReturnType<typeof usePalette>): string {
  if (tone === 'danger') return palette.danger;
  if (tone === 'warn') return palette.warning;
  return palette.info;
}

function insightToneIcon(tone: FinancialInsight['tone']): SymbolViewProps['name'] {
  if (tone === 'danger' || tone === 'warn') return 'exclamationmark.triangle.fill';
  return 'checkmark.circle.fill';
}

function FinancialInsightsDetailSheet({
  visible,
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
  hidden,
  onClose,
}: {
  visible: boolean;
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
  hidden: boolean;
  onClose: () => void;
}) {
  const palette = useSheetPalette();
  const [nowMs] = useState(() => Date.now());
  const insights = buildFinancialInsights({
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
    hidden,
    nowMs,
  });

  return (
    <PageSheet visible={visible} onClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          <SheetHeader title={t('report.insights')} />
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <View style={[styles.detailSummaryCard, { backgroundColor: palette.card }]}>
              <Text style={[styles.detailSummaryLabel, { color: palette.textSecondary }]}>
                {t('report.insightStatus')}
              </Text>
              <Text
                style={[
                  styles.detailSummaryAmount,
                  {
                    color:
                      balanceRate(income, income - expense) != null && income >= expense
                        ? palette.info
                        : palette.warning,
                  },
                ]}
              >
                {t('report.insightCount', { count: insights.length })}
              </Text>
              <Text style={[styles.detailSummaryMeta, { color: palette.textSecondary }]}>
                {t('report.insightGenerated')}
              </Text>
            </View>
            {insights.map((item) => {
              const color = insightToneColor(item.tone, palette);
              return (
                <View key={`${item.title}-${item.body}`} style={[styles.detailCard, { backgroundColor: palette.card }]}>
                  <View style={styles.insightDetailHeader}>
                    <View style={[styles.insightLeadIcon, { backgroundColor: color }]}>
                      <SymbolView name={insightToneIcon(item.tone)} tintColor={palette.onAccent} size={18} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>{item.title}</Text>
                      <Text style={[styles.insightLeadBody, { color: palette.textSecondary }]}>{item.body}</Text>
                    </View>
                  </View>
                  <View style={[styles.insightActionBlock, { borderColor: color, backgroundColor: palette.base }]}>
                    <Text style={[styles.insightActionBlockText, { color }]}>{item.action}</Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </View>
    </PageSheet>
  );
}

function MoreStatsSheet({
  visible,
  scope,
  range,
  days,
  hidden,
  onClose,
}: {
  visible: boolean;
  scope: HeatmapScope;
  range: { start: Date; end: Date };
  days: ReportDay[];
  hidden: boolean;
  onClose: () => void;
}) {
  const palette = useSheetPalette();
  return (
    <PageSheet visible={visible} onClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          <SheetHeader title={t('report.moreStats')} />
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <MoreStatsCard scope={scope} days={days} range={range} palette={palette} hidden={hidden} />
          </ScrollView>
        </SafeAreaView>
      </View>
    </PageSheet>
  );
}

function MoreStatsEntryCard({
  scope,
  days,
  range,
  palette,
  hidden,
  onPress,
}: {
  scope: HeatmapScope;
  days: ReportDay[];
  range: { start: Date; end: Date };
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onPress: () => void;
}) {
  const stats = buildMoreStats(days, range, scope);
  return (
    <Pressable
      style={[styles.card, styles.statsEntryCard, { backgroundColor: palette.card }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('report.moreStatsA11y', {
        year: range.start.getFullYear(),
        days: stats.recordDays,
      })}
    >
      <View style={[styles.statsEntryIcon, { backgroundColor: palette.cardPill }]}>
        <SymbolView name="calendar.badge.clock" tintColor={palette.accent} size={22} />
      </View>
      <View style={styles.flex}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          {t('report.moreStats')}
        </ThemedText>
        <ThemedText style={[styles.statsEntryText, { color: palette.textSecondary }]}>
          {t('report.moreStatsSub', { year: range.start.getFullYear() })}
        </ThemedText>
        <ThemedText style={[styles.statsEntryMeta, { color: palette.textSecondary }]}>
          {t('report.recordedDailyAvg', {
            days: stats.recordDays,
            amount: maskAmount(formatAmount(stats.dailyAvg, ''), hidden),
          })}
        </ThemedText>
      </View>
      <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={16} />
    </Pressable>
  );
}

function buildMoreStats(days: ReportDay[], range: { start: Date; end: Date }, scope: HeatmapScope) {
  const weekday = new Array<number>(7).fill(0);
  const byDate = new Map<string, number>();
  let weekend = 0;
  let workday = 0;
  let total = 0;
  let rows = 0;
  for (const item of days) {
    const date = new Date(`${item.date}T12:00:00.000Z`);
    if (!inRange(date.toISOString(), range.start, range.end)) continue;
    const amount =
      scope === 'expense'
        ? item.expenseNormalAmount
        : scope === 'income'
          ? item.incomeNormalAmount
          : item.incomeAmount - item.expenseAmount;
    if (amount === 0) continue;
    const day = date.getDay();
    const key = localDateKey(date);
    const heatAmount = scope === 'balance' ? Math.max(0, amount) : amount;
    weekday[day] += amount;
    byDate.set(key, (byDate.get(key) ?? 0) + heatAmount);
    total += amount;
    rows += 1;
    if (day === 0 || day === 6) weekend += amount;
    else workday += amount;
  }
  const rangeDays = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000));
  return {
    rows,
    weekday,
    byDate,
    heatDays: buildYearHeatDays(range.start.getFullYear(), byDate),
    weekend,
    workday,
    total,
    recordDays: byDate.size,
    dailyAvg: Math.round(total / Math.max(1, byDate.size)),
    completeness: Math.round((byDate.size / rangeDays) * 100),
  };
}

function buildYearHeatDays(year: number, byDate: Map<string, number>) {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const leading = start.getDay();
  const totalDays = Math.ceil((end.getTime() - start.getTime()) / 86400000);
  const totalCells = Math.ceil((leading + totalDays) / 7) * 7;
  return Array.from({ length: totalCells }, (_, index) => {
    const dayOffset = index - leading;
    if (dayOffset < 0 || dayOffset >= totalDays) return null;
    const date = addDays(start, dayOffset);
    const key = localDateKey(date);
    return { key, amount: byDate.get(key) ?? 0 };
  });
}

function MoreStatsCard({
  scope,
  days,
  range,
  palette,
  hidden,
}: {
  scope: HeatmapScope;
  days: ReportDay[];
  range: { start: Date; end: Date };
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const [heatmapWidth, setHeatmapWidth] = useState(0);
  const stats = useMemo(() => buildMoreStats(days, range, scope), [days, range, scope]);
  const max = Math.max(1, ...stats.weekday.map((value) => Math.abs(value)));
  const heatMax = Math.max(1, ...stats.heatDays.map((item) => item?.amount ?? 0));
  const weekdayLabels = WEEKDAY_KEYS.map((key) => t(key));
  const topWeekdayIndex = stats.weekday.reduce(
    (maxIndex, amount, index) => (amount > stats.weekday[maxIndex] ? index : maxIndex),
    0,
  );
  const heatRows = Array.from({ length: 7 }, (_, rowIndex) =>
    Array.from(
      { length: Math.ceil(stats.heatDays.length / 7) },
      (_, colIndex) => stats.heatDays[colIndex * 7 + rowIndex] ?? null,
    ),
  );
  const heatColumnCount = heatRows[0]?.length ?? 0;
  const heatCellSize =
    heatmapWidth > 0 && heatColumnCount > 0
      ? Math.max(HEATMAP_MIN_CELL_SIZE, (heatmapWidth - HEATMAP_COLUMN_GAP * (heatColumnCount - 1)) / heatColumnCount)
      : HEATMAP_FALLBACK_CELL_SIZE;
  const scopeTitle =
    scope === 'income' ? t('record.income') : scope === 'balance' ? t('report.balance') : t('record.expense');
  const heatColor = scope === 'income' ? palette.income : scope === 'balance' ? palette.info : palette.expense;

  return (
    <View style={[styles.card, styles.moreStatsCard, { backgroundColor: palette.card }]}>
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          {t('report.moreStats')}
        </ThemedText>
        <ThemedText style={[styles.chartMeta, { color: palette.textSecondary }]}>
          {t('report.completeness', { pct: stats.completeness })}
        </ThemedText>
      </View>
      <View style={styles.statsMetricRow}>
        <StatsMetric
          label={t('report.recordDays')}
          value={t('report.recordDaysValue', { count: stats.byDate.size })}
          palette={palette}
        />
        <StatsMetric
          label={t('report.dailyAvg', { scope: scopeTitle })}
          value={maskAmount(formatAmount(stats.dailyAvg, ''), hidden)}
          palette={palette}
        />
        <StatsMetric label={t('report.peakWeekday')} value={weekdayLabels[topWeekdayIndex]} palette={palette} />
      </View>
      <View style={[styles.heatPanel, { backgroundColor: palette.base }]}>
        <View style={styles.heatPanelHeader}>
          <Text style={[styles.heatTitle, { color: palette.textPrimary }]}>
            {t('report.heatTitle', { year: range.start.getFullYear(), scope: scopeTitle })}
          </Text>
          <View style={styles.heatLegend}>
            <Text style={[styles.heatLegendText, { color: palette.textSecondary }]}>{t('report.heatLess')}</Text>
            {[0.25, 0.5, 0.75, 1].map((opacity) => (
              <View key={opacity} style={[styles.heatLegendCell, { backgroundColor: heatColor, opacity }]} />
            ))}
            <Text style={[styles.heatLegendText, { color: palette.textSecondary }]}>{t('report.heatMore')}</Text>
          </View>
        </View>
        <View
          accessibilityLabel={t('report.heatmapA11y', { scope: scopeTitle })}
          style={styles.heatRows}
          onLayout={(event) => setHeatmapWidth(event.nativeEvent.layout.width)}
        >
          {heatRows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.heatWeekRow}>
              {row.map((item, colIndex) => (
                <View
                  key={item?.key ?? `empty-${rowIndex}-${colIndex}`}
                  style={[
                    styles.heatCell,
                    {
                      width: heatCellSize,
                      height: heatCellSize,
                      borderRadius: Math.max(1, Math.floor(heatCellSize / 4)),
                      backgroundColor: item && item.amount > 0 ? heatColor : palette.card,
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
          <View key={index} style={styles.weekdayRow}>
            <Text style={[styles.weekdayLabel, { color: palette.textSecondary }]}>{label}</Text>
            <View style={[styles.weekdayTrack, { backgroundColor: palette.base }]}>
              <View
                style={[
                  styles.weekdayFill,
                  { width: `${(Math.abs(stats.weekday[index]) / max) * 100}%`, backgroundColor: heatColor },
                ]}
              />
            </View>
            <Text style={[styles.weekdayAmount, { color: palette.textPrimary }]}>
              {maskAmount(formatAmount(stats.weekday[index], signForNet(stats.weekday[index])), hidden)}
            </Text>
          </View>
        ))}
      </View>
      <Text style={[styles.moreStatsMeta, { color: palette.textSecondary }]}>
        {t('report.weekdayWeekend', {
          workday: maskAmount(formatAmount(stats.workday, signForNet(stats.workday)), hidden),
          weekend: maskAmount(formatAmount(stats.weekend, signForNet(stats.weekend)), hidden),
          scope: scopeTitle,
          rows: stats.rows,
        })}
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
  periodText,
  currentPeriod,
  palette,
  hidden,
}: {
  income: number;
  expense: number;
  balance: number;
  periodText: string;
  currentPeriod: boolean;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  return (
    <ScopeOverviewCard
      scope="expense"
      income={income}
      expense={expense}
      balance={balance}
      rate={balanceRate(income, balance)}
      periodText={periodText}
      currentPeriod={currentPeriod}
      palette={palette}
      hidden={hidden}
    />
  );
}

function MonthlyIncomeOverviewCard({
  income,
  expense,
  balance,
  rate,
  periodText = t('dates.thisMonth'),
  currentPeriod,
  palette,
  hidden,
}: {
  income: number;
  expense: number;
  balance: number;
  rate: number | null;
  periodText?: string;
  currentPeriod: boolean;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  return (
    <ScopeOverviewCard
      scope="income"
      income={income}
      expense={expense}
      balance={balance}
      rate={rate}
      periodText={periodText}
      currentPeriod={currentPeriod}
      palette={palette}
      hidden={hidden}
    />
  );
}

function MonthlyBalanceOverviewCard({
  income,
  expense,
  balance,
  rate,
  periodText = t('dates.thisMonth'),
  currentPeriod,
  palette,
  hidden,
}: {
  income: number;
  expense: number;
  balance: number;
  rate: number | null;
  periodText?: string;
  currentPeriod: boolean;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  return (
    <ScopeOverviewCard
      scope="balance"
      income={income}
      expense={expense}
      balance={balance}
      rate={rate}
      periodText={periodText}
      currentPeriod={currentPeriod}
      palette={palette}
      hidden={hidden}
    />
  );
}

function ScopeOverviewCard({
  scope,
  income,
  expense,
  balance,
  rate,
  periodText,
  currentPeriod,
  palette,
  hidden,
}: {
  scope: ReportScope;
  income: number;
  expense: number;
  balance: number;
  rate: number | null;
  periodText: string;
  currentPeriod: boolean;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const rateText = rate == null ? '—' : `${Math.round(rate * 100)}%`;
  const metrics =
    scope === 'income'
      ? [
          {
            label: t('report.thisIncome'),
            value: maskAmount(formatAmount(income, '+'), hidden),
            color: palette.income,
          },
          {
            label: t('report.thisBalance'),
            value: maskAmount(formatAmount(balance, signForNet(balance)), hidden),
            color: balance < 0 ? palette.danger : palette.info,
          },
          {
            label: t('report.thisExpense'),
            value: maskAmount(formatAmount(expense, '-'), hidden),
            color: palette.expense,
          },
        ]
      : scope === 'balance'
        ? [
            {
              label: t('report.thisBalance'),
              value: maskAmount(formatAmount(balance, signForNet(balance)), hidden),
              color: balance < 0 ? palette.danger : palette.info,
            },
            {
              label: t('report.savingsRateShort'),
              value: rateText,
              color: rate != null && rate < 0 ? palette.danger : palette.textPrimary,
            },
            {
              label: t('report.thisExpense'),
              value: maskAmount(formatAmount(expense, '-'), hidden),
              color: palette.expense,
            },
          ]
        : [
            {
              label: t('report.thisExpense'),
              value: maskAmount(formatAmount(expense, '-'), hidden),
              color: palette.expense,
            },
            {
              label: t('report.thisBalance'),
              value: maskAmount(formatAmount(balance, signForNet(balance)), hidden),
              color: balance < 0 ? palette.danger : palette.info,
            },
            {
              label: t('report.thisIncome'),
              value: maskAmount(formatAmount(income, '+'), hidden),
              color: palette.income,
            },
          ];

  return (
    <View
      style={[styles.monthlyOverview, { backgroundColor: palette.card }]}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={t('report.overviewA11y', {
        period: periodText,
        income: formatAmount(income, '+'),
        expense: formatAmount(expense, '-'),
        balance: formatAmount(balance, signForNet(balance)),
        suffix: currentPeriod ? t('report.overviewInProgress') : '',
      })}
    >
      <View style={styles.overviewHeader}>
        <ThemedText style={[styles.overviewTitle, { color: palette.textPrimary }]}>
          {t('report.periodSummary')}
        </ThemedText>
        <View
          style={[styles.overviewStatus, { backgroundColor: currentPeriod ? palette.bannerTint : palette.cardPill }]}
        >
          <View
            style={[styles.overviewStatusDot, { backgroundColor: currentPeriod ? palette.info : palette.textTertiary }]}
          />
          <ThemedText
            style={[styles.overviewStatusText, { color: currentPeriod ? palette.info : palette.textSecondary }]}
          >
            {currentPeriod ? t('dates.inProgress') : t('dates.settled')}
          </ThemedText>
        </View>
      </View>
      <View style={styles.overviewMetrics}>
        {metrics.map((metric, index) => (
          <View
            key={metric.label}
            style={[
              styles.monthlyOverviewCell,
              index > 0 && { borderLeftColor: palette.separator, borderLeftWidth: StyleSheet.hairlineWidth },
            ]}
          >
            <ThemedText style={[styles.monthlyOverviewLabel, { color: palette.textSecondary }]}>
              {metric.label}
            </ThemedText>
            <ThemedText
              style={[
                styles.monthlyOverviewAmount,
                index === 0 && styles.monthlyOverviewAmountPrimary,
                { color: metric.color },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {metric.value}
            </ThemedText>
          </View>
        ))}
      </View>
    </View>
  );
}

function chartTicks(max: number, count = 3): number[] {
  const top = Math.max(1, max);
  return Array.from({ length: count }, (_, index) => Math.round((top * (count - 1 - index)) / (count - 1)));
}

function axisAmountLabel(value: number): string {
  const yuan = Math.round(value / 100);
  if (yuan >= 10000 && fromI18nLanguage(i18n.language) === 'zh') {
    return t('report.wan', { n: Math.round(yuan / 1000) / 10 });
  }
  if (yuan >= 1000) return `${Math.round(yuan / 100) / 10}k`;
  return String(yuan);
}

function SvgYAxis({
  ticks,
  x,
  width,
  yOf,
  chartRight,
  color,
  gridColor,
  suffix = '',
  formatter = axisAmountLabel,
}: {
  ticks: number[];
  x: number;
  width: number;
  yOf: (value: number) => number;
  chartRight: number;
  color: string;
  gridColor: string;
  suffix?: string;
  formatter?: (value: number) => string;
}) {
  return (
    <>
      {ticks.map((tick) => {
        const y = yOf(tick);
        return (
          <Fragment key={`${tick}-${suffix}`}>
            <Line x1={x + width + 6} y1={y} x2={chartRight} y2={y} stroke={gridColor} strokeWidth="1" opacity={0.42} />
            <SvgText x={x + width} y={y + 3} fontSize="9" fill={color} textAnchor="end">
              {formatter(tick)}
              {suffix}
            </SvgText>
          </Fragment>
        );
      })}
    </>
  );
}

function MonthlyExpenseTrendCard({
  series,
  budgetTotal,
  palette,
  hidden,
  currentPeriod,
}: {
  series: { label: string; income: number; expense: number }[];
  budgetTotal: number | null;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  currentPeriod: boolean;
}) {
  const [selected, setSelected] = useState<{ label: string; expense: number; budget: number | null } | null>(null);
  const W = 320;
  const H = 146;
  const axisW = 34;
  const chartRight = W - 2;
  const chartBottom = H - 18;
  const padY = 14;
  const max = Math.max(1, budgetTotal ?? 0, ...series.map((s) => s.expense));
  const nonZeroCount = series.filter((s) => s.expense > 0).length;
  const avg = series.length > 0 ? Math.round(series.reduce((sum, item) => sum + item.expense, 0) / series.length) : 0;
  const groupW = (chartRight - axisW) / Math.max(1, series.length);
  const barW = Math.min(22, groupW * 0.42);
  const hasTrend = nonZeroCount >= 2;
  const yOf = (value: number) => chartBottom - ((chartBottom - padY) * value) / max;
  const ticks = chartTicks(max);

  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          {t('report.expenseTrend')}
        </ThemedText>
        <ThemedText style={[styles.chartMeta, { color: palette.textSecondary }]}>
          {t('report.chartMean', { amount: maskAmount(formatAmount(avg, ''), hidden) })}
        </ThemedText>
      </View>
      {!hasTrend ? (
        <TrendFallback
          count={nonZeroCount}
          label={t('record.expense')}
          icon="chart.line.uptrend.xyaxis"
          palette={palette}
        />
      ) : (
        <>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            <SvgYAxis
              ticks={ticks}
              x={0}
              width={axisW - 8}
              yOf={yOf}
              chartRight={chartRight}
              color={palette.textTertiary}
              gridColor={palette.separator}
            />
            {budgetTotal != null && budgetTotal > 0 ? (
              <Line
                x1={axisW}
                y1={yOf(budgetTotal)}
                x2={chartRight}
                y2={yOf(budgetTotal)}
                stroke={palette.warning}
                strokeWidth="1.5"
                strokeDasharray="5 5"
              />
            ) : null}
            <Line
              x1={axisW}
              y1={chartBottom}
              x2={chartRight}
              y2={chartBottom}
              stroke={palette.separator}
              strokeWidth="1"
            />
            {series.map((item, index) => {
              const h = item.expense > 0 ? Math.max(3, chartBottom - yOf(item.expense)) : 0;
              const x = axisW + groupW * index + (groupW - barW) / 2;
              const isCurrent = currentPeriod && index === series.length - 1;
              return (
                <Rect
                  key={item.label}
                  x={x}
                  y={chartBottom - h}
                  width={barW}
                  height={h}
                  rx={4}
                  fill={selected?.label === item.label ? palette.accent : palette.expense}
                  opacity={isCurrent ? 0.82 : 1}
                  onPress={() => setSelected({ label: item.label, expense: item.expense, budget: budgetTotal })}
                  accessibilityLabel={t('report.selectedExpense', {
                    label: item.label,
                    amount: formatAmount(item.expense, '-'),
                  })}
                />
              );
            })}
          </Svg>
          <View style={[styles.trendLabels, { paddingLeft: axisW }]}>
            {series.map((item, index) => (
              <Text
                key={item.label}
                style={[
                  styles.trendLabel,
                  { color: currentPeriod && index === series.length - 1 ? palette.info : palette.textTertiary },
                ]}
              >
                {item.label}
              </Text>
            ))}
          </View>
          <ThemedText style={[styles.chartSelection, { color: palette.textSecondary }]}>
            {selected
              ? t('report.selectedExpense', {
                  label: selected.label,
                  amount: maskAmount(formatAmount(selected.expense, '-'), hidden),
                })
              : t('report.chartAvgExpense', {
                  count: series.length,
                  amount: maskAmount(formatAmount(avg, ''), hidden),
                })}
          </ThemedText>
        </>
      )}
    </View>
  );
}

function TrendFallback({
  count,
  label,
  icon,
  palette,
}: {
  count: number;
  label: string;
  icon: SymbolViewProps['name'];
  palette: ReturnType<typeof usePalette>;
}) {
  return (
    <View style={styles.emptyBox}>
      <SymbolView name={icon} tintColor={palette.textTertiary} size={36} />
      <ThemedText style={{ color: palette.textPrimary, fontWeight: '700' }}>{t('report.trendNotEnough')}</ThemedText>
      <ThemedText style={{ color: palette.textSecondary, textAlign: 'center' }}>
        {t('report.trendNeedMore', { count, label })}
      </ThemedText>
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
  const axisW = 34;
  const chartRight = W - 2;
  const chartBottom = H - 18;
  const padY = 14;
  const max = Math.max(1, ...series.map((s) => s.income));
  const avg = series.length > 0 ? Math.round(series.reduce((sum, item) => sum + item.income, 0) / series.length) : 0;
  const groupW = (chartRight - axisW) / Math.max(1, series.length);
  const barW = Math.min(22, groupW * 0.42);
  const nonZeroCount = series.filter((s) => s.income > 0).length;
  const hasTrend = nonZeroCount >= 2;
  const yOf = (value: number) => chartBottom - ((chartBottom - padY) * value) / max;
  const ticks = chartTicks(max);

  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          {t('report.incomeTrend')}
        </ThemedText>
        <ThemedText style={[styles.chartMeta, { color: palette.textSecondary }]}>
          {t('report.chartAvgLine', { amount: maskAmount(formatAmount(avg, ''), hidden) })}
        </ThemedText>
      </View>
      {!hasTrend ? (
        <TrendFallback count={nonZeroCount} label={t('record.income')} icon="chart.bar.xaxis" palette={palette} />
      ) : (
        <>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            <SvgYAxis
              ticks={ticks}
              x={0}
              width={axisW - 8}
              yOf={yOf}
              chartRight={chartRight}
              color={palette.textTertiary}
              gridColor={palette.separator}
            />
            <Line
              x1={axisW}
              y1={yOf(avg)}
              x2={chartRight}
              y2={yOf(avg)}
              stroke={palette.warning}
              strokeWidth="1.5"
              strokeDasharray="5 5"
            />
            <Line
              x1={axisW}
              y1={chartBottom}
              x2={chartRight}
              y2={chartBottom}
              stroke={palette.separator}
              strokeWidth="1"
            />
            {series.map((item, index) => {
              const h = item.income > 0 ? Math.max(3, chartBottom - yOf(item.income)) : 0;
              const x = axisW + groupW * index + (groupW - barW) / 2;
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
                  accessibilityLabel={t('report.selectedIncome', {
                    label: item.label,
                    amount: formatAmount(item.income, ''),
                  })}
                />
              ) : null;
            })}
          </Svg>
          <View style={[styles.trendLabels, { paddingLeft: axisW }]}>
            {series.map((item) => (
              <Text key={item.label} style={[styles.trendLabel, { color: palette.textTertiary }]}>
                {item.label}
              </Text>
            ))}
          </View>
          <ThemedText style={[styles.chartSelection, { color: palette.textSecondary }]}>
            {selected
              ? t('report.selectedIncome', {
                  label: selected.label,
                  amount: maskAmount(formatAmount(selected.income, '+'), hidden),
                })
              : t('report.chartAvgIncome', {
                  count: series.length,
                  amount: maskAmount(formatAmount(avg, ''), hidden),
                })}
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
  const { locale } = useLocalePreference();
  const topCategories = categories.slice(0, 4);
  const topTotal = topCategories.reduce((sum, item) => sum + item.amount, 0);
  const otherExpense = Math.max(0, expense - topTotal);
  const rows: { label: string; amount: number; color: string; sign: '+' | '-' | '' }[] = [
    { label: t('record.income'), amount: income, color: palette.income, sign: '+' },
    ...topCategories.map((category) => ({
      label: category.name,
      amount: category.amount,
      color: category.color,
      sign: '-' as const,
    })),
    ...(otherExpense > 0
      ? [{ label: t('common.other'), amount: otherExpense, color: palette.textTertiary, sign: '-' as const }]
      : []),
    {
      label: t('report.balance'),
      amount: Math.abs(balance),
      color: balance < 0 ? palette.danger : palette.info,
      sign: signForNet(balance),
    },
  ];
  const max = Math.max(1, ...rows.map((row) => row.amount));

  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <ThemedText style={[styles.sectionTitle, { color: palette.textPrimary }]}>
        {t('report.balanceWaterfall')}
      </ThemedText>
      <View style={styles.waterfallList}>
        {rows.map((row) => (
          <View key={row.label} style={styles.waterfallRow}>
            <ThemedText
              style={[styles.waterfallLabel, { color: palette.textSecondary, width: locale === 'en' ? 72 : 38 }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.72}
            >
              {row.label}
            </ThemedText>
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
  const axisW = 34;
  const chartRight = W - 2;
  const padY = 12;
  const min = Math.min(0, ...values);
  const max = Math.max(0.5, ...values);
  const span = Math.max(0.1, max - min);
  const stepX = rates.length > 1 ? (chartRight - axisW) / (rates.length - 1) : 0;
  const xOf = (i: number) => axisW + i * stepX;
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
          {t('report.savingsRate')}
        </ThemedText>
        <ThemedText style={[styles.chartMeta, { color: palette.textSecondary }]}>
          {latest == null ? t('report.noIncome') : t('report.periodRate', { pct: Math.round(latest * 100) })}
        </ThemedText>
      </View>
      {!hasData ? (
        <View style={styles.emptyBox}>
          <SymbolView name="chart.line.uptrend.xyaxis" tintColor={palette.textTertiary} size={36} />
          <ThemedText style={{ color: palette.textSecondary }}>{t('report.savingsRateZero')}</ThemedText>
        </View>
      ) : (
        <>
          <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
            <SvgYAxis
              ticks={[max, (max + min) / 2, min]}
              x={0}
              width={axisW - 8}
              yOf={yOf}
              chartRight={chartRight}
              color={palette.textTertiary}
              gridColor={palette.separator}
              formatter={(value) => `${Math.round(value * 100)}%`}
            />
            <Line x1={axisW} y1={yOf(0)} x2={chartRight} y2={yOf(0)} stroke={palette.separator} strokeWidth="1" />
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
                  accessibilityLabel={t('report.selectedRate', {
                    label: item.label,
                    pct: Math.round((item.rate ?? 0) * 100),
                  })}
                />
              ),
            )}
          </Svg>
          <View style={[styles.trendLabels, { paddingLeft: axisW }]}>
            {rates.map((item) => (
              <Text key={item.label} style={[styles.trendLabel, { color: palette.textTertiary }]}>
                {item.label}
              </Text>
            ))}
          </View>
          <ThemedText style={[styles.chartSelection, { color: palette.textSecondary }]}>
            {selected
              ? t('report.selectedRate', { label: selected.label, pct: Math.round(selected.rate * 100) })
              : t('report.chartLatestRate', {
                  value: latest == null ? t('report.noValue') : `${Math.round(latest * 100)}%`,
                })}
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
              {t('report.monthBudget')}
            </ThemedText>
          </View>
          <ThemedText style={{ color: palette.textSecondary }}>{t('settings.notSet')}</ThemedText>
        </View>
        <ThemedText style={{ color: palette.textSecondary }}>{t('report.setBudgetHint')}</ThemedText>
        <Pressable style={[styles.budgetAction, { borderColor: palette.separator }]} onPress={onOpen}>
          <SymbolView name="plus.circle" tintColor={palette.accent} size={17} />
          <ThemedText style={[styles.budgetActionText, { color: palette.accent }]}>{t('report.setBudget')}</ThemedText>
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
    ? t('common.overBy', { amount: maskAmount(formatAmount(Math.abs(remaining), ''), hidden) })
    : t('common.leftover', { amount: maskAmount(formatAmount(remaining, ''), hidden) });
  const forecastOver = projected != null && projected > total;

  return (
    <Pressable style={[styles.card, styles.budgetCard, { backgroundColor: palette.card }]} onPress={onOpen}>
      <View style={styles.budgetHeading}>
        <View style={styles.budgetTitleRow}>
          <SymbolView name="target" tintColor={palette.textSecondary} size={18} />
          <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
            {t('report.monthBudget')}
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
        {t('report.usedOf', {
          used: maskAmount(formatAmount(used, ''), hidden),
          total: maskAmount(formatAmount(total, ''), hidden),
          pct: percent,
        })}
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
            ? t('report.pressureItem', { name: topCategory?.name ?? t('report.thisExpensePressure') })
            : forecastOver
              ? t('report.projectedMonthEnd', { amount: maskAmount(formatAmount(projected ?? 0, ''), hidden) })
              : daysLeft != null
                ? t('report.budgetOkDays', { days: daysLeft })
                : t('report.budgetOk')}
        </ThemedText>
        <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
      </View>
    </Pressable>
  );
}

function buildExpenseCategoryRows(categories: CatSlice[], otherColor: string): DisplayCatSlice[] {
  if (categories.length <= EXPENSE_CATEGORY_TOP_COUNT) return categories;
  const top = categories.slice(0, EXPENSE_CATEGORY_TOP_COUNT);
  const rest = categories.slice(EXPENSE_CATEGORY_TOP_COUNT);
  const otherAmount = rest.reduce((sum, item) => sum + item.amount, 0);
  if (otherAmount <= 0) return top;
  return [
    ...top,
    {
      id: EXPENSE_CATEGORY_OTHER_ID,
      name: t('common.other'),
      amount: otherAmount,
      color: otherColor,
      symbol: 'ellipsis.circle',
      categoryIds: rest.map((item) => item.id),
    },
  ];
}

function MonthlyExpenseCategoryCard({
  categories,
  total,
  palette,
  hidden,
  onOpenDetail,
  emptyText = t('report.emptyMonthExpense'),
}: {
  categories: CatSlice[];
  total: number;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onOpenDetail: (detail: CategoryDetail) => void;
  emptyText?: string;
}) {
  const [selected, setSelected] = useState<DisplayCatSlice | null>(null);
  const { locale } = useLocalePreference();
  const rows = useMemo(() => {
    void locale;
    return buildExpenseCategoryRows(categories, palette.textTertiary);
  }, [categories, palette.textTertiary, locale]);
  const selectedPercent = selected && total > 0 ? Math.round((selected.amount / total) * 100) : 0;
  return (
    <View
      style={[styles.card, { backgroundColor: palette.card }]}
      accessible
      accessibilityLabel={t('report.mixA11y', { total: formatAmount(total, ''), count: categories.length })}
    >
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          {t('report.expenseMix')}
        </ThemedText>
        {categories.length > 0 ? (
          <ThemedText style={[styles.categoryCaption, { color: palette.textSecondary }]}>
            {t('report.topSixOnly')}
          </ThemedText>
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
            slices={rows.map((c) => ({ value: c.amount, color: c.color }))}
            size={140}
            strokeWidth={22}
            trackColor={palette.base}
            accessibilityLabel={t('report.mixChartA11y', { name: rows[0]?.name ?? t('report.noneYet') })}
            onSlicePress={(index) => setSelected(rows[index] ?? null)}
          >
            <ThemedText style={[styles.donutCaption, { color: palette.textSecondary }]}>
              {t('report.totalExpense')}
            </ThemedText>
            <ThemedText style={[styles.monthlyDonutTotal, { color: palette.textPrimary }]}>
              {maskAmount(formatAmount(total, ''), hidden)}
            </ThemedText>
          </Donut>
          <View style={styles.monthlyCategoryList}>
            {rows.map((category) => {
              const percent = total > 0 ? Math.round((category.amount / total) * 100) : 0;
              return (
                <Pressable
                  key={category.id}
                  style={styles.monthlyCategoryRow}
                  hitSlop={{ top: 4, bottom: 4 }}
                  onPress={() =>
                    onOpenDetail({
                      id: category.id,
                      name: category.name,
                      categoryIds: category.categoryIds,
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={t('report.catShareA11y', {
                    name: category.name,
                    pct: percent,
                    amount: formatAmount(category.amount, '-'),
                  })}
                  accessibilityHint={t('report.catShareHint')}
                >
                  <View style={styles.monthlyCategoryLabel}>
                    <View style={[styles.categoryColorDot, { backgroundColor: category.color }]} />
                    <ThemedText style={[styles.monthlyCategoryName, { color: palette.textPrimary }]} numberOfLines={1}>
                      {category.name}
                    </ThemedText>
                  </View>
                  <ThemedText
                    style={[styles.monthlyCategoryPercent, { color: palette.textSecondary }]}
                    numberOfLines={1}
                  >
                    {percent}%
                  </ThemedText>
                  <ThemedText style={[styles.monthlyCategoryAmount, { color: palette.textPrimary }]} numberOfLines={1}>
                    {maskAmount(formatAmount(category.amount, '-'), hidden)}
                  </ThemedText>
                  <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={12} />
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
  periodText = t('dates.thisMonth'),
  palette,
  hidden,
  onOpen,
}: {
  members: Member[];
  maxCount: number;
  periodText?: string;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onOpen: () => void;
}) {
  return (
    <Pressable
      style={[styles.card, { backgroundColor: palette.card }]}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityHint={t('report.memberAnalysisHint')}
    >
      <View style={styles.memberTitleRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          {t('report.memberAnalysis')}
        </ThemedText>
        <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={15} />
      </View>
      {members.length === 0 ? (
        <View style={styles.emptyBox}>
          <SymbolView name="person.2" tintColor={palette.textTertiary} size={34} />
          <ThemedText style={{ color: palette.textSecondary }}>
            {t('report.noMemberRecords', { period: periodText })}
          </ThemedText>
        </View>
      ) : (
        <View style={styles.memberList}>
          {members.map((member) => (
            <View key={member.id} style={styles.memberRow}>
              <ThemedText
                style={[styles.memberName, { color: palette.textPrimary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
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
    </Pressable>
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
        <ThemedText style={[styles.emptyGoalTitle, { color: palette.textPrimary }]}>
          {t('report.firstGoalTitle')}
        </ThemedText>
        <ThemedText style={[styles.emptyGoalCopy, { color: palette.textSecondary }]}>
          {t('report.firstGoalBody')}
        </ThemedText>
        <Pressable style={[styles.newGoalButton, { borderColor: palette.separator }]} onPress={onOpen}>
          <SymbolView name="plus" tintColor={palette.textPrimary} size={18} />
          <ThemedText style={[styles.newGoalText, { color: palette.textPrimary }]}>{t('savings.create')}</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.card, styles.goalsCard, { backgroundColor: palette.card }]}>
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
          {t('report.savingsGoals')}
        </ThemedText>
        <ThemedText style={{ color: palette.textSecondary }}>
          {t('report.goalsInProgress', { count: goals.length })}
        </ThemedText>
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
        <ThemedText style={[styles.newGoalRowText, { color: palette.accent }]}>{t('report.newSavingsGoal')}</ThemedText>
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
  const palette = useSheetPalette();
  const selectedDays = Math.max(1, Math.abs(Math.round((start.getTime() - end.getTime()) / 86400000)) + 1);
  const resetLast30Days = () => {
    const today = startOfLocalDay(new Date());
    onChangeEnd(today);
    onChangeStart(addDays(today, -29));
  };

  return (
    <PageSheet visible={visible} onClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          <SheetHeader title={t('report.customPeriod')} />
          <View style={styles.customRangeContent}>
            <View style={[styles.customDateCard, { backgroundColor: palette.card }]}>
              <View style={styles.customDateRow}>
                <View style={styles.flex}>
                  <Text style={[styles.customDateLabel, { color: palette.textSecondary }]}>{t('dates.startDate')}</Text>
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
                  <Text style={[styles.customDateLabel, { color: palette.textSecondary }]}>{t('dates.endDate')}</Text>
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
            <Text style={[styles.customSelectedText, { color: palette.textSecondary }]}>
              {t('report.selectedDays', { count: selectedDays })}
            </Text>
            <Pressable
              style={[styles.customResetButton, { backgroundColor: palette.card, borderColor: palette.separator }]}
              onPress={resetLast30Days}
            >
              <SymbolView name="arrow.counterclockwise" tintColor={palette.accent} size={16} />
              <Text style={[styles.customResetText, { color: palette.accent }]}>{t('dates.last30')}</Text>
            </Pressable>
            <Text style={[styles.customHint, { color: palette.textSecondary }]}>{t('report.customCompareHint')}</Text>
          </View>
        </SafeAreaView>
      </View>
    </PageSheet>
  );
}

// ── 某分类区间流水明细（下钻）────────────────────────────────────────────────
function CategoryDetailSheet({
  detail,
  range,
  dimension,
  analyticsInput,
  totalExpense,
  hidden,
  onClose,
}: {
  detail: CategoryDetail | null;
  range: { start: Date; end: Date };
  dimension: Dimension;
  analyticsInput: ReportAnalyticsInput;
  totalExpense: number;
  hidden: boolean;
  onClose: () => void;
}) {
  const palette = useSheetPalette();
  const { locale } = useLocalePreference();
  const categoryIds = detail?.categoryIds?.length ? detail.categoryIds : detail ? [detail.id] : [];
  const detailQ = useCategoryDetail(
    detail
      ? {
          start: analyticsInput.start,
          end: analyticsInput.end,
          historyStart: analyticsInput.historyStart,
          categoryIds,
        }
      : null,
  );
  const firstPage = detailQ.data?.pages[0];
  const rows = detailQ.data?.pages.flatMap((page) => page.rows) ?? [];
  const periodExpense = firstPage?.amount ?? 0;
  const noteGroups = firstPage?.notes ?? [];
  const trend = useMemo(() => {
    void locale;
    const days = firstPage?.days ?? [];
    const flowRows = days.map((item) => ({
      occurred_at: `${item.date}T12:00:00.000Z`,
      type: 'expense' as const,
      amount: item.amount,
    }));
    const series =
      dimension === 'custom'
        ? equalPeriodIncomeExpenseSeries(range, flowRows)
        : incomeExpenseSeries(dimension, range.start, flowRows);
    return series.map((item) => ({ label: item.label, expense: item.expense }));
  }, [firstPage?.days, dimension, range, locale]);

  const share = totalExpense > 0 ? Math.round((periodExpense / totalExpense) * 100) : 0;
  const days = Math.max(1, Math.ceil((range.end.getTime() - range.start.getTime()) / 86400000));
  const dailyAvg = Math.round(periodExpense / days);
  const maxGroupAmount = Math.max(1, ...noteGroups.map((item) => item.amount));

  return (
    <PageSheet visible={!!detail} onClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          <SheetHeader title={detail?.name ?? ''} />
          <ScrollView contentContainerStyle={styles.sheetContent}>
            <View style={[styles.detailSummaryCard, { backgroundColor: palette.card }]}>
              <Text style={[styles.detailSummaryLabel, { color: palette.textSecondary }]}>
                {t('report.periodCatExpense', { name: detail?.name ?? '' })}
              </Text>
              <Text style={[styles.detailSummaryAmount, { color: palette.expense }]}>
                {maskAmount(formatAmount(periodExpense, '-'), hidden)}
              </Text>
              <Text style={[styles.detailSummaryMeta, { color: palette.textSecondary }]}>
                {t('report.shareCountAvg', {
                  pct: share,
                  count: rows.length,
                  amount: maskAmount(formatAmount(dailyAvg, ''), hidden),
                })}
              </Text>
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>
                  {t('report.subcategories')}
                </Text>
                <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>
                  {t('report.groupByNote')}
                </Text>
              </View>
              {noteGroups.length === 0 ? (
                <View style={styles.emptyBox}>
                  <SymbolView name="text.bubble" tintColor={palette.textTertiary} size={34} />
                  <Text style={{ color: palette.textSecondary }}>{t('report.noGroupable')}</Text>
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
                  {t('report.catTrend', { name: detail?.name ?? '' })}
                </Text>
                <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>
                  {t('report.last6Periods')}
                </Text>
              </View>
              <CategoryDetailTrendChart series={trend} palette={palette} />
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>
                  {t('report.detailTxns')}
                </Text>
                <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>
                  {t('report.allCount', { count: firstPage?.count ?? 0 })}
                </Text>
              </View>
              {rows.length === 0 ? (
                <View style={styles.emptyBox}>
                  <SymbolView name="list.bullet.rectangle" tintColor={palette.textTertiary} size={34} />
                  <Text style={{ color: palette.textSecondary }}>{t('report.emptyCatExpense')}</Text>
                </View>
              ) : (
                rows.map((txn) => (
                  <View key={txn.id} style={[styles.detailRow, { borderBottomColor: palette.separator }]}>
                    <View style={styles.flex}>
                      <Text style={[styles.detailNote, { color: palette.textPrimary }]} numberOfLines={1}>
                        {txn.note || t('report.noNote')}
                      </Text>
                      <Text style={[styles.detailDate, { color: palette.textSecondary }]}>
                        {new Date(txn.occurredAt).toLocaleDateString(intlLocale())}
                      </Text>
                    </View>
                    <Text style={[styles.detailAmount, { color: palette.expense }]} numberOfLines={1}>
                      {maskAmount(formatAmount(txn.amount, '-'), hidden)}
                    </Text>
                  </View>
                ))
              )}
              {detailQ.hasNextPage ? (
                <Pressable style={styles.detailLoadMore} onPress={() => detailQ.fetchNextPage()}>
                  <Text style={{ color: palette.accent }}>{t('common.loadMore')}</Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </PageSheet>
  );
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
  const axisW = 34;
  const chartRight = W - 2;
  const chartBottom = H - 18;
  const padY = 12;
  const max = Math.max(1, ...series.map((item) => item.expense));
  const groupW = (chartRight - axisW) / Math.max(1, series.length);
  const barW = Math.min(24, groupW * 0.44);
  const nonZeroCount = series.filter((item) => item.expense > 0).length;
  const hasTrend = nonZeroCount >= 2;
  const ticks = chartTicks(max);

  if (!hasTrend)
    return <TrendFallback count={nonZeroCount} label={t('record.expense')} icon="chart.bar.xaxis" palette={palette} />;

  return (
    <>
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
        <SvgYAxis
          ticks={ticks}
          x={0}
          width={axisW - 8}
          yOf={(value) => chartBottom - ((chartBottom - padY) * value) / max}
          chartRight={chartRight}
          color={palette.textTertiary}
          gridColor={palette.separator}
        />
        <Line x1={axisW} y1={chartBottom} x2={chartRight} y2={chartBottom} stroke={palette.separator} strokeWidth="1" />
        {series.map((item, index) => {
          const height = item.expense > 0 ? Math.max(4, ((chartBottom - padY) * item.expense) / max) : 0;
          const x = axisW + groupW * index + (groupW - barW) / 2;
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
              accessibilityLabel={t('report.selectedExpense', {
                label: item.label,
                amount: formatAmount(item.expense, ''),
              })}
            />
          ) : null;
        })}
      </Svg>
      <View style={[styles.trendLabels, { paddingLeft: axisW }]}>
        {series.map((item) => (
          <Text key={item.label} style={[styles.trendLabel, { color: palette.textTertiary }]}>
            {item.label}
          </Text>
        ))}
      </View>
      <Text style={[styles.chartSelection, { color: palette.textSecondary }]}>
        {selected
          ? t('report.selectedExpense', { label: selected.label, amount: formatAmount(selected.expense, '-') })
          : t('report.tapBarExact')}
      </Text>
    </>
  );
}

// ── 家庭成员分析：参与度 + 收支贡献 + 支出偏好 ────────────────────────────────
function MemberAnalysisSheet({
  visible,
  dimension,
  analytics,
  members,
  categories,
  hidden,
  onClose,
}: {
  visible: boolean;
  dimension: Dimension;
  analytics: ReportAnalytics;
  members: { id: string; nickname: string }[];
  categories: Category[];
  hidden: boolean;
  onClose: () => void;
}) {
  const palette = useSheetPalette();
  const catColors = useCategoryColors();
  const { locale } = useLocalePreference();
  const { rows, totalCount, totalIncome, totalExpense } = useMemo(() => {
    void locale;
    const catById = new Map(categories.map((category) => [category.id, category]));
    const memberMap = new Map<
      string,
      {
        id: string;
        name: string;
        count: number;
        income: number;
        expense: number;
        categoryMap: Map<string, { name: string; amount: number; color: string }>;
      }
    >(
      members.map((member) => [
        member.id,
        { id: member.id, name: member.nickname, count: 0, income: 0, expense: 0, categoryMap: new Map() },
      ]),
    );
    for (const item of analytics.members) {
      const row = memberMap.get(item.userId) ?? {
        id: item.userId,
        name: t('common.member'),
        count: 0,
        income: 0,
        expense: 0,
        categoryMap: new Map(),
      };
      row.count = item.count;
      row.income = item.incomeAmount;
      row.expense = item.expenseAmount;
      memberMap.set(item.userId, row);
    }
    for (const item of analytics.memberCategories) {
      const row = memberMap.get(item.userId);
      if (!row) continue;
      const cat = catById.get(item.categoryId);
      const storedName = cat?.name ?? '未分类';
      row.categoryMap.set(item.categoryId, {
        name: cat ? displayCategoryName(cat.name, cat.is_system) : t('common.uncategorized'),
        amount: item.amount,
        color: catColors[categoryColorKey(storedName, 'expense', cat?.color_key)],
      });
    }
    return {
      rows: Array.from(memberMap.values())
        .map((row) => {
          const topCategory = Array.from(row.categoryMap.values()).sort((a, b) => b.amount - a.amount)[0] ?? null;
          return { ...row, topCategory };
        })
        .sort((a, b) => b.count - a.count || b.expense - a.expense),
      totalCount: analytics.summary.transactionCount,
      totalIncome: analytics.summary.incomeAmount,
      totalExpense: analytics.summary.expenseAmount,
    };
  }, [members, analytics, categories, catColors, locale]);

  const maxCount = Math.max(1, ...rows.map((row) => row.count));
  const maxMoney = Math.max(1, ...rows.flatMap((row) => [row.income, row.expense]));
  const periodLabel = periodName(dimension);

  return (
    <PageSheet visible={visible} onClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          <SheetHeader title={t('report.memberAnalysis')} />

          <ScrollView contentContainerStyle={styles.sheetContent}>
            <View style={[styles.detailSummaryCard, { backgroundColor: palette.card }]}>
              <Text style={[styles.detailSummaryLabel, { color: palette.textSecondary }]}>
                {t('report.periodParticipation', { period: periodLabel })}
              </Text>
              <Text style={[styles.detailSummaryAmount, { color: palette.accent }]}>
                {hidden ? '****' : t('report.countWithUnit', { count: totalCount })}
              </Text>
              <Text style={[styles.detailSummaryMeta, { color: palette.textSecondary }]}>
                {t('report.incomeExpenseLine', {
                  income: maskAmount(formatAmount(totalIncome, '+'), hidden),
                  expense: maskAmount(formatAmount(totalExpense, '-'), hidden),
                })}
              </Text>
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>
                  {t('report.participation')}
                </Text>
                <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>{t('report.byMember')}</Text>
              </View>
              {totalCount === 0 ? (
                <View style={styles.emptyBox}>
                  <SymbolView name="person.2" tintColor={palette.textTertiary} size={34} />
                  <Text style={{ color: palette.textSecondary }}>
                    {t('report.noMemberRecords', { period: periodLabel })}
                  </Text>
                </View>
              ) : (
                <View style={styles.detailGroupList}>
                  {rows.map((item) => (
                    <View key={item.id} style={styles.detailGroupRow}>
                      <Text style={[styles.detailGroupName, { color: palette.textPrimary }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={[styles.detailGroupTrack, { backgroundColor: palette.base }]}>
                        <View
                          style={[
                            styles.detailGroupFill,
                            {
                              backgroundColor: palette.accent,
                              width: `${Math.max(6, (item.count / maxCount) * 100)}%`,
                            },
                          ]}
                        />
                      </View>
                      <Text style={[styles.detailGroupAmount, { color: palette.textPrimary }]} numberOfLines={1}>
                        {hidden ? '****' : t('report.countWithUnit', { count: item.count })}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>
                  {t('report.contribution')}
                </Text>
                <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>
                  {t('report.incomeSlashExpense')}
                </Text>
              </View>
              {rows.map((item) => (
                <View key={item.id} style={styles.memberContributionRow}>
                  <Text
                    style={[styles.memberContributionName, { color: palette.textPrimary }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.75}
                  >
                    {item.name}
                  </Text>
                  <View style={styles.memberContributionBars}>
                    <View style={[styles.memberContributionTrack, { backgroundColor: palette.base }]}>
                      <View
                        style={[
                          styles.memberContributionFill,
                          { width: `${Math.max(4, (item.income / maxMoney) * 100)}%`, backgroundColor: palette.income },
                        ]}
                      />
                    </View>
                    <View style={[styles.memberContributionTrack, { backgroundColor: palette.base }]}>
                      <View
                        style={[
                          styles.memberContributionFill,
                          {
                            width: `${Math.max(4, (item.expense / maxMoney) * 100)}%`,
                            backgroundColor: palette.expense,
                          },
                        ]}
                      />
                    </View>
                  </View>
                  <View style={styles.memberContributionAmounts}>
                    <Text style={[styles.memberContributionAmount, { color: palette.income }]}>
                      {maskAmount(formatAmount(item.income, '+'), hidden)}
                    </Text>
                    <Text style={[styles.memberContributionAmount, { color: palette.expense }]}>
                      {maskAmount(formatAmount(item.expense, '-'), hidden)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
              <View style={styles.cardHeaderRow}>
                <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>
                  {t('report.expensePref')}
                </Text>
                <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>
                  {t('report.topCategoryShort')}
                </Text>
              </View>
              {rows.every((row) => !row.topCategory) ? (
                <View style={styles.emptyBox}>
                  <SymbolView name="chart.pie" tintColor={palette.textTertiary} size={34} />
                  <Text style={{ color: palette.textSecondary }}>
                    {t('report.noNormalExpense', { period: periodLabel })}
                  </Text>
                </View>
              ) : (
                rows
                  .filter((row) => row.topCategory)
                  .map((row) => (
                    <View key={row.id} style={[styles.detailRow, { borderBottomColor: palette.separator }]}>
                      <Text
                        style={[styles.memberPreferenceName, { color: palette.textPrimary }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                      >
                        {row.name}
                      </Text>
                      <View
                        style={[
                          styles.categoryColorDot,
                          { backgroundColor: row.topCategory?.color ?? palette.textTertiary },
                        ]}
                      />
                      <Text style={[styles.detailNote, styles.flex, { color: palette.textPrimary }]} numberOfLines={1}>
                        {row.topCategory?.name}
                      </Text>
                      <Text
                        style={[styles.detailAmount, { color: row.topCategory?.color ?? palette.expense }]}
                        numberOfLines={1}
                      >
                        {maskAmount(formatAmount(row.topCategory?.amount ?? 0, '-'), hidden)}
                      </Text>
                    </View>
                  ))
              )}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </PageSheet>
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
  cardHeaderAction: { flexDirection: 'row', alignItems: 'center', gap: Space[1] },
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
  filterBarRight: { flexDirection: 'row', alignItems: 'center', gap: Space[1] },
  filterBarText: { fontSize: 15, fontWeight: '600' },
  filterBarMeta: { fontSize: 13, fontVariant: ['tabular-nums'] },
  filterIconBadge: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: Space[2],
    paddingVertical: 4,
  },
  periodStatusDot: { width: 5, height: 5, borderRadius: Radius.full },
  periodStatusText: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  dataReadinessCard: {
    minHeight: 68,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
  },
  dataReadinessIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dataReadinessTitle: { fontSize: 15, lineHeight: 20, fontWeight: '700' },
  dataReadinessBody: { fontSize: 13, lineHeight: 18, marginTop: 2 },
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
  monthlyOverview: { borderRadius: Radius.lg, padding: Space[4], gap: Space[3] },
  overviewHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space[3] },
  overviewTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  overviewStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: Space[2],
    paddingVertical: 4,
  },
  overviewStatusDot: { width: 5, height: 5, borderRadius: Radius.full },
  overviewStatusText: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
  overviewMetrics: { flexDirection: 'row', alignItems: 'stretch' },
  monthlyOverviewCell: { flex: 1, minWidth: 0, gap: Space[1], paddingHorizontal: Space[3] },
  monthlyOverviewLabel: { fontSize: 13 },
  monthlyOverviewAmount: { fontSize: 18, lineHeight: 24, fontWeight: '700', fontVariant: ['tabular-nums'] },
  monthlyOverviewAmountPrimary: { fontSize: 24, lineHeight: 30 },
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
  categoryCaption: { fontSize: 12, fontWeight: '400' },
  monthlyCategoryBody: { alignItems: 'center', gap: Space[3], paddingTop: Space[3] },
  monthlyDonutTotal: { fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  monthlyCategoryList: { alignSelf: 'stretch', gap: 0 },
  monthlyCategoryRow: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    paddingVertical: 0,
  },
  monthlyCategoryLabel: {
    flex: 4,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
  },
  categoryColorDot: { width: 8, height: 8, borderRadius: Radius.full },
  monthlyCategoryName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '500' },
  monthlyCategoryPercent: {
    flex: 2,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  monthlyCategoryAmount: {
    flex: 3.5,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
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
  insightDetailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Space[3] },
  insightActionBlock: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Space[3],
    paddingVertical: Space[2],
  },
  insightActionBlockText: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  statsEntryCard: { minHeight: 92, flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  statsEntryIcon: {
    width: 48,
    height: 48,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsEntryText: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  statsEntryMeta: { fontSize: 12, lineHeight: 17, marginTop: 3, fontVariant: ['tabular-nums'] },
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
  heatRows: { gap: HEATMAP_ROW_GAP },
  heatWeekRow: { flexDirection: 'row', gap: HEATMAP_COLUMN_GAP },
  heatCell: {},
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
  memberName: { fontSize: 14, width: 72 },
  memberBarWrap: { flex: 1 },
  memberBarTrack: { height: 10, borderRadius: Radius.full, overflow: 'hidden' },
  memberBarFill: { height: '100%', borderRadius: Radius.full },
  memberAmount: { fontSize: 13, fontVariant: ['tabular-nums'], width: 76, textAlign: 'right' },
  memberCount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'], width: 28, textAlign: 'right' },
  memberContributionRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingVertical: Space[2] },
  memberContributionName: { width: 72, fontSize: 13, fontWeight: '600' },
  memberContributionBars: { flex: 1, gap: Space[1] },
  memberContributionTrack: { height: 7, borderRadius: Radius.full, overflow: 'hidden' },
  memberContributionFill: { height: '100%', borderRadius: Radius.full },
  memberContributionAmounts: { width: 84, gap: 1 },
  memberContributionAmount: { fontSize: 11, fontWeight: '600', textAlign: 'right', fontVariant: ['tabular-nums'] },
  memberPreferenceName: { width: 72, fontSize: 14, fontWeight: '600' },
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
  customRangeContent: {
    paddingTop: SHEET_CONTENT_TOP_PADDING,
    paddingHorizontal: Space[4],
    paddingBottom: Space[10],
    gap: Space[3],
  },
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
    paddingHorizontal: Space[6],
    paddingTop: Space[5],
    paddingBottom: Space[4],
  },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  sheetAction: { fontSize: 16, fontWeight: '600' },
  sheetContent: {
    paddingTop: SHEET_CONTENT_TOP_PADDING,
    paddingHorizontal: Space[6],
    paddingBottom: Space[10],
    gap: Space[3],
  },
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
  detailLoadMore: { alignSelf: 'center', paddingHorizontal: Space[4], paddingVertical: Space[2] },
});
