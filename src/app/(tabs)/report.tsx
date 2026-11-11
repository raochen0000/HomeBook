import { onlineManager, useQueryClient } from '@tanstack/react-query';
/**
 * 报表（Tab 2，流程 9 完整版）：周/月/年维度切换 + 收支结余概览 + 结余率仪表 + 消费趋势折线
 * + 累计同期对比双线 + 收支对比双柱 + 支出分类占比环形图 + 分类环比 + 成员贡献条形图
 * + 大额支出 Top 5 + 收入结构环形图 + 分类明细下钻。
 * 月度总结入口已上移首页 hero「本月脉搏卡」（全屏可翻月，PRD §11），报表内不再设入口。
 * 口径（PRD §11）：收支结余 / 结余率统计全部流水（含储蓄类，对账）；分类占比 / 趋势 / 累计同期
 * / 分类环比 / 成员贡献 / 大额 Top N 仅算「支出 + source=normal」；收入结构仅算 source=normal 收入
 * （均排除储蓄类）。
 */
import {
  Button as UIButton,
  DatePicker,
  Host,
  Image as UIImage,
  Picker,
  Popover,
  Text as UIText,
} from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  buttonStyle,
  contentShape,
  datePickerStyle,
  fixedSize,
  font,
  foregroundColor,
  frame,
  labelsHidden,
  padding,
  pickerStyle,
  shapes,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image as ExpoImage } from 'expo-image';
import { useRouter, type Href } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, Pattern, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import {
  fetchReportAnalytics,
  DEFAULT_ACCOUNTING_PREFS,
  EMPTY_REPORT_ANALYTICS,
  useAccountingPrefs,
  useBudget,
  useBudgetProgress,
  useAllCategories,
  useCategoryLayout,
  useCategoryDetail,
  useFamilyMembers,
  useMyFamily,
  useMyProfile,
  useReportAnalytics,
  useSavingsGoals,
  type Category,
  type ReportAnalytics,
  type ReportAnalyticsInput,
  type SavingsGoal,
} from '@/api';
import { queryKeys } from '@/api/keys';
import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { ThemedText } from '@/components/themed-text';
import { UserAvatar } from '@/components/user-avatar';
import { Radius, Space, TabBarInset, useCategoryColors, usePalette, useSheetPalette } from '@/constants/design';
import { BudgetSheet } from '@/features/budget/budget-sheet';
import {
  CategoryMomCard,
  IncomeExpenseCard,
  IncomeStructureCard,
  TopExpensesCard,
  type TopItem,
} from '@/features/report/advanced';
import {
  ReportCardHeader,
  ReportDetailText,
  ReportDisclosure,
  ReportEmptyGroup,
  ReportFilterButton,
} from '@/features/report/presentation';
import { compactReportCards, reportComparisonChange, reportComparisonRangeLabel } from '@/lib/report-presentation';
import { Donut } from '@/features/report/donut';
import { ReportFilterSheet } from '@/features/report/filter-sheet';
import { filterRequests, prepareFilterResults } from '@/features/report/filter-logic';
import { MoreStatsEntryCard, MoreStatsSheet } from '@/features/report/more-stats-ui';
import { isOfflinePeriodUnavailable } from '@/features/report/period-availability';
import { SavingsSheet } from '@/features/savings/savings-sheet';
import { useCollapsibleHeader } from '@/features/shared/use-collapsible-header';
import { hasSettledRefreshFailure } from '@/features/sync/cache-inline-notice';
import { displayCategoryName, i18n, INTL_LOCALE, t, useLocalePreference } from '@/i18n';
import { fromI18nLanguage } from '@/i18n/locale';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { buildCategoryHierarchy, categoryDescendantIds, type CategoryHierarchy } from '@/lib/category-hierarchy';
import { calendarDateInTimeZone, currentPeriod, formatAmount, maskAmount, signForNet } from '@/lib/format';
import { memberDisplayName } from '@/lib/member-name';
import { isNetworkAvailable, requestNetworkRecovery, useNetworkAvailable } from '@/lib/query-network';
import {
  balanceRate,
  calendarDayDifference,
  categoryChanges,
  categoryIdsForReportType,
  comparablePeriods,
  equalPeriodIncomeExpenseSeries,
  incomeExpenseSeries,
  periodRange,
  reportAccountingTotals,
  reportBudgetForecast,
  reportCalendarDayTimestamp,
  reportDayFlows,
  reportPeriodCashFlow,
  reportTopicData,
  reportTrendAverage,
  shiftAnchor,
  type Dimension,
} from '@/lib/report';
import { resolveScopeCardLayout, type ReportCardId, type ReportScope } from '@/lib/report-cards';

type CatSlice = { id: string; name: string; amount: number; color: string; symbol: string };
/** 分类下钻：单类用 id；「其它」聚合用 categoryIds。 */
type CategoryDetail = { id: string; name: string; categoryIds?: string[]; type?: 'expense' | 'income' };
type DisplayCatSlice = CatSlice & { categoryIds?: string[] };
type Member = { id: string; name: string; avatarName: string; avatarUrl: string | null; amount: number; count: number };
const EXPENSE_CATEGORY_TOP_COUNT = 5;
const EXPENSE_CATEGORY_OTHER_ID = '__other__';
type ReportFilters = { memberIds: string[]; categoryIds: string[] };
type IncomeTargets = { annual: number; custom: number; activeRatio: number };
type FinancialInsight = { title: string; body: string; action: string; tone: 'ok' | 'warn' | 'danger' };
type FamilyComparison = {
  label: string;
  shortLabel: string;
  inProgress: boolean;
  currentValues: ReturnType<typeof reportPeriodCashFlow>;
  previousValues: ReturnType<typeof reportPeriodCashFlow>;
};

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

function intlLocale(): string {
  return INTL_LOCALE[fromI18nLanguage(i18n.language)];
}

function reportPeriodName(dimension: Dimension): string {
  return t(
    dimension === 'week'
      ? 'report.periodWeek'
      : dimension === 'year'
        ? 'report.periodYear'
        : dimension === 'custom'
          ? 'report.periodCustom'
          : 'report.periodMonth',
  );
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

function activeFilterCount(filters: ReportFilters): number {
  return filters.memberIds.length + filters.categoryIds.length;
}

function isPassiveIncomeName(name: string): boolean {
  return /利息|理财|投资|股息|分红|租金|被动/.test(name);
}

function targetForDimension(targets: IncomeTargets, dimension: Dimension): number {
  return dimension === 'year' ? targets.annual : targets.custom;
}

function projectionForRange(
  amount: number,
  range: { start: Date; end: Date },
  isCurrent: boolean,
  today: Date,
): number | null {
  if (!isCurrent) return null;
  const elapsed = Math.max(1, calendarDayDifference(range.start, today) + 1);
  const total = Math.max(1, calendarDayDifference(range.start, range.end));
  return Math.round((amount / elapsed) * total);
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
  const days = Math.max(1, calendarDayDifference(start, end));
  const prevEnd = new Date(start);
  const prevStart = addDays(prevEnd, -days);
  return { start: prevStart, end: prevEnd, label: rangeLabel(prevStart, addDays(prevEnd, -1)) };
}

export default function ReportScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const familyQ = useMyFamily();
  const switchRequest = useRef(0);
  const [switchingPending, setSwitching] = useState(false);
  const [switchFamilyId, setSwitchFamilyId] = useState<string | undefined>();
  const switching = switchingPending && switchFamilyId === familyQ.data?.id;
  const [pendingDimension, setPendingDimension] = useState<Dimension | null>(null);
  const [showSwitchMask, setShowSwitchMask] = useState(false);
  useEffect(() => {
    if (!switching) return;
    const timer = setTimeout(() => setShowSwitchMask(true), 200);
    return () => clearTimeout(timer);
  }, [switching, pendingDimension]);
  const [failedDimension, setFailedDimension] = useState<Dimension | null>(null);
  const networkAvailable = useNetworkAvailable();
  const wasNetworkAvailable = useRef(networkAvailable);
  useEffect(() => {
    if (!wasNetworkAvailable.current && networkAvailable) setFailedDimension(null);
    wasNetworkAvailable.current = networkAvailable;
  }, [networkAvailable]);
  useEffect(
    () => () => {
      switchRequest.current += 1;
    },
    [],
  );
  const palette = usePalette();
  const { locale } = useLocalePreference();
  const catColors = useCategoryColors();
  const insets = useSafeAreaInsets();
  // estimate 必须等于实测头高（paddingTop 6 + 按钮 44 + paddingBottom 10），否则裁切框（overflow:hidden）
  // 偏小会在首帧切掉标题底部。
  const { scrollRef, headerHeight, headerStyle, onHeaderLayout } = useCollapsibleHeader(insets.top + 60);
  const catsQ = useAllCategories();
  const layoutQ = useCategoryLayout();
  const hierarchy = useMemo(
    () => buildCategoryHierarchy(catsQ.data ?? [], layoutQ.data ?? []),
    [catsQ.data, layoutQ.data],
  );
  const membersQ = useFamilyMembers();
  const ledgerMembers = useMemo(() => {
    void locale;
    return (membersQ.data ?? []).map((member) => ({
      id: member.id,
      nickname: memberDisplayName(member.nickname, member.departed),
      avatarUrl: member.avatar_url,
    }));
  }, [membersQ.data, locale]);
  useEffect(
    () => () => {
      switchRequest.current += 1;
    },
    [familyQ.data?.id],
  );
  const profileQ = useMyProfile();
  const prefsQ = useAccountingPrefs();
  const savingsQ = useSavingsGoals();

  // 卡片显隐 / 排序 + 金额隐私（记账设置，个人级偏好）；行不存在回落默认。
  const prefs = prefsQ.data ?? DEFAULT_ACCOUNTING_PREFS;
  const privacy = prefsQ.data ? prefs.amount_privacy : true;

  const [dimension, setDimension] = useState<Dimension>('month');
  const [scope, setScope] = useState<ReportScope>('expense');
  const [clockMs, setClockMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClockMs(Date.now()), 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setClockMs(Date.now());
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  const todayKey = localDateKey(calendarDateInTimeZone(familyQ.data?.timezone, new Date(clockMs)));
  const todayInFamilyTimeZone = useMemo(() => {
    const [year, month, day] = todayKey.split('-').map(Number);
    return new Date(year, month - 1, day, 12);
  }, [todayKey]);
  const [anchorOverride, setAnchor] = useState<Date | null>(null);
  const anchor = anchorOverride ?? todayInFamilyTimeZone;
  const [filters, setFilters] = useState<ReportFilters>(EMPTY_FILTERS);
  const [filterOpenPending, setFilterOpen] = useState(false);
  const [filterFamilyId, setFilterFamilyId] = useState<string | undefined>();
  const filterOpen = filterOpenPending && filterFamilyId === familyQ.data?.id;
  const [filterDraft, setFilterDraft] = useState<ReportFilters>(EMPTY_FILTERS);
  const [filterPending, setFilterPending] = useState<'confirm' | 'reset' | null>(null);
  const [filterError, setFilterError] = useState(false);
  const filterAttempt = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      filterAttempt.current?.abort();
      filterAttempt.current = null;
    },
    [familyQ.data?.id],
  );
  const openFilter = () => {
    setFilterPending(null);
    setFilterFamilyId(familyQ.data?.id);
    setFilterDraft({ memberIds: [...filters.memberIds], categoryIds: [...filters.categoryIds] });
    setFilterError(false);
    setFilterOpen(true);
  };
  const closeFilter = () => {
    filterAttempt.current?.abort();
    filterAttempt.current = null;
    setFilterPending(null);
    setFilterError(false);
    setFilterOpen(false);
  };
  const [incomeTargets, setIncomeTargets] = useState<IncomeTargets>(DEFAULT_INCOME_TARGETS);
  const [incomeTargetOpen, setIncomeTargetOpen] = useState(false);
  const [customStartOverride, setCustomStart] = useState<Date | null>(null);
  const [customEndOverride, setCustomEnd] = useState<Date | null>(null);
  const defaultCustomEnd = useMemo(() => startOfLocalDay(todayInFamilyTimeZone), [todayInFamilyTimeZone]);
  const defaultCustomStart = useMemo(() => addDays(defaultCustomEnd, -29), [defaultCustomEnd]);
  const customEnd = customEndOverride ?? defaultCustomEnd;
  const customStart = customStartOverride ?? defaultCustomStart;
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
  const isCurrent = useMemo(() => {
    if (dimension !== 'custom') {
      return (
        periodRange(dimension, anchor).start.getTime() === periodRange(dimension, todayInFamilyTimeZone).start.getTime()
      );
    }
    const today = startOfLocalDay(todayInFamilyTimeZone);
    return range.start.getTime() <= today.getTime() && range.end.getTime() > today.getTime();
  }, [dimension, anchor, range, todayInFamilyTimeZone]);
  const todayStart = defaultCustomEnd;
  const futurePeriod = range.start.getTime() > todayStart.getTime();
  const availableEnd = useMemo(() => {
    const tomorrow = addDays(todayStart, 1);
    return isCurrent && range.end.getTime() > tomorrow.getTime() ? tomorrow : range.end;
  }, [isCurrent, range.end, todayStart]);
  const budgetPeriod = useMemo(() => currentPeriod(range.start), [range.start]);
  const isMonthlyView = dimension === 'month';
  const budgetQ = useBudget(budgetPeriod);
  const budgetProgressQ = useBudgetProgress(budgetPeriod, isMonthlyView && !futurePeriod);

  // 全家基准和专题分析分别查询；没有适用筛选时复用同一份全家数据。
  const familyInput = useMemo<ReportAnalyticsInput>(() => {
    const HISTORY_PERIODS = 6;
    let from: Date;
    if (dimension === 'custom') {
      const days = Math.max(1, calendarDayDifference(range.start, range.end));
      from = addDays(range.start, -(HISTORY_PERIODS - 1) * days);
    } else {
      from = periodRange(dimension, shiftAnchor(dimension, anchor, -(HISTORY_PERIODS - 1))).start;
    }
    return {
      start: localDateKey(range.start),
      end: localDateKey(availableEnd),
      previousStart: localDateKey(prevRange.start),
      historyStart: localDateKey(from),
      memberIds: [],
      categoryIds: [],
    };
  }, [dimension, anchor, range, prevRange, availableEnd]);
  const expenseCategoryIds = useMemo(
    () => categoryIdsForReportType(filters.categoryIds, catsQ.data ?? [], 'expense'),
    [filters.categoryIds, catsQ.data],
  );
  const incomeCategoryIds = useMemo(
    () => categoryIdsForReportType(filters.categoryIds, catsQ.data ?? [], 'income'),
    [filters.categoryIds, catsQ.data],
  );
  const expenseInput = useMemo(
    () => ({ ...familyInput, memberIds: filters.memberIds, categoryIds: expenseCategoryIds }),
    [familyInput, filters.memberIds, expenseCategoryIds],
  );
  const incomeInput = useMemo(
    () => ({ ...familyInput, memberIds: filters.memberIds, categoryIds: incomeCategoryIds }),
    [familyInput, filters.memberIds, incomeCategoryIds],
  );
  const hasExpenseFilters = filters.memberIds.length > 0 || expenseCategoryIds.length > 0;
  const hasIncomeFilters = filters.memberIds.length > 0 || incomeCategoryIds.length > 0;
  const prerequisitesReady = familyQ.data !== undefined && catsQ.data !== undefined;
  const reportQ = useReportAnalytics(familyInput, prerequisitesReady && !futurePeriod);
  const expenseQ = useReportAnalytics(
    expenseInput,
    prerequisitesReady && !futurePeriod && hasExpenseFilters && (scope === 'expense' || memberAnalysisOpen),
  );
  const incomeQ = useReportAnalytics(
    incomeInput,
    prerequisitesReady && !futurePeriod && hasIncomeFilters && (scope === 'income' || memberAnalysisOpen),
  );
  const switchDimension = async (next: Dimension) => {
    requestNetworkRecovery();
    const request = ++switchRequest.current;
    if (switching && next === dimension) {
      setSwitching(false);
      setShowSwitchMask(false);
      setPendingDimension(null);
      setFailedDimension(null);
      return;
    }
    if (next === 'custom') {
      setSwitching(false);
      setShowSwitchMask(false);
      setPendingDimension(null);
      setFailedDimension(null);
      setDimension(next);
      setCustomOpen(true);
      return;
    }
    setFailedDimension(null);
    setPendingDimension(next);
    setSwitchFamilyId(familyQ.data?.id);
    setShowSwitchMask(false);
    const nextRange = periodRange(next, todayInFamilyTimeZone);
    const previous = periodRange(next, shiftAnchor(next, todayInFamilyTimeZone, -1));
    const history = periodRange(next, shiftAnchor(next, todayInFamilyTimeZone, -5));
    const tomorrow = addDays(todayStart, 1);
    const input: ReportAnalyticsInput = {
      start: localDateKey(nextRange.start),
      end: localDateKey(nextRange.end.getTime() > tomorrow.getTime() ? tomorrow : nextRange.end),
      previousStart: localDateKey(previous.start),
      historyStart: localDateKey(history.start),
      memberIds: [],
      categoryIds: [],
    };
    const topicInput =
      scope === 'income'
        ? { ...input, memberIds: filters.memberIds, categoryIds: incomeCategoryIds }
        : { ...input, memberIds: filters.memberIds, categoryIds: expenseCategoryIds };
    const needsTopic = scope === 'income' ? hasIncomeFilters : scope === 'expense' && hasExpenseFilters;
    if (
      isOfflinePeriodUnavailable(
        isNetworkAvailable(),
        queryClient.getQueryData(queryKeys.reportAnalytics(input)),
        needsTopic,
        needsTopic ? queryClient.getQueryData(queryKeys.reportAnalytics(topicInput)) : undefined,
      )
    ) {
      setPendingDimension(null);
      setSwitching(false);
      setFailedDimension(next);
      return;
    }
    setSwitching(true);
    const load = (params: ReportAnalyticsInput) =>
      queryClient.ensureQueryData({
        queryKey: queryKeys.reportAnalytics(params),
        queryFn: () => fetchReportAnalytics(params),
        revalidateIfStale: true,
      });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([load(input), ...(needsTopic ? [load(topicInput)] : [])]),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Report request timed out')), 15000);
        }),
      ]);
      if (request !== switchRequest.current) return;
      setAnchor(todayInFamilyTimeZone);
      setDimension(next);
    } catch {
      if (request === switchRequest.current) setFailedDimension(next);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (request === switchRequest.current) {
        setSwitching(false);
        setShowSwitchMask(false);
        setPendingDimension(null);
      }
    }
  };
  const familyData = futurePeriod ? EMPTY_REPORT_ANALYTICS : reportQ.data;
  const expenseData = reportTopicData(familyData, expenseQ.data, !futurePeriod && hasExpenseFilters);
  const incomeData = reportTopicData(familyData, incomeQ.data, !futurePeriod && hasIncomeFilters);
  const reportData = scope === 'income' ? incomeData : expenseData;
  const analyticsInput = scope === 'income' ? incomeInput : expenseInput;
  const topicSelectionKey = JSON.stringify([
    analyticsInput.start,
    analyticsInput.end,
    analyticsInput.memberIds,
    analyticsInput.categoryIds,
  ]);
  const familySelectionKey = `${familyInput.start}:${familyInput.end}`;
  const topicQ = scope === 'income' ? incomeQ : expenseQ;
  const topicFiltersApplied = scope === 'income' ? hasIncomeFilters : hasExpenseFilters;
  const topicUnavailable = scope !== 'balance' && topicFiltersApplied && !reportData;
  const activeFilters = activeFilterCount(filters);
  const identityUnavailable = !isNetworkAvailable() || familyQ.isError || profileQ.isError;
  const reportLoadFailed =
    (!familyData && (reportQ.isError || (reportQ.fetchStatus === 'paused' && identityUnavailable))) ||
    (!familyQ.data && (familyQ.isError || familyQ.fetchStatus === 'paused')) ||
    (!catsQ.data && (catsQ.isError || (catsQ.fetchStatus === 'paused' && identityUnavailable))) ||
    (!layoutQ.data && (layoutQ.isError || (layoutQ.fetchStatus === 'paused' && identityUnavailable)));
  const filterUnavailable = !catsQ.data || !layoutQ.data;
  const hasRefreshError =
    (!futurePeriod && !!familyData && hasSettledRefreshFailure([reportQ])) ||
    (scope === 'expense' && hasExpenseFilters && !!expenseData && hasSettledRefreshFailure([expenseQ])) ||
    (scope === 'income' && hasIncomeFilters && !!incomeData && hasSettledRefreshFailure([incomeQ])) ||
    (dimension === 'month' && !!budgetQ.data && hasSettledRefreshFailure([budgetQ])) ||
    (dimension === 'month' && !!budgetProgressQ.data && hasSettledRefreshFailure([budgetProgressQ])) ||
    (!!savingsQ.data && hasSettledRefreshFailure([savingsQ]));

  const comparison = useMemo(
    () => comparablePeriods(range, prevRange, todayInFamilyTimeZone),
    [range, prevRange, todayInFamilyTimeZone],
  );
  const comparisonLabel = comparison
    ? t('report.comparisonRanges', {
        current: rangeLabel(comparison.current.start, addDays(comparison.current.end, -1)),
        previous: rangeLabel(comparison.previous.start, addDays(comparison.previous.end, -1)),
        currentDays: calendarDayDifference(comparison.current.start, comparison.current.end),
        previousDays: calendarDayDifference(comparison.previous.start, comparison.previous.end),
      })
    : null;
  const familyComparison: FamilyComparison | null =
    comparison && comparisonLabel && familyData
      ? {
          label: comparisonLabel,
          shortLabel: reportComparisonRangeLabel(
            comparison.current.start,
            addDays(comparison.current.end, -1),
            todayInFamilyTimeZone,
            intlLocale(),
          ),
          inProgress: comparison.inProgress,
          currentValues: reportPeriodCashFlow(
            familyData.days,
            localDateKey(comparison.current.start),
            localDateKey(comparison.current.end),
          ),
          previousValues: reportPeriodCashFlow(
            familyData.days,
            localDateKey(comparison.previous.start),
            localDateKey(comparison.previous.end),
          ),
        }
      : null;
  const comparisonVisible =
    scope === 'expense' &&
    resolveScopeCardLayout(scope, prefs.report_card_order, prefs.report_card_hidden).visible.includes('category_mom');
  const currentComparisonInput: ReportAnalyticsInput = comparison
    ? {
        ...expenseInput,
        start: localDateKey(comparison.current.start),
        end: localDateKey(comparison.current.end),
        historyStart: localDateKey(comparison.current.start),
      }
    : expenseInput;
  const previousComparisonInput: ReportAnalyticsInput = comparison
    ? {
        ...expenseInput,
        start: localDateKey(comparison.previous.start),
        end: localDateKey(comparison.previous.end),
        previousStart: localDateKey(addDays(comparison.previous.start, -1)),
        historyStart: localDateKey(comparison.previous.start),
      }
    : expenseInput;
  const fetchPartialComparison =
    prerequisitesReady && !futurePeriod && !filterOpen && comparisonVisible && !!comparison?.inProgress;
  const currentComparisonQ = useReportAnalytics(currentComparisonInput, fetchPartialComparison);
  const previousComparisonQ = useReportAnalytics(previousComparisonInput, fetchPartialComparison);

  const submitFilter = async (action: 'confirm' | 'reset') => {
    if (filterAttempt.current) return;
    const next = action === 'reset' ? EMPTY_FILTERS : filterDraft;
    if (action === 'reset') setFilterDraft(EMPTY_FILTERS);
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));
    if (same(next.memberIds, filters.memberIds) && same(next.categoryIds, filters.categoryIds)) {
      closeFilter();
      return;
    }
    const controller = new AbortController();
    filterAttempt.current = controller;
    setFilterError(false);
    setFilterPending(action);
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const selectedCategories = categoryIdsForReportType(
        next.categoryIds,
        catsQ.data ?? [],
        scope === 'income' ? 'income' : 'expense',
      );
      const input = { ...familyInput, memberIds: next.memberIds, categoryIds: selectedCategories };
      const currentCategories = scope === 'income' ? incomeCategoryIds : expenseCategoryIds;
      const topicChanged = !same(next.memberIds, filters.memberIds) || !same(selectedCategories, currentCategories);
      const requests = filterRequests(input, {
        changed: topicChanged,
        future: futurePeriod,
        scope,
        comparisonVisible,
        comparisonInProgress: !!comparison?.inProgress,
        currentComparison: currentComparisonInput,
        previousComparison: previousComparisonInput,
      });
      const results = await prepareFilterResults(
        requests,
        async (params) => {
          const key = queryKeys.reportAnalytics(params);
          const state = queryClient.getQueryState<ReportAnalytics>(key);
          if (
            state?.data &&
            !state.isInvalidated &&
            (!isNetworkAvailable() || Date.now() - state.dataUpdatedAt < 30_000)
          ) {
            return { key, data: state.data, cached: true };
          }
          if (!isNetworkAvailable()) throw new Error('Offline');
          return { key, data: await fetchReportAnalytics(params, controller.signal), cached: false };
        },
        controller.signal,
      );
      if (filterAttempt.current !== controller) return;
      if (controller.signal.aborted) throw new Error('Timed out');
      results.forEach(({ key, data, cached }) => {
        if (!cached) queryClient.setQueryData(key, data);
      });
      setFilters(next);
      filterAttempt.current = null;
      setFilterPending(null);
      setFilterOpen(false);
    } catch {
      if (filterAttempt.current === controller) {
        controller.abort();
        filterAttempt.current = null;
        setFilterPending(null);
        setFilterError(true);
      }
    } finally {
      clearTimeout(timer);
    }
  };

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
    familyByCat,
    familyExpenseTotal,
    familyTopItems,
    budgetTopCategory,
    normalIncome,
    goalWithdrawals,
    goalDeposits,
    members,
    balRate,
    incomeExpense,
    topicIncomeExpense,
    momItems,
    topItems,
    incomeSlices,
    passiveIncome,
  } = useMemo(() => {
    void locale;
    const analytics = reportData;
    const family = familyData ?? EMPTY_REPORT_ANALYTICS;
    const cats = catsQ.data ?? [];
    const mem = membersQ.data ?? [];
    const catById = new Map(cats.map((c) => [c.id, c]));
    const myId = profileQ.data?.id;
    const uncategorized = t('common.uncategorized');
    const otherIncome = t('categories.otherIncome');
    const memberFallback = t('common.member');
    const memberNameById = new Map(
      mem.map((member) => [member.id, memberDisplayName(member.nickname, member.departed)]),
    );
    const memberById = new Map(mem.map((member) => [member.id, member]));
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

    const categorySlices = (items: ReportAnalytics['expenseCategories']) =>
      items
        .filter(({ currentAmount }) => currentAmount > 0)
        .map(({ categoryId, currentAmount }) => ({
          id: categoryId,
          ...catDisplay(categoryId, 'expense'),
          amount: currentAmount,
        }));
    const list = categorySlices(analytics?.expenseCategories ?? []);
    const wholeFamilyCategories = categorySlices(family.expenseCategories);
    const budgetCategories = [...(budgetProgressQ.data?.byCategory ?? new Map<string, number>())]
      .map(([categoryId, amount]) => ({ id: categoryId, ...catDisplay(categoryId, 'expense'), amount }))
      .sort((a, b) => b.amount - a.amount);
    const comparisonCurrent = comparison?.inProgress
      ? (currentComparisonQ.data?.expenseCategories ?? [])
      : (expenseData?.expenseCategories ?? []);
    const comparisonPrevious = comparison?.inProgress
      ? (previousComparisonQ.data?.expenseCategories ?? [])
      : (expenseData?.expenseCategories ?? []).map((item) => ({
          categoryId: item.categoryId,
          currentAmount: item.previousAmount,
        }));
    const mom = categoryChanges(comparisonCurrent, comparisonPrevious).map(
      ({ categoryId, currentAmount, previousAmount }) => ({
        id: categoryId,
        ...catDisplay(categoryId, 'expense'),
        cur: currentAmount,
        prev: previousAmount,
      }),
    );
    const dailyFlows = reportDayFlows(family.days, false);
    const topicFlows = reportDayFlows(analytics?.days ?? [], true);
    const incomeSlices = (analytics?.incomeCategories ?? []).map(({ categoryId, amount }) => ({
      id: categoryId,
      ...catDisplay(categoryId, 'income'),
      amount,
    }));
    const expenseItems = (items: ReportAnalytics['topExpenses']) =>
      items.map((item) => ({
        id: item.id,
        note: item.note ?? '',
        category: catDisplay(item.categoryId, 'expense').name,
        color: catDisplay(item.categoryId, 'expense').color,
        symbol: catDisplay(item.categoryId, 'expense').symbol,
        amount: item.amount,
        date: new Intl.DateTimeFormat(intlLocale(), {
          month: 'numeric',
          day: 'numeric',
          timeZone: familyQ.data?.timezone ?? undefined,
        }).format(new Date(item.occurredAt)),
      }));
    const topItems = expenseItems(analytics?.topExpenses ?? []);
    const memberRows = (analytics?.members ?? []).map((item) => ({
      id: item.userId,
      name: memberNameById.get(item.userId) ?? memberFallback,
      avatarName: memberById.get(item.userId)?.nickname ?? memberFallback,
      avatarUrl: memberById.get(item.userId)?.avatar_url ?? null,
      amount: item.expenseNormalAmount,
      count: item.count,
    }));
    const totals = reportAccountingTotals(family.summary, family.days, familyInput.start, familyInput.end);
    const passiveInc = family.incomeCategoryChildren.reduce(
      (total, item) =>
        total +
        (isPassiveIncomeName(catById.get(item.categoryId)?.name ?? '') ||
        isPassiveIncomeName(catById.get(item.parentId)?.name ?? '')
          ? item.amount
          : 0),
      0,
    );

    return {
      income: totals.income,
      expense: totals.expense,
      balance: totals.balance,
      byCat: list,
      expenseTotal: analytics?.summary.expenseNormalAmount ?? 0,
      familyByCat: wholeFamilyCategories,
      familyExpenseTotal: totals.normalExpense,
      familyTopItems: expenseItems(family.topExpenses),
      budgetTopCategory: budgetCategories[0] ?? null,
      normalIncome: totals.normalIncome,
      goalWithdrawals: totals.goalWithdrawals,
      goalDeposits: totals.goalDeposits,
      members: memberRows,
      balRate: balanceRate(totals.income, totals.balance),
      // 近 6 期收支（对账口径，含储蓄类）：区间跨度超出本期/上期，传全量流水单独分桶。
      incomeExpense:
        dimension === 'custom'
          ? equalPeriodIncomeExpenseSeries(range, dailyFlows)
          : incomeExpenseSeries(dimension, range.start, dailyFlows),
      topicIncomeExpense:
        dimension === 'custom'
          ? equalPeriodIncomeExpenseSeries(range, topicFlows)
          : incomeExpenseSeries(dimension, range.start, topicFlows),
      momItems: mom,
      topItems,
      incomeSlices,
      passiveIncome: passiveInc,
    };
  }, [
    reportData,
    familyData,
    familyQ.data?.timezone,
    familyInput.start,
    familyInput.end,
    budgetProgressQ.data,
    expenseData,
    comparison,
    currentComparisonQ.data,
    previousComparisonQ.data,
    catsQ.data,
    membersQ.data,
    profileQ.data,
    range,
    dimension,
    catColors,
    locale,
  ]);

  const loading =
    reportQ.isLoading ||
    familyQ.isLoading ||
    catsQ.isLoading ||
    layoutQ.isLoading ||
    (isNetworkAvailable() && !familyData && reportQ.isPending && !reportLoadFailed);
  const memberCountMax = Math.max(1, ...members.map((m) => m.count));
  const currentMonthRange = useMemo(() => periodRange('month', todayInFamilyTimeZone), [todayInFamilyTimeZone]);
  const selectedMonthIsCurrent = dimension === 'month' && range.start.getTime() === currentMonthRange.start.getTime();
  const monthElapsedDays = selectedMonthIsCurrent
    ? Math.max(1, calendarDayDifference(range.start, todayInFamilyTimeZone) + 1)
    : null;
  const monthTotalDays = dimension === 'month' ? Math.max(1, calendarDayDifference(range.start, range.end)) : 0;
  const familyBudgetUsed = budgetProgressQ.data?.usedAmount ?? 0;
  const { scopeDiffers: budgetScopeDiffers, projected: projectedExpense } = reportBudgetForecast({
    budgetUsed: budgetProgressQ.data?.usedAmount ?? null,
    budgetTotal: budgetQ.data?.budget?.total_amount ?? null,
    observedExpense: familyExpenseTotal,
    elapsedDays: monthElapsedDays,
    totalDays: monthTotalDays,
    isCurrent: selectedMonthIsCurrent,
  });
  const projectedIncome = projectionForRange(income, range, isCurrent, todayInFamilyTimeZone);
  const incomeTarget = targetForDimension(incomeTargets, dimension);
  const activeIncome = Math.max(0, normalIncome - passiveIncome);
  const periodText = isCurrent ? periodName(dimension) : range.label;
  const customToolbarEnd = dimension === 'custom' ? addDays(range.end, -1) : range.start;
  const scopeLayout = resolveScopeCardLayout(scope, prefs.report_card_order, prefs.report_card_hidden);
  const cardOrder = scopeLayout.visible;
  const hiddenCards = scopeLayout.hidden;
  const openCardSettings = () => router.push('/settings/report-cards' as Href);
  const shiftPeriod = (delta: number) => {
    if (dimension !== 'custom') {
      setAnchor((a) => shiftAnchor(dimension, a ?? todayInFamilyTimeZone, delta));
      return;
    }
    const days = Math.max(1, calendarDayDifference(range.start, range.end));
    setCustomStart((d) => {
      const base = d ?? customStart;
      const next = new Date(base);
      next.setDate(base.getDate() + delta * days);
      return next;
    });
    setCustomEnd((d) => {
      const base = d ?? customEnd;
      const next = new Date(base);
      next.setDate(base.getDate() + delta * days);
      return next;
    });
  };

  const insightPending = (isMonthlyView && (!budgetQ.data || !budgetProgressQ.data)) || !savingsQ.data;
  const insightFailed =
    (isMonthlyView && !budgetQ.data && (budgetQ.isError || budgetQ.fetchStatus === 'paused')) ||
    (isMonthlyView && !budgetProgressQ.data && (budgetProgressQ.isError || budgetProgressQ.fetchStatus === 'paused')) ||
    (!savingsQ.data && (savingsQ.isError || savingsQ.fetchStatus === 'paused'));
  const selectedCategoryIds = scope === 'income' ? incomeCategoryIds : expenseCategoryIds;
  const scopeParts: string[] = [];
  if (filters.memberIds.length > 0) {
    const names = filters.memberIds.map(
      (id) => ledgerMembers.find((member) => member.id === id)?.nickname ?? t('common.member'),
    );
    scopeParts.push(`${t('report.filterMembers')}：${names.join('、')}`);
  }
  if (selectedCategoryIds.length > 0) {
    const names = selectedCategoryIds.map((id) => {
      const category = hierarchy.byId.get(id);
      return category ? displayCategoryName(category.name, category.is_system) : t('common.uncategorized');
    });
    scopeParts.push(
      `${t(scope === 'income' ? 'report.filterIncomeCats' : 'report.filterExpenseCats')}：${names.join('、')}`,
    );
  }
  const topicScopeText =
    scopeParts.length > 0
      ? t('report.filteredScope', { filters: scopeParts.join(' · ') })
      : t('report.unfilteredScope');
  const selectedFilterMembers = filters.memberIds.map(
    (id) => ledgerMembers.find((member) => member.id === id) ?? { id, nickname: t('common.member'), avatarUrl: null },
  );
  const filterDescriptionParts: string[] = [];
  if (selectedFilterMembers.length > 0)
    filterDescriptionParts.push(
      `${t('report.filterMembers')}：${selectedFilterMembers.map((member) => member.nickname).join('、')}`,
    );
  if (filters.categoryIds.length > 0)
    filterDescriptionParts.push(
      `${t('report.filterCategories')}：${filters.categoryIds
        .map((id) => {
          const category = hierarchy.byId.get(id);
          return category ? displayCategoryName(category.name, category.is_system) : t('common.uncategorized');
        })
        .join('、')}`,
    );
  const filterDescription =
    activeFilters > 0
      ? t('report.filterSelectionA11y', { count: activeFilters, filters: filterDescriptionParts.join('；') })
      : t('report.filterInactiveA11y');
  const topicHeader = (title: string, details?: ReactNode) => <ReportCardHeader title={title} details={details} />;
  const comparisonPending = fetchPartialComparison && (!currentComparisonQ.data || !previousComparisonQ.data);
  const comparisonFailed =
    fetchPartialComparison &&
    (currentComparisonQ.isError ||
      previousComparisonQ.isError ||
      currentComparisonQ.fetchStatus === 'paused' ||
      previousComparisonQ.fetchStatus === 'paused');
  const commonInsightCard = insightPending ? (
    <ReportInlineStatus
      palette={palette}
      onRetry={
        insightFailed
          ? () => {
              if (isMonthlyView && !budgetQ.data) void budgetQ.refetch();
              if (isMonthlyView && !budgetProgressQ.data) void budgetProgressQ.refetch();
              if (!savingsQ.data) void savingsQ.refetch();
            }
          : undefined
      }
    />
  ) : (
    <FinancialInsightsCard
      income={income}
      expense={expense}
      expenseTotal={familyExpenseTotal}
      projectedExpense={projectedExpense}
      projectedIncome={projectedIncome}
      budgetScopeDiffers={budgetScopeDiffers}
      budgetTotal={budgetQ.data?.budget?.total_amount ?? null}
      topCategory={familyByCat[0] ?? null}
      topExpense={familyTopItems[0] ?? null}
      goals={savingsQ.data ?? []}
      incomeTarget={incomeTarget}
      palette={palette}
      hidden={privacy}
      onPress={() => setInsightsOpen(true)}
    />
  );
  const commonStatsCard = (
    <MoreStatsEntryCard
      days={reportData?.days ?? []}
      range={range}
      today={todayInFamilyTimeZone}
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
        todayLabel={new Intl.DateTimeFormat(intlLocale(), { month: 'numeric', day: 'numeric' }).format(
          todayInFamilyTimeZone,
        )}
        currentPeriod={isCurrent}
        futurePeriod={futurePeriod}
        comparison={familyComparison}
        palette={palette}
        hidden={privacy}
      />
    ),
    ...(isMonthlyView
      ? {
          budget:
            !budgetQ.data || !budgetProgressQ.data ? (
              <ReportInlineStatus
                palette={palette}
                onRetry={
                  budgetQ.isError ||
                  budgetQ.fetchStatus === 'paused' ||
                  budgetProgressQ.isError ||
                  budgetProgressQ.fetchStatus === 'paused'
                    ? () => {
                        if (!budgetQ.data) void budgetQ.refetch();
                        if (!budgetProgressQ.data) void budgetProgressQ.refetch();
                      }
                    : undefined
                }
              />
            ) : (
              <MonthlyBudgetCard
                title={t('report.familyBudget')}
                total={budgetQ.data?.budget?.total_amount ?? null}
                used={familyBudgetUsed}
                topCategory={budgetTopCategory}
                scopeDiffers={budgetScopeDiffers}
                projected={projectedExpense}
                palette={palette}
                hidden={privacy}
                onOpen={selectedMonthIsCurrent ? () => setBudgetOpen(true) : undefined}
              />
            ),
        }
      : {}),
    insights: commonInsightCard,
    expense_trend: (
      <MonthlyExpenseTrendCard
        scopeDescription={topicScopeText}
        key={topicSelectionKey}
        series={topicIncomeExpense}
        palette={palette}
        hidden={privacy}
        currentPeriod={isCurrent}
      />
    ),
    expense_category: (
      <MonthlyExpenseCategoryCard
        key={topicSelectionKey}
        categories={byCat}
        total={expenseTotal}
        palette={palette}
        hidden={privacy}
        onOpenDetail={setDetail}
        emptyText={
          topicFiltersApplied
            ? t('report.emptyTopicExpense')
            : isMonthlyView
              ? t('report.emptyMonthExpense')
              : t('report.emptyPeriodExpense')
        }
      />
    ),
    category_mom: (
      <CategoryMomCard
        header={topicHeader(
          t('report.categoryMom'),
          <>
            <ReportDetailText>{comparisonLabel ?? t('report.noComparableData')}</ReportDetailText>
            {comparison?.inProgress ? <ReportDetailText>{t('report.comparisonPartialHint')}</ReportDetailText> : null}
            <ReportDetailText>{topicScopeText}</ReportDetailText>
          </>,
        )}
        items={momItems.slice(0, 5)}
        palette={palette}
        hidden={privacy}
        comparisonLabel={comparisonLabel}
        inProgress={comparison?.inProgress ?? isCurrent}
        loading={fetchPartialComparison && (!currentComparisonQ.data || !previousComparisonQ.data)}
        failed={
          fetchPartialComparison &&
          (currentComparisonQ.isError ||
            previousComparisonQ.isError ||
            currentComparisonQ.fetchStatus === 'paused' ||
            previousComparisonQ.fetchStatus === 'paused')
        }
        onRetry={() => {
          void currentComparisonQ.refetch();
          void previousComparisonQ.refetch();
        }}
      />
    ),
    top_expenses: (
      <TopExpensesCard
        header={topicHeader(t('report.topExpenses'))}
        items={topItems}
        palette={palette}
        hidden={privacy}
      />
    ),
    member: (
      <MonthlyMemberCard
        header={topicHeader(t('report.memberAnalysis'))}
        members={members}
        maxCount={memberCountMax}
        periodText={periodText}
        palette={palette}
        hidden={privacy}
        onOpen={() => setMemberAnalysisOpen(true)}
      />
    ),
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
        todayLabel={new Intl.DateTimeFormat(intlLocale(), { month: 'numeric', day: 'numeric' }).format(
          todayInFamilyTimeZone,
        )}
        currentPeriod={isCurrent}
        futurePeriod={futurePeriod}
        comparison={familyComparison}
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
    income_trend: (
      <MonthlyIncomeTrendCard
        scopeDescription={topicScopeText}
        key={topicSelectionKey}
        series={topicIncomeExpense}
        palette={palette}
        hidden={privacy}
        currentPeriod={isCurrent}
      />
    ),
    income_structure: (
      <IncomeStructureCard
        header={topicHeader(t('report.incomeStructure'))}
        key={topicSelectionKey}
        slices={incomeSlices}
        palette={palette}
        hidden={privacy}
        onOpenCategory={(item) => setDetail({ id: item.id, name: item.name, type: 'income' })}
      />
    ),
    more_stats: null,
  };

  const balanceCards: Partial<Record<ReportCardId, ReactNode>> = {
    overview: (
      <MonthlyBalanceOverviewCard
        income={income}
        expense={expense}
        balance={balance}
        rate={balRate}
        periodText={periodText}
        todayLabel={new Intl.DateTimeFormat(intlLocale(), { month: 'numeric', day: 'numeric' }).format(
          todayInFamilyTimeZone,
        )}
        currentPeriod={isCurrent}
        futurePeriod={futurePeriod}
        comparison={familyComparison}
        palette={palette}
        hidden={privacy}
      />
    ),
    insights: commonInsightCard,
    income_expense: (
      <IncomeExpenseCard
        key={familySelectionKey}
        series={incomeExpense}
        palette={palette}
        hidden={privacy}
        currentPeriod={isCurrent}
      />
    ),
    balance_waterfall: (
      <BalanceWaterfallCard
        normalIncome={normalIncome}
        normalExpense={familyExpenseTotal}
        goalWithdrawals={goalWithdrawals}
        goalDeposits={goalDeposits}
        balance={balance}
        categories={familyByCat}
        palette={palette}
        hidden={privacy}
      />
    ),
    savings_rate: (
      <SavingsRateTrendCard
        key={familySelectionKey}
        series={incomeExpense}
        palette={palette}
        currentPeriod={isCurrent}
      />
    ),
    savings_goals: (
      <SavingsGoalsCard
        goals={savingsQ.data ?? []}
        loading={savingsQ.isLoading}
        failed={!savingsQ.data && (savingsQ.isError || savingsQ.fetchStatus === 'paused')}
        onRetry={() => void savingsQ.refetch()}
        palette={palette}
        hidden={privacy}
        onOpen={() => setSavingsOpen(true)}
      />
    ),
    more_stats: null,
  };
  const scopeCards = scope === 'expense' ? expenseCards : scope === 'income' ? incomeCards : balanceCards;
  const topicCardIds: ReportCardId[] =
    scope === 'expense'
      ? ['expense_trend', 'expense_category', 'category_mom', 'top_expenses', 'member', 'more_stats']
      : scope === 'income'
        ? ['income_trend', 'income_structure']
        : [];
  const firstTopicCard = cardOrder.find((id) => topicCardIds.includes(id));
  const compactIds = new Set<ReportCardId>();
  if (!topicUnavailable && reportData && !futurePeriod) {
    if (scope === 'expense') {
      if (byCat.length === 0) compactIds.add('expense_category');
      if (topItems.length === 0) compactIds.add('top_expenses');
      if (members.length === 0) compactIds.add('member');
      if (byCat.length === 0) compactIds.add('more_stats');
      if (comparison && !comparisonPending && !comparisonFailed && momItems.every((item) => item.cur === 0))
        compactIds.add('category_mom');
    } else if (scope === 'income' && incomeSlices.length === 0) compactIds.add('income_structure');
  }
  const renderedCards = compactReportCards(cardOrder, compactIds).map((block) => {
    if (block.kind === 'empty') {
      const showPrevious = block.ids.includes('category_mom') && momItems.some((item) => item.prev > 0);
      return (
        <ReportEmptyGroup
          key={block.ids[0]}
          title={
            scope === 'income'
              ? t('report.emptyTopicIncome')
              : byCat.length === 0
                ? t('report.emptyTopicExpense')
                : block.ids.includes('category_mom')
                  ? t('report.emptyComparisonExpense')
                  : t('report.noMemberRecords', { period: periodText })
          }
          onAdjust={topicFiltersApplied ? openFilter : undefined}
        >
          {showPrevious ? (
            <ReportDisclosure
              label={t('report.previousCategories')}
              value={t('report.categoryCount', { count: momItems.filter((item) => item.prev > 0).length })}
              title={t('report.previousCategories')}
            >
              <ReportDetailText>{comparisonLabel}</ReportDetailText>
              {comparison?.inProgress ? <ReportDetailText>{t('report.comparisonPartialHint')}</ReportDetailText> : null}
              <ReportDetailText>{topicScopeText}</ReportDetailText>
              {momItems
                .filter((item) => item.prev > 0)
                .map((item) => (
                  <ReportDetailText key={item.id}>
                    {item.name} · {maskAmount(formatAmount(item.prev, '-'), privacy)}
                  </ReportDetailText>
                ))}
            </ReportDisclosure>
          ) : null}
          {block.ids.includes('more_stats') ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setMoreStatsOpen(true)}
              style={({ pressed }) => [styles.compactStats, { opacity: pressed ? 0.65 : 1 }]}
            >
              <Text style={{ color: palette.textPrimary }}>{t('report.moreStats')}</Text>
              <SymbolView name="chevron.right" size={13} tintColor={palette.textSecondary} />
            </Pressable>
          ) : null}
        </ReportEmptyGroup>
      );
    }
    const id = block.id;
    if (futurePeriod && id !== 'overview' && id !== 'savings_goals') return null;
    const isTopic = topicCardIds.includes(id);
    if (isTopic && topicUnavailable) {
      if (id !== firstTopicCard) return null;
      return (
        <ReportInlineStatus
          key="topic-status"
          palette={palette}
          onRetry={topicQ.isError || topicQ.fetchStatus === 'paused' ? () => void topicQ.refetch() : undefined}
        />
      );
    }
    const card = scopeCards[id];
    return card ? <View key={id}>{card}</View> : null;
  });

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <View style={styles.flex}>
        {reportLoadFailed ? (
          <ReportLoadErrorState
            palette={palette}
            message={!isNetworkAvailable() ? t('common.noCachedData') : undefined}
            onRetry={async () => {
              if (!(await requestNetworkRecovery())) return;
              if (!onlineManager.isOnline() || familyQ.isError || profileQ.isError) {
                await Promise.allSettled([
                  familyQ.refetch({ cancelRefetch: false }),
                  profileQ.refetch({ cancelRefetch: false }),
                ]);
              }
              if (!onlineManager.isOnline()) return;
              await Promise.allSettled([
                reportQ.refetch({ cancelRefetch: false }),
                catsQ.refetch({ cancelRefetch: false }),
                layoutQ.refetch({ cancelRefetch: false }),
              ]);
            }}
          />
        ) : (
          <Animated.ScrollView
            ref={scrollRef}
            scrollEventThrottle={16}
            contentContainerStyle={[styles.content, { paddingTop: headerHeight + Space[2] }]}
            scrollIndicatorInsets={{ top: headerHeight, bottom: TabBarInset }}
          >
            {/* 报表主视角：先把信息架构固定为支出 / 收入 / 结余。 */}
            <View pointerEvents={switching || loading ? 'none' : 'auto'}>
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
            </View>
            {/* 周期 + 维度切换：压成一行，减少报表顶部控件高度。 */}
            <View style={styles.periodControlRow}>
              <View style={styles.periodBar}>
                <Pressable hitSlop={10} disabled={switching || loading} onPress={() => shiftPeriod(-1)}>
                  <SymbolView name="chevron.left" tintColor={palette.textSecondary} size={18} />
                </Pressable>
                <Pressable
                  disabled={dimension !== 'custom' || switching || loading}
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
                <Pressable hitSlop={10} onPress={() => shiftPeriod(1)} disabled={isCurrent || switching || loading}>
                  <SymbolView
                    name="chevron.right"
                    tintColor={isCurrent ? palette.textTertiary : palette.textSecondary}
                    size={18}
                  />
                </Pressable>
              </View>
              <View style={styles.dimensionSegmentFrame} pointerEvents={loading ? 'none' : 'auto'}>
                <Host key={locale} ignoreSafeArea="all" style={styles.dimensionSegmentHost}>
                  <Picker
                    modifiers={[pickerStyle('segmented')]}
                    selection={switching ? (pendingDimension ?? dimension) : dimension}
                    onSelectionChange={(value) => {
                      const next = value as Dimension;
                      void switchDimension(next);
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

            {failedDimension && switchFamilyId === familyQ.data?.id ? (
              <View
                style={[styles.card, { backgroundColor: palette.card, gap: Space[2] }]}
                accessibilityLiveRegion="polite"
              >
                <ThemedText style={{ color: palette.textPrimary }}>
                  {networkAvailable
                    ? t('report.periodSwitchFailed', {
                        target: reportPeriodName(failedDimension),
                        current: reportPeriodName(dimension),
                      })
                    : `${t('common.noCachedData')} · ${t('report.showingPeriod', { period: reportPeriodName(dimension) })}`}
                </ThemedText>
                <View style={{ flexDirection: 'row', gap: Space[4] }}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void switchDimension(failedDimension)}
                    style={styles.switchAction}
                  >
                    <Text style={{ color: palette.accent }}>{t('common.retry')}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setFailedDimension(null)}
                    style={styles.switchAction}
                  >
                    <Text style={{ color: palette.textSecondary }}>{t('report.keepCurrentPeriod')}</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            {loading ? (
              <View
                style={styles.reportSkeleton}
                accessibilityLabel={t('common.loading')}
                accessibilityRole="progressbar"
              >
                {[150, 110, 210].map((height, index) => (
                  <View key={index} style={{ height, borderRadius: Radius.lg, backgroundColor: palette.card }} />
                ))}
              </View>
            ) : (
              <View>
                <View
                  pointerEvents={switching ? 'none' : 'auto'}
                  accessibilityElementsHidden={switching}
                  importantForAccessibility={switching ? 'no-hide-descendants' : 'auto'}
                  style={{ gap: Space[4] }}
                >
                  {hasRefreshError ? (
                    <Pressable
                      style={[styles.card, styles.inlineStatus, { backgroundColor: palette.card }]}
                      accessibilityRole="button"
                      onPress={() => {
                        if (reportQ.isError && !futurePeriod) void reportQ.refetch();
                        if (scope === 'expense' && expenseQ.isError && hasExpenseFilters) void expenseQ.refetch();
                        if (scope === 'income' && incomeQ.isError && hasIncomeFilters) void incomeQ.refetch();
                        if (dimension === 'month' && budgetQ.isError) void budgetQ.refetch();
                        if (dimension === 'month' && budgetProgressQ.isError) void budgetProgressQ.refetch();
                        if (savingsQ.isError) void savingsQ.refetch();
                      }}
                    >
                      <ThemedText style={{ color: palette.textSecondary }}>
                        {t('report.refreshFailedCached')}
                      </ThemedText>
                      <ThemedText style={{ color: palette.accent }}>{t('common.retry')}</ThemedText>
                    </Pressable>
                  ) : null}

                  {familyData && familyData.summary.transactionCount > 0 && familyData.summary.transactionCount < 3 ? (
                    <ReportDataReadinessCard count={familyData.summary.transactionCount} palette={palette} />
                  ) : null}
                  {renderedCards}
                  {addCardEntry}
                </View>
                {switching ? (
                  <View
                    style={[StyleSheet.absoluteFill, styles.switchOverlay]}
                    accessibilityRole="progressbar"
                    accessibilityLabel={t('report.periodSwitchLoading', {
                      target: reportPeriodName(pendingDimension ?? dimension),
                      current: reportPeriodName(dimension),
                    })}
                  >
                    {showSwitchMask ? (
                      <>
                        <View style={[StyleSheet.absoluteFill, { backgroundColor: palette.base, opacity: 0.55 }]} />
                        <View style={[styles.switchStatus, { backgroundColor: palette.card }]}>
                          <ActivityIndicator color={palette.accent} />
                          <View>
                            <Text style={{ color: palette.textPrimary, fontWeight: '600' }}>
                              {t('report.loadingPeriod', {
                                period: reportPeriodName(pendingDimension ?? dimension),
                              })}
                            </Text>
                            <Text style={{ color: palette.textSecondary }}>
                              {t('report.showingPeriod', {
                                period: reportPeriodName(dimension),
                              })}
                            </Text>
                          </View>
                        </View>
                      </>
                    ) : null}
                  </View>
                ) : null}
              </View>
            )}
          </Animated.ScrollView>
        )}

        {/* 标题：绝对覆盖层，随滚动上移淡出 */}
        <View style={[styles.headerClip, { height: headerHeight }]} pointerEvents="box-none">
          <Animated.View
            style={[styles.header, { backgroundColor: palette.base, paddingTop: insets.top + Space[2] }, headerStyle]}
            onLayout={onHeaderLayout}
          >
            <ThemedText style={[styles.title, { color: palette.textPrimary }]}>{t('tabs.report')}</ThemedText>
            <ReportFilterButton
              members={selectedFilterMembers}
              filterCount={activeFilters}
              description={filterDescription}
              disabled={filterUnavailable || switching}
              onPress={openFilter}
            />
          </Animated.View>
        </View>
      </View>

      {/* 分类流水明细下钻 */}
      <CategoryDetailSheet
        key={detail?.id ?? 'closed'}
        detail={detail}
        hierarchy={hierarchy}
        analytics={reportData ?? EMPTY_REPORT_ANALYTICS}
        range={range}
        today={todayInFamilyTimeZone}
        familyTimeZone={familyQ.data?.timezone ?? undefined}
        dimension={dimension}
        analyticsInput={analyticsInput}
        totalExpense={expenseTotal}
        totalIncome={incomeSlices.reduce((sum, item) => sum + item.amount, 0)}
        hidden={privacy}
        onClose={() => setDetail(null)}
      />
      <MemberAnalysisSheet
        visible={memberAnalysisOpen}
        periodText={periodText}
        analytics={expenseData ?? null}
        incomeAnalytics={incomeData ?? null}
        failed={
          (!expenseData && (expenseQ.isError || expenseQ.fetchStatus === 'paused')) ||
          (!incomeData && (incomeQ.isError || incomeQ.fetchStatus === 'paused'))
        }
        onRetry={() => {
          if (!expenseData) void expenseQ.refetch();
          if (!incomeData) void incomeQ.refetch();
        }}
        members={
          filters.memberIds.length > 0
            ? ledgerMembers.filter((member) => filters.memberIds.includes(member.id))
            : ledgerMembers
        }
        categories={catsQ.data ?? []}
        hidden={privacy}
        onClose={() => setMemberAnalysisOpen(false)}
      />
      <FinancialInsightsDetailSheet
        visible={insightsOpen}
        income={income}
        expense={expense}
        expenseTotal={familyExpenseTotal}
        projectedExpense={projectedExpense}
        projectedIncome={projectedIncome}
        budgetScopeDiffers={budgetScopeDiffers}
        budgetTotal={budgetQ.data?.budget?.total_amount ?? null}
        topCategory={familyByCat[0] ?? null}
        topExpense={familyTopItems[0] ?? null}
        goals={savingsQ.data ?? []}
        incomeTarget={incomeTarget}
        hidden={privacy}
        onClose={() => setInsightsOpen(false)}
      />
      <MoreStatsSheet
        key={topicSelectionKey}
        visible={moreStatsOpen}
        range={range}
        days={reportData?.days ?? []}
        dimension={dimension}
        today={todayInFamilyTimeZone}
        hidden={privacy}
        onClose={() => setMoreStatsOpen(false)}
      />
      <CustomRangeSheet
        visible={customOpen}
        start={customStart}
        end={customEnd}
        today={todayInFamilyTimeZone}
        onChangeStart={setCustomStart}
        onChangeEnd={setCustomEnd}
        onClose={() => setCustomOpen(false)}
      />
      <ReportFilterSheet
        visible={filterOpen}
        filters={filterDraft}
        members={ledgerMembers}
        categories={catsQ.data ?? []}
        hierarchy={hierarchy}
        pending={filterPending}
        error={filterError}
        onChange={setFilterDraft}
        onSubmit={(action) => void submitFilter(action)}
        onClose={closeFilter}
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

function ReportLoadErrorState({
  palette,
  onRetry,
  message,
}: {
  palette: ReturnType<typeof usePalette>;
  onRetry: () => Promise<unknown>;
  message?: string;
}) {
  const [retrying, setRetrying] = useState(false);
  const retryInFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const retry = async () => {
    if (retryInFlight.current) return;
    retryInFlight.current = true;
    setRetrying(true);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const minimumDisplay = new Promise<void>((resolve) => setTimeout(resolve, 300));
    try {
      await Promise.race([
        Promise.resolve().then(onRetry),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 8_000);
        }),
      ]).catch(() => {});
      await minimumDisplay;
    } finally {
      if (timeout) clearTimeout(timeout);
      retryInFlight.current = false;
      if (mounted.current) setRetrying(false);
    }
  };

  return (
    <View style={styles.reportErrorState}>
      <SymbolView name="exclamationmark.triangle" tintColor={palette.textTertiary} size={36} />
      <ThemedText accessibilityLiveRegion="polite" style={[styles.reportErrorTitle, { color: palette.textPrimary }]}>
        {message ?? t('common.loadFailed')}
      </ThemedText>
      <Pressable
        style={[styles.reportRetryButton, { borderColor: palette.separator }]}
        onPress={() => void retry()}
        disabled={retrying}
        accessibilityRole="button"
        accessibilityLabel={t('common.retry')}
        accessibilityState={{ disabled: retrying, busy: retrying }}
      >
        {retrying ? (
          <ActivityIndicator color={palette.accent} size="small" />
        ) : (
          <SymbolView name="arrow.clockwise" tintColor={palette.accent} size={15} />
        )}
        <ThemedText style={[styles.reportRetryText, { color: palette.accent }]}>{t('common.retry')}</ThemedText>
      </Pressable>
    </View>
  );
}

function ReportInlineStatus({ palette, onRetry }: { palette: ReturnType<typeof usePalette>; onRetry?: () => void }) {
  return (
    <View style={[styles.card, styles.inlineStatus, { backgroundColor: palette.card }]}>
      {onRetry ? (
        <>
          <ThemedText style={{ color: palette.textSecondary }}>{t('common.loadFailed')}</ThemedText>
          <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8}>
            <ThemedText style={{ color: palette.accent }}>{t('common.retry')}</ThemedText>
          </Pressable>
        </>
      ) : (
        <ActivityIndicator color={palette.accent} />
      )}
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
    <View
      style={[styles.card, styles.incomeTargetCard, { backgroundColor: palette.card }]}
      accessibilityLabel={t('report.incomeTargetA11y', {
        label: targetLabel,
        amount: maskAmount(formatAmount(income, ''), hidden),
      })}
    >
      <ReportCardHeader
        title={t('report.familyIncomeTarget')}
        details={<ReportDetailText>{t('report.incomeGoalScopeHint')}</ReportDetailText>}
      />
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.compactStats, { opacity: pressed ? 0.65 : 1 }]}
      >
        <Text style={{ color: palette.accent }}>{targetLabel}</Text>
        <SymbolView name="chevron.right" size={13} tintColor={palette.textSecondary} />
      </Pressable>
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
    </View>
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
  budgetScopeDiffers,
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
  budgetScopeDiffers: boolean;
  budgetTotal: number | null;
  topCategory: CatSlice | null;
  topExpense: TopItem | null;
  goals: SavingsGoal[];
  incomeTarget: number;
  hidden: boolean;
  nowMs: number;
}): FinancialInsight[] {
  const insights: FinancialInsight[] = [];
  if (budgetScopeDiffers) {
    insights.push({
      title: t('report.insightBudgetScope'),
      body: t('report.budgetPeriodScopeHint'),
      action: t('report.insightBudgetScopeAction'),
      tone: 'warn',
    });
  }
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
  budgetScopeDiffers,
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
  budgetScopeDiffers: boolean;
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
    budgetScopeDiffers,
    budgetTotal,
    topCategory,
    topExpense,
    goals,
    incomeTarget,
    hidden,
    nowMs,
  });
  const lead = insights[0];
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
          {t('report.familyInsights')}
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
        </View>
      </View>
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
  budgetScopeDiffers,
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
  budgetScopeDiffers: boolean;
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
    budgetScopeDiffers,
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

function MonthlyOverviewCard({
  income,
  expense,
  balance,
  periodText,
  todayLabel,
  currentPeriod,
  futurePeriod,
  comparison,
  palette,
  hidden,
}: {
  income: number;
  expense: number;
  balance: number;
  periodText: string;
  todayLabel: string;
  currentPeriod: boolean;
  futurePeriod: boolean;
  comparison: FamilyComparison | null;
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
      todayLabel={todayLabel}
      currentPeriod={currentPeriod}
      futurePeriod={futurePeriod}
      comparison={comparison}
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
  todayLabel,
  periodText = t('dates.thisMonth'),
  currentPeriod,
  futurePeriod,
  comparison,
  palette,
  hidden,
}: {
  income: number;
  expense: number;
  balance: number;
  rate: number | null;
  periodText?: string;
  todayLabel: string;
  currentPeriod: boolean;
  futurePeriod: boolean;
  comparison: FamilyComparison | null;
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
      todayLabel={todayLabel}
      currentPeriod={currentPeriod}
      futurePeriod={futurePeriod}
      comparison={comparison}
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
  todayLabel,
  periodText = t('dates.thisMonth'),
  currentPeriod,
  futurePeriod,
  comparison,
  palette,
  hidden,
}: {
  income: number;
  expense: number;
  balance: number;
  rate: number | null;
  periodText?: string;
  todayLabel: string;
  currentPeriod: boolean;
  futurePeriod: boolean;
  comparison: FamilyComparison | null;
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
      todayLabel={todayLabel}
      currentPeriod={currentPeriod}
      futurePeriod={futurePeriod}
      comparison={comparison}
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
  todayLabel,
  currentPeriod,
  futurePeriod,
  comparison,
  palette,
  hidden,
}: {
  scope: ReportScope;
  income: number;
  expense: number;
  balance: number;
  rate: number | null;
  periodText: string;
  todayLabel: string;
  currentPeriod: boolean;
  futurePeriod: boolean;
  comparison: FamilyComparison | null;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const { width, fontScale } = useWindowDimensions();
  const rateText = rate == null ? '—' : `${Math.round(rate * 100)}%`;
  const comparisonLines = comparison
    ? (['income', 'expense', 'balance'] as const).map((key) => {
        const formatValue = (value: FamilyComparison['currentValues']) =>
          value.hasRecords
            ? maskAmount(formatAmount(value[key], key === 'balance' ? signForNet(value[key]) : ''), hidden)
            : t('report.comparisonNoRecords');
        return t('report.summaryComparisonMetric', {
          metric: t(key === 'income' ? 'record.income' : key === 'expense' ? 'record.expense' : 'report.balance'),
          current: formatValue(comparison.currentValues),
          previous: formatValue(comparison.previousValues),
        });
      })
    : [];
  if (futurePeriod) {
    return (
      <View style={[styles.monthlyOverview, { backgroundColor: palette.card }]} accessible>
        <ThemedText style={[styles.overviewTitle, { color: palette.textPrimary }]}>
          {t('report.familySummary')} · {t('report.futurePeriod')}
        </ThemedText>
        <ThemedText style={[styles.chartSelection, { color: palette.textSecondary }]}>
          {t('report.futureReportHint')}
        </ThemedText>
      </View>
    );
  }
  const metrics =
    scope === 'income'
      ? [
          {
            label: t('report.thisIncome'),
            value: maskAmount(formatAmount(income), hidden),
            color: palette.income,
          },
          {
            label: t(balance < 0 ? 'report.deficit' : 'report.thisBalance'),
            value: maskAmount(formatAmount(balance), hidden),
            color: balance < 0 ? palette.danger : palette.info,
          },
          {
            label: t('report.thisExpense'),
            value: maskAmount(formatAmount(expense), hidden),
            color: palette.expense,
          },
        ]
      : scope === 'balance'
        ? [
            {
              label: t(balance < 0 ? 'report.deficit' : 'report.thisBalance'),
              value: maskAmount(formatAmount(balance), hidden),
              color: balance < 0 ? palette.danger : palette.info,
            },
            {
              label: t('report.savingsRateShort'),
              value: rateText,
              color: rate != null && rate < 0 ? palette.danger : palette.textPrimary,
            },
            {
              label: t('report.thisExpense'),
              value: maskAmount(formatAmount(expense), hidden),
              color: palette.expense,
            },
          ]
        : [
            {
              label: t('report.thisExpense'),
              value: maskAmount(formatAmount(expense), hidden),
              color: palette.expense,
            },
            {
              label: t(balance < 0 ? 'report.deficit' : 'report.thisBalance'),
              value: maskAmount(formatAmount(balance), hidden),
              color: balance < 0 ? palette.danger : palette.info,
            },
            {
              label: t('report.thisIncome'),
              value: maskAmount(formatAmount(income), hidden),
              color: palette.income,
            },
          ];

  const stacked = width < 375 || fontScale > 1.15 || metrics.some((metric) => metric.value.length > 11);

  return (
    <View style={[styles.monthlyOverview, styles.cardWithFooter, { backgroundColor: palette.card }]}>
      <View style={styles.overviewHeader}>
        <Text accessibilityRole="header" style={[styles.overviewTitle, { color: palette.textPrimary }]}>
          {t('report.familySummary')}
        </Text>
        <Text style={[styles.overviewStatusText, { color: palette.info }]}>
          {currentPeriod ? t('report.asOf', { date: todayLabel }) : t('dates.settled')}
        </Text>
      </View>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={t('report.overviewA11y', {
          period: periodText,
          income: maskAmount(formatAmount(income, '+'), hidden),
          expense: maskAmount(formatAmount(expense, '-'), hidden),
          balance: maskAmount(formatAmount(balance, signForNet(balance)), hidden),
          suffix: currentPeriod ? t('report.overviewInProgress') : futurePeriod ? t('report.overviewFuture') : '',
        })}
      >
        <View style={[styles.overviewMetrics, stacked && { flexDirection: 'column', gap: Space[3] }]}>
          {metrics.map((metric, index) => (
            <View
              key={metric.label}
              style={[
                styles.monthlyOverviewCell,
                stacked && { flex: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
                !stacked &&
                  index > 0 && { borderLeftColor: palette.separator, borderLeftWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <ThemedText style={[styles.monthlyOverviewLabel, { color: palette.textSecondary }]}>
                {metric.label}
              </ThemedText>
              <ThemedText
                style={[styles.monthlyOverviewAmount, { color: metric.color }]}
                selectable
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {metric.value}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>
      <ReportDisclosure
        label={
          comparison
            ? `${t('report.samePeriodMetric', { metric: t(scope === 'balance' ? 'report.balance' : `record.${scope}`) })} · ${comparison.shortLabel}`
            : t('report.noComparableData')
        }
        value={comparison ? comparisonChangeText(scope, comparison, hidden) : undefined}
        title={t('report.comparisonDetails')}
      >
        <ReportDetailText>{comparison?.label ?? t('report.noComparableData')}</ReportDetailText>
        {comparison?.inProgress ? <ReportDetailText>{t('report.comparisonPartialHint')}</ReportDetailText> : null}
        {comparisonLines.map((line) => (
          <ReportDetailText key={line}>{line}</ReportDetailText>
        ))}
        <ReportDetailText>{t('report.familyBaseline')}</ReportDetailText>
        {scope === 'balance' ? <ReportDetailText>{t('report.balanceRateScopeHint')}</ReportDetailText> : null}
      </ReportDisclosure>
    </View>
  );
}

function comparisonChangeText(scope: ReportScope, comparison: FamilyComparison, hidden: boolean): string {
  const change = reportComparisonChange(
    scope,
    comparison.currentValues[scope],
    comparison.previousValues[scope],
    comparison.currentValues.hasRecords,
    comparison.previousValues.hasRecords,
  );
  if (change.kind === 'no-current') return t('report.noCurrentMatches');
  if (change.kind === 'no-previous') return t('report.noPreviousMatches');
  if (change.kind === 'no-records') return t('report.comparisonNoRecords');
  if (change.value === 0) return t('report.flat');
  if (change.kind === 'amount') return maskAmount(formatAmount(change.value, signForNet(change.value)), hidden);
  const pct = Math.abs(change.value);
  return `${change.value > 0 ? '↑' : '↓'} ${pct < 0.1 ? '<0.1' : pct.toFixed(1)}%`;
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
  hidden = false,
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
  hidden?: boolean;
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
              {hidden ? '****' : `${formatter(tick)}${suffix}`}
            </SvgText>
          </Fragment>
        );
      })}
    </>
  );
}

function MonthlyExpenseTrendCard(props: AmountTrendProps) {
  return <AmountTrendCard {...props} metric="expense" />;
}
function MonthlyIncomeTrendCard(props: AmountTrendProps) {
  return <AmountTrendCard {...props} metric="income" />;
}
type AmountTrendProps = {
  series: { label: string; income: number; expense: number }[];
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  currentPeriod: boolean;
  scopeDescription?: string;
};
function AmountTrendCard({
  series,
  palette,
  hidden,
  currentPeriod,
  scopeDescription,
  metric,
}: AmountTrendProps & { metric: 'income' | 'expense' }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const patternId = `trend-${useId().replace(/:/g, '')}`;
  const selected = selectedIndex == null ? null : series[selectedIndex];
  const { width, fontScale } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(Math.max(1, width - 64));
  const axisW = 36 * Math.min(fontScale, 1.5);
  const W = Math.max(contentWidth, axisW + series.length * 44 + 2),
    H = 172,
    bottom = H - 12,
    right = W - 2;
  const max = Math.max(1, ...series.map((item) => item[metric]));
  const { average, count } = reportTrendAverage(
    series.map((item) => item[metric]),
    currentPeriod,
  );
  const groupW = (right - axisW) / Math.max(1, series.length);
  const barW = Math.min(24, groupW * 0.5);
  const yOf = (value: number) => bottom - ((bottom - 16) * value) / max;
  const color = palette[metric];
  const title = t(metric === 'income' ? 'report.incomeTrend' : 'report.expenseTrend');
  const valueText = (item: AmountTrendProps['series'][number]) =>
    t(metric === 'income' ? 'report.selectedIncome' : 'report.selectedExpense', {
      label: item.label,
      amount: maskAmount(formatAmount(item[metric], metric === 'income' ? '+' : '-'), hidden),
    });
  const hasData = series.some((item) => item[metric] > 0);
  return (
    <View style={[styles.card, { backgroundColor: palette.card }]}>
      <ReportCardHeader
        title={title}
        details={
          <>
            {scopeDescription ? <ReportDetailText>{scopeDescription}</ReportDetailText> : null}
            <ReportDetailText>{t('report.ordinaryFlowScope')}</ReportDetailText>
            <ReportDetailText>
              {t(metric === 'income' ? 'report.chartAvgIncome' : 'report.chartAvgExpense', {
                count,
                amount: maskAmount(formatAmount(average, ''), hidden),
              })}
            </ReportDetailText>
            {currentPeriod ? <ReportDetailText>{t('report.inProgressTrendHint')}</ReportDetailText> : null}
            {series.map((item) => (
              <ReportDetailText key={item.label}>{valueText(item)}</ReportDetailText>
            ))}
          </>
        }
      />
      {hasData ? (
        <View onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ width: W }}>
              <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} accessible={false}>
                <Defs>
                  <Pattern id={patternId} width={7} height={7} patternUnits="userSpaceOnUse">
                    <Line x1={-2} y1={7} x2={7} y2={-2} stroke={palette.card} strokeWidth={2} />
                  </Pattern>
                </Defs>
                <SvgYAxis
                  ticks={chartTicks(max)}
                  x={0}
                  width={axisW - 8}
                  yOf={yOf}
                  chartRight={right}
                  color={palette.textSecondary}
                  gridColor={palette.separator}
                  hidden={hidden}
                />
                {series.map((item, index) => {
                  const x = axisW + groupW * index + (groupW - barW) / 2;
                  const h = item[metric] > 0 ? Math.max(2, bottom - yOf(item[metric])) : 0;
                  const ongoing = currentPeriod && index === series.length - 1;
                  return (
                    <Fragment key={item.label}>
                      {h > 0 ? (
                        <>
                          <Rect
                            x={x}
                            y={bottom - h}
                            width={barW}
                            height={h}
                            rx={4}
                            fill={selectedIndex === index ? palette.accent : color}
                          />
                          {ongoing ? (
                            <Rect x={x} y={bottom - h} width={barW} height={h} rx={4} fill={`url(#${patternId})`} />
                          ) : null}
                        </>
                      ) : (
                        <Circle
                          cx={x + barW / 2}
                          cy={bottom}
                          r={3}
                          fill={palette.card}
                          stroke={ongoing ? palette.info : palette.textSecondary}
                          strokeWidth={1.5}
                        />
                      )}
                      <Rect
                        x={axisW + groupW * index}
                        y={0}
                        width={groupW}
                        height={H}
                        fill="transparent"
                        onPress={() => setSelectedIndex(index)}
                      />
                    </Fragment>
                  );
                })}
              </Svg>
              <View style={{ flexDirection: 'row', paddingLeft: axisW, paddingRight: 2 }}>
                {series.map((item, index) => (
                  <Pressable
                    key={item.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected: selectedIndex === index }}
                    accessibilityLabel={`${valueText(item)}${currentPeriod && index === series.length - 1 ? ` · ${t('dates.inProgress')}` : ''}`}
                    onPress={() => setSelectedIndex(index)}
                    style={{ flex: 1, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
                  >
                    <Text
                      style={{
                        color: currentPeriod && index === series.length - 1 ? palette.info : palette.textSecondary,
                        fontSize: 12,
                      }}
                    >
                      {item.label}
                    </Text>
                    {currentPeriod && index === series.length - 1 ? (
                      <Text style={{ color: palette.info, fontSize: 11 }}>{t('dates.inProgress')}</Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </View>
          </ScrollView>
          {selected ? (
            <Text accessibilityLiveRegion="polite" style={[styles.chartSelection, { color: palette.textPrimary }]}>
              {valueText(selected)}
            </Text>
          ) : null}
        </View>
      ) : (
        <Text style={[styles.chartSelection, { color: palette.textSecondary }]}>{t('report.noTrendRecords')}</Text>
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
      <SymbolView name={icon} tintColor={palette.textSecondary} size={32} />
      <Text style={{ color: palette.textSecondary }}>{t('report.trendNeedMore', { count, label })}</Text>
    </View>
  );
}

function BalanceWaterfallCard({
  normalIncome,
  normalExpense,
  goalWithdrawals,
  goalDeposits,
  balance,
  categories,
  palette,
  hidden,
}: {
  normalIncome: number;
  normalExpense: number;
  goalWithdrawals: number;
  goalDeposits: number;
  balance: number;
  categories: CatSlice[];
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const { locale } = useLocalePreference();
  const topCategories = categories.slice(0, 4);
  const topTotal = topCategories.reduce((sum, item) => sum + item.amount, 0);
  const otherExpense = Math.max(0, normalExpense - topTotal);
  const rows: { label: string; amount: number; color: string; sign: '+' | '-' | '' }[] = [
    { label: t('report.normalIncome'), amount: normalIncome, color: palette.income, sign: '+' },
    ...(goalWithdrawals > 0
      ? [{ label: t('report.goalWithdrawals'), amount: goalWithdrawals, color: palette.income, sign: '+' as const }]
      : []),
    ...topCategories.map((category) => ({
      label: category.name,
      amount: category.amount,
      color: category.color,
      sign: '-' as const,
    })),
    ...(otherExpense > 0
      ? [{ label: t('report.otherConsumption'), amount: otherExpense, color: palette.textTertiary, sign: '-' as const }]
      : []),
    ...(goalDeposits > 0
      ? [{ label: t('report.goalDeposits'), amount: goalDeposits, color: palette.expense, sign: '-' as const }]
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
        {t('report.familyBreakdown')}
      </ThemedText>
      <View style={styles.waterfallList}>
        {rows.map((row) => (
          <View key={row.label} style={styles.waterfallRow}>
            <ThemedText
              style={[styles.waterfallLabel, { color: palette.textSecondary, width: locale === 'en' ? 100 : 64 }]}
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
  currentPeriod,
}: {
  series: { label: string; income: number; expense: number }[];
  palette: ReturnType<typeof usePalette>;
  currentPeriod: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const rates = series.map((item) => ({
    label: item.label,
    rate: item.income > 0 ? (item.income - item.expense) / item.income : null,
  }));
  const selected = selectedIndex == null ? null : (rates[selectedIndex] ?? null);
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
      <ReportCardHeader
        title={t('report.familyRate')}
        details={
          <>
            <ReportDetailText>{t('report.balanceRateScopeHint')}</ReportDetailText>
            {currentPeriod ? <ReportDetailText>{t('report.inProgressTrendHint')}</ReportDetailText> : null}
            {rates.map((item) => (
              <ReportDetailText key={item.label}>
                {item.label} · {item.rate == null ? t('report.noIncome') : `${Math.round(item.rate * 100)}%`}
              </ReportDetailText>
            ))}
          </>
        }
      />
      <View style={styles.cardHeaderRow}>
        <ThemedText style={[styles.chartMeta, { color: palette.textSecondary }]}>
          {latest == null ? t('report.noIncome') : t('report.periodRate', { pct: Math.round(latest * 100) })}
          {currentPeriod ? ` · ${t('dates.inProgress')}` : ''}
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
                  r={selectedIndex === index ? 5 : 3}
                  fill={selectedIndex === index ? palette.accent : palette.info}
                  onPress={() => setSelectedIndex(index)}
                  accessibilityLabel={t('report.selectedRate', {
                    label: item.label,
                    pct: Math.round((item.rate ?? 0) * 100),
                  })}
                />
              ),
            )}
          </Svg>
          <View style={[styles.trendLabels, { paddingLeft: axisW }]}>
            {rates.map((item, index) => (
              <Text
                key={item.label}
                style={[
                  styles.trendLabel,
                  { color: currentPeriod && index === rates.length - 1 ? palette.info : palette.textTertiary },
                ]}
              >
                {item.label}
              </Text>
            ))}
          </View>
          <ThemedText style={[styles.chartSelection, { color: palette.textSecondary }]}>
            {selected?.rate != null
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
  title,
  total,
  used,
  topCategory,
  scopeDiffers,
  projected,
  palette,
  hidden,
  onOpen,
}: {
  title: string;
  total: number | null;
  used: number;
  topCategory: CatSlice | null;
  scopeDiffers: boolean;
  projected: number | null;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onOpen?: () => void;
}) {
  if (!total || total <= 0) {
    return (
      <View style={[styles.card, styles.budgetCard, { backgroundColor: palette.card }]}>
        <View style={styles.budgetHeading}>
          <View style={styles.budgetTitleRow}>
            <SymbolView name="target" tintColor={palette.textSecondary} size={18} />
            <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
              {title}
            </ThemedText>
          </View>
          <ThemedText style={{ color: palette.textSecondary }}>{t('settings.notSet')}</ThemedText>
        </View>
        <ThemedText style={{ color: palette.textSecondary }}>
          {t(onOpen ? 'report.setBudgetHint' : 'report.historicalBudgetEmpty')}
        </ThemedText>
        {onOpen ? (
          <Pressable style={[styles.budgetAction, { borderColor: palette.separator }]} onPress={onOpen}>
            <SymbolView name="plus.circle" tintColor={palette.accent} size={17} />
            <ThemedText style={[styles.budgetActionText, { color: palette.accent }]}>
              {t('report.setBudget')}
            </ThemedText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const percent = Math.round((used / total) * 100);
  const remaining = total - used;
  const over = remaining < 0;
  const progress = Math.min(100, Math.max(0, percent));
  const color = over ? palette.danger : percent >= 80 ? palette.warning : palette.success;
  const statusText = over
    ? t('common.overBy', { amount: maskAmount(formatAmount(Math.abs(remaining), ''), hidden) })
    : t('common.leftover', { amount: maskAmount(formatAmount(remaining, ''), hidden) });
  const forecastOver = projected != null && projected > total;

  return (
    <Pressable
      style={[styles.card, styles.budgetCard, { backgroundColor: palette.card }]}
      onPress={onOpen}
      disabled={!onOpen}
      accessibilityRole={onOpen ? 'button' : undefined}
    >
      <View style={styles.budgetHeading}>
        <View style={styles.budgetTitleRow}>
          <SymbolView name="target" tintColor={palette.textSecondary} size={18} />
          <ThemedText style={[styles.sectionTitle, styles.noMargin, { color: palette.textPrimary }]}>
            {title}
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
      {scopeDiffers || over || forecastOver ? (
        <View style={[styles.budgetInsight, { backgroundColor: palette.base }]}>
          <SymbolView name="exclamationmark.triangle" tintColor={palette.textPrimary} size={17} />
          <Text style={[styles.budgetInsightText, { color: palette.textPrimary }]}>
            {scopeDiffers
              ? t('report.budgetForecastUnavailable')
              : over
                ? t('report.pressureItem', { name: topCategory?.name ?? t('report.thisExpensePressure') })
                : t('report.projectedMonthEnd', { amount: maskAmount(formatAmount(projected ?? 0, ''), hidden) })}
          </Text>
          {onOpen ? <SymbolView name="chevron.right" tintColor={palette.textSecondary} size={13} /> : null}
        </View>
      ) : null}
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const { locale } = useLocalePreference();
  const rows = useMemo(() => {
    void locale;
    return buildExpenseCategoryRows(categories, palette.textTertiary);
  }, [categories, palette.textTertiary, locale]);
  const selected = rows.find((row) => row.id === selectedId) ?? null;
  const selectedPercent = selected && total > 0 ? Math.round((selected.amount / total) * 100) : 0;
  return (
    <View
      style={[styles.card, { backgroundColor: palette.card }]}
      accessibilityLabel={t('report.mixA11y', {
        total: maskAmount(formatAmount(total, ''), hidden),
        count: categories.length,
      })}
    >
      <View style={styles.cardHeaderRow}>
        <View style={styles.expenseMixTitleGroup}>
          <Text accessibilityRole="header" style={[styles.expenseMixTitle, { color: palette.textPrimary }]}>
            {t('report.expenseMix')}
          </Text>
          {/* 滚动到屏幕边缘时，由外层页面处理安全区，避免 SwiftUI 再次偏移触发器。 */}
          <Host ignoreSafeArea="all" style={styles.expenseMixInfoHost}>
            <Popover isPresented={infoOpen} onIsPresentedChange={setInfoOpen} arrowEdge="top">
              <Popover.Trigger>
                <UIButton
                  onPress={() => setInfoOpen(true)}
                  modifiers={[
                    buttonStyle('plain'),
                    accessibilityLabel(t('report.chartInfo', { title: t('report.expenseMix') })),
                  ]}
                >
                  <UIImage
                    systemName="info.circle"
                    size={14}
                    color={palette.textSecondary}
                    modifiers={[frame({ width: 44, height: 44 }), contentShape(shapes.rectangle())]}
                  />
                </UIButton>
              </Popover.Trigger>
              <Popover.Content>
                <UIText
                  modifiers={[
                    font({ size: 14 }),
                    foregroundColor(palette.textPrimary),
                    padding({ all: Space[4] }),
                    frame({ width: 260, alignment: 'leading' }),
                    fixedSize({ horizontal: false, vertical: true }),
                  ]}
                >
                  {t('report.expenseMixInfo')}
                </UIText>
              </Popover.Content>
            </Popover>
          </Host>
        </View>
        <ThemedText style={[styles.expenseMixTotal, { color: palette.textPrimary }]}>
          {t('report.expenseMixTotal', { amount: maskAmount(formatAmount(total, ''), hidden) })}
        </ThemedText>
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
            onSlicePress={(index) => setSelectedId(rows[index]?.id ?? null)}
          />
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
                    amount: maskAmount(formatAmount(category.amount, '-'), hidden),
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
  header,
  members,
  maxCount,
  periodText = t('dates.thisMonth'),
  palette,
  hidden,
  onOpen,
}: {
  header?: ReactNode;
  members: Member[];
  maxCount: number;
  periodText?: string;
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
  onOpen: () => void;
}) {
  return (
    <View style={[styles.card, styles.cardWithFooter, { backgroundColor: palette.card }]}>
      {header ?? <ReportCardHeader title={t('report.memberAnalysis')} />}
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
            <View
              key={member.id}
              style={styles.memberRow}
              accessible
              accessibilityLabel={`${member.name}，${t('report.countWithUnit', { count: hidden ? '****' : member.count })}`}
            >
              <UserAvatar avatarUrl={member.avatarUrl} nickname={member.avatarName} size={32} />
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
              <ThemedText style={[styles.memberCount, { color: palette.textPrimary }]} numberOfLines={1}>
                {hidden ? '****' : member.count}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={onOpen}
        style={({ pressed }) => [styles.compactStats, styles.memberFooter, { opacity: pressed ? 0.65 : 1 }]}
      >
        <Text style={{ color: palette.accent }}>{t('report.memberAnalysis')}</Text>
        <SymbolView name="chevron.right" size={13} tintColor={palette.textSecondary} />
      </Pressable>
    </View>
  );
}

function SavingsGoalsCard({
  goals,
  loading,
  failed,
  onRetry,
  palette,
  hidden,
  onOpen,
}: {
  goals: SavingsGoal[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
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

  if (failed) return <ReportInlineStatus palette={palette} onRetry={onRetry} />;

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
          {t('report.currentSavingsGoals')}
        </ThemedText>
        <ThemedText style={{ color: palette.textSecondary }}>
          {t('report.goalsInProgress', { count: goals.length })}
        </ThemedText>
      </View>
      {goals.slice(0, 3).map((goal, index) => {
        const progress = goal.target_amount > 0 ? Math.min(1, goal.saved_amount / goal.target_amount) : 0;
        const progressColor = index % 2 === 0 ? palette.info : palette.success;
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
  today,
  onChangeStart,
  onChangeEnd,
  onClose,
}: {
  visible: boolean;
  start: Date;
  end: Date;
  today: Date;
  onChangeStart: (date: Date) => void;
  onChangeEnd: (date: Date) => void;
  onClose: () => void;
}) {
  const palette = useSheetPalette();
  const selectedDays = Math.max(1, Math.abs(calendarDayDifference(start, end)) + 1);
  const resetLast30Days = () => {
    const todayStart = startOfLocalDay(today);
    onChangeEnd(todayStart);
    onChangeStart(addDays(todayStart, -29));
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
  hierarchy,
  analytics,
  range,
  today,
  familyTimeZone,
  dimension,
  analyticsInput,
  totalExpense,
  totalIncome,
  hidden,
  onClose,
}: {
  detail: CategoryDetail | null;
  hierarchy: CategoryHierarchy;
  analytics: ReportAnalytics;
  range: { start: Date; end: Date };
  today: Date;
  familyTimeZone?: string;
  dimension: Dimension;
  analyticsInput: ReportAnalyticsInput;
  totalExpense: number;
  totalIncome: number;
  hidden: boolean;
  onClose: () => void;
}) {
  const palette = useSheetPalette();
  const catColors = useCategoryColors();
  const { locale } = useLocalePreference();
  const [selectedChild, setSelectedChild] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const isOther = detail?.id === EXPENSE_CATEGORY_OTHER_ID && !selectedGroup;
  const groupId = selectedGroup ?? detail?.id;
  const isGroup =
    !!groupId &&
    !!hierarchy.layoutById.get(groupId)?.is_group &&
    (hierarchy.childrenByParent.get(groupId)?.length ?? 0) > 0;
  const type = detail?.type ?? 'expense';
  const groupIds = detail
    ? (selectedGroup ? [selectedGroup] : detail.categoryIds?.length ? detail.categoryIds : [detail.id]).flatMap((id) =>
        categoryDescendantIds(id, hierarchy),
      )
    : [];
  const allowedIds = analyticsInput.categoryIds.length
    ? groupIds.filter((id) => analyticsInput.categoryIds.includes(id))
    : groupIds;
  const categoryIds = selectedChild ? [selectedChild] : allowedIds;
  const childRows = groupId
    ? type === 'expense'
      ? analytics.expenseCategoryChildren
          .filter((item) => item.parentId === groupId && item.currentAmount > 0)
          .map((item) => ({ id: item.categoryId, amount: item.currentAmount }))
      : analytics.incomeCategoryChildren
          .filter((item) => item.parentId === groupId && item.amount > 0)
          .map((item) => ({ id: item.categoryId, amount: item.amount }))
    : [];
  const otherRows = isOther
    ? analytics.expenseCategories
        .filter((item) => detail?.categoryIds?.includes(item.categoryId) && item.currentAmount > 0)
        .map((item) => ({ id: item.categoryId, amount: item.currentAmount }))
    : [];
  const parentAmount = childRows.reduce((sum, item) => sum + item.amount, 0);
  const selectedCategory = selectedChild ? hierarchy.byId.get(selectedChild) : undefined;
  const selectedGroupCategory = selectedGroup ? hierarchy.byId.get(selectedGroup) : undefined;
  const detailName =
    selectedChild === groupId
      ? t('category.unspecified')
      : selectedCategory
        ? displayCategoryName(selectedCategory.name, selectedCategory.is_system)
        : selectedGroupCategory
          ? displayCategoryName(selectedGroupCategory.name, selectedGroupCategory.is_system)
          : (detail?.name ?? '');
  const detailQ = useCategoryDetail(
    detail
      ? {
          start: analyticsInput.start,
          end: analyticsInput.end,
          historyStart: analyticsInput.historyStart,
          categoryIds,
          memberIds: analyticsInput.memberIds,
          type,
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
    const flowRows = days.flatMap((item) => {
      const occurred_at = reportCalendarDayTimestamp(item.date);
      return occurred_at ? [{ occurred_at, type: 'expense' as const, amount: item.amount }] : [];
    });
    const series =
      dimension === 'custom'
        ? equalPeriodIncomeExpenseSeries(range, flowRows)
        : incomeExpenseSeries(dimension, range.start, flowRows);
    return series.map((item) => ({ label: item.label, expense: item.expense }));
  }, [firstPage?.days, dimension, range, locale]);

  const denominator = selectedChild ? parentAmount : type === 'income' ? totalIncome : totalExpense;
  const share = denominator > 0 ? Math.round((periodExpense / denominator) * 100) : 0;
  const observedEnd = new Date(Math.min(range.end.getTime(), addDays(startOfLocalDay(today), 1).getTime()));
  const days = Math.max(1, calendarDayDifference(range.start, observedEnd));
  const dailyAvg = Math.round(periodExpense / days);
  const maxGroupAmount = Math.max(1, ...noteGroups.map((item) => item.amount));

  return (
    <PageSheet visible={!!detail} onClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          <SheetHeader
            title={detailName}
            onBack={
              selectedChild ? () => setSelectedChild(null) : selectedGroup ? () => setSelectedGroup(null) : undefined
            }
          />
          {detailQ.isLoading ? (
            <ActivityIndicator />
          ) : detailQ.isError && !firstPage ? (
            <ReportLoadErrorState
              palette={palette}
              onRetry={async () => {
                if (await requestNetworkRecovery()) await detailQ.refetch({ cancelRefetch: false });
              }}
            />
          ) : (
            <ScrollView contentContainerStyle={styles.sheetContent}>
              <View style={[styles.detailSummaryCard, { backgroundColor: palette.card }]}>
                <Text style={[styles.detailSummaryLabel, { color: palette.textSecondary }]}>
                  {t('category.periodAmount', { name: detailName })}
                </Text>
                <Text
                  style={[styles.detailSummaryAmount, { color: type === 'income' ? palette.income : palette.expense }]}
                >
                  {maskAmount(formatAmount(periodExpense, type === 'income' ? '+' : '-'), hidden)}
                </Text>
                <Text style={[styles.detailSummaryMeta, { color: palette.textSecondary }]}>
                  {t('report.shareCountAvg', {
                    scope: t(type === 'income' ? 'record.income' : 'record.expense'),
                    pct: share,
                    count: firstPage?.count ?? 0,
                    amount: maskAmount(formatAmount(dailyAvg, ''), hidden),
                  })}
                </Text>
              </View>

              {(isGroup && !selectedChild) || isOther ? (
                <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
                  <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>
                    {isOther ? t('category.otherGroups') : t('category.subcategories')}
                  </Text>
                  {(isOther ? otherRows : childRows).map((item) => {
                    const category = hierarchy.byId.get(item.id);
                    const name =
                      !isOther && item.id === groupId
                        ? t('category.unspecified')
                        : category
                          ? displayCategoryName(category.name, category.is_system)
                          : t('common.uncategorized');
                    const rowTotal = isOther ? otherRows.reduce((sum, row) => sum + row.amount, 0) : parentAmount;
                    const colorKey = categoryColorKey(category?.name ?? '', type, category?.color_key);
                    return (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        style={styles.detailGroupRow}
                        onPress={() => (isOther ? setSelectedGroup(item.id) : setSelectedChild(item.id))}
                      >
                        <View
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: catColors[colorKey],
                          }}
                        >
                          <ExpoImage
                            source={`sf:${categorySymbol(category?.icon ?? null, type)}`}
                            tintColor="#FFFFFF"
                            contentFit="contain"
                            style={{ width: 15, height: 15 }}
                          />
                        </View>
                        <Text style={[styles.detailGroupName, { color: palette.textPrimary }]}>{name}</Text>
                        <Text style={[styles.detailGroupAmount, { color: palette.textSecondary }]}>
                          {rowTotal > 0 ? Math.round((item.amount / rowTotal) * 100) : 0}%
                        </Text>
                        <Text
                          style={[
                            styles.detailGroupAmount,
                            { color: type === 'income' ? palette.income : palette.expense },
                          ]}
                        >
                          {maskAmount(formatAmount(item.amount, ''), hidden)}
                        </Text>
                        <SymbolView name="chevron.right" tintColor={palette.textSecondary} size={14} />
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>
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
                                  backgroundColor: type === 'income' ? palette.income : palette.expense,
                                  width: `${Math.max(6, (item.amount / maxGroupAmount) * 100)}%`,
                                },
                              ]}
                            />
                          </View>
                          <Text
                            style={[
                              styles.detailGroupAmount,
                              { color: type === 'income' ? palette.income : palette.expense },
                            ]}
                            numberOfLines={1}
                          >
                            {maskAmount(formatAmount(item.amount, type === 'income' ? '+' : '-'), hidden)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {type === 'expense' ? (
                <View style={[styles.detailCard, { backgroundColor: palette.card }]}>
                  <View style={styles.cardHeaderRow}>
                    <Text style={[styles.detailSectionTitle, { color: palette.textPrimary }]}>
                      {t('report.catTrend', { name: detailName })}
                    </Text>
                    <Text style={[styles.detailSectionMeta, { color: palette.textSecondary }]}>
                      {t('report.last6Periods')}
                    </Text>
                  </View>
                  <CategoryDetailTrendChart series={trend} palette={palette} hidden={hidden} />
                </View>
              ) : null}

              {(!isGroup && !isOther) || selectedChild ? (
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
                      <Text style={{ color: palette.textSecondary }}>
                        {t(type === 'income' ? 'report.emptyCatIncome' : 'report.emptyCatExpense')}
                      </Text>
                    </View>
                  ) : (
                    rows.map((txn) => (
                      <View key={txn.id} style={[styles.detailRow, { borderBottomColor: palette.separator }]}>
                        <View style={styles.flex}>
                          <Text style={[styles.detailNote, { color: palette.textPrimary }]} numberOfLines={1}>
                            {txn.note || t('report.noNote')}
                          </Text>
                          <Text style={[styles.detailDate, { color: palette.textSecondary }]}>
                            {new Date(txn.occurredAt).toLocaleDateString(intlLocale(), { timeZone: familyTimeZone })}
                          </Text>
                        </View>
                        <Text
                          style={[styles.detailAmount, { color: type === 'income' ? palette.income : palette.expense }]}
                          numberOfLines={1}
                        >
                          {maskAmount(formatAmount(txn.amount, type === 'income' ? '+' : '-'), hidden)}
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
              ) : null}
            </ScrollView>
          )}
        </SafeAreaView>
      </View>
    </PageSheet>
  );
}

function CategoryDetailTrendChart({
  series,
  palette,
  hidden,
}: {
  series: { label: string; expense: number }[];
  palette: ReturnType<typeof usePalette>;
  hidden: boolean;
}) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const selected = selectedIndex == null ? null : (series[selectedIndex] ?? null);
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
          hidden={hidden}
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
              fill={selectedIndex === index ? palette.accent : palette.expense}
              onPress={() => setSelectedIndex(index)}
              accessibilityLabel={t('report.selectedExpense', {
                label: item.label,
                amount: maskAmount(formatAmount(item.expense, ''), hidden),
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
          ? t('report.selectedExpense', {
              label: selected.label,
              amount: maskAmount(formatAmount(selected.expense, '-'), hidden),
            })
          : t('report.tapBarExact')}
      </Text>
    </>
  );
}

// ── 家庭成员分析：参与度 + 收支贡献 + 支出偏好 ────────────────────────────────
function MemberAnalysisSheet({
  visible,
  periodText,
  analytics,
  incomeAnalytics,
  failed,
  onRetry,
  members,
  categories,
  hidden,
  onClose,
}: {
  visible: boolean;
  periodText: string;
  analytics: ReportAnalytics | null;
  incomeAnalytics: ReportAnalytics | null;
  failed: boolean;
  onRetry: () => void;
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
    for (const item of analytics?.members ?? []) {
      const row = memberMap.get(item.userId) ?? {
        id: item.userId,
        name: t('common.member'),
        count: 0,
        income: 0,
        expense: 0,
        categoryMap: new Map(),
      };
      row.count = item.count;
      row.expense = item.expenseAmount;
      memberMap.set(item.userId, row);
    }
    for (const item of incomeAnalytics?.members ?? []) {
      const row = memberMap.get(item.userId) ?? {
        id: item.userId,
        name: t('common.member'),
        count: 0,
        income: 0,
        expense: 0,
        categoryMap: new Map(),
      };
      row.income = item.incomeAmount;
      memberMap.set(item.userId, row);
    }
    for (const item of analytics?.memberCategories ?? []) {
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
      totalCount: analytics?.summary.transactionCount ?? 0,
      totalIncome: incomeAnalytics?.summary.incomeAmount ?? 0,
      totalExpense: analytics?.summary.expenseAmount ?? 0,
    };
  }, [members, analytics, incomeAnalytics, categories, catColors, locale]);

  const maxCount = Math.max(1, ...rows.map((row) => row.count));
  const maxMoney = Math.max(1, ...rows.flatMap((row) => [row.income, row.expense]));
  const periodLabel = periodText;

  if (!analytics || !incomeAnalytics) {
    return (
      <PageSheet visible={visible} onClose={onClose}>
        <View style={[styles.root, { backgroundColor: palette.base }]}>
          <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
            <SheetHeader title={t('report.memberAnalysis')} />
            <ReportInlineStatus palette={palette} onRetry={failed ? onRetry : undefined} />
          </SafeAreaView>
        </View>
      </PageSheet>
    );
  }

  return (
    <PageSheet visible={visible} onClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          <SheetHeader title={t('report.memberAnalysis')} />

          <ScrollView contentContainerStyle={styles.sheetContent}>
            <Text style={[styles.scopeNote, { color: palette.textSecondary }]}>{t('report.memberScopeHint')}</Text>
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
                  <Text style={[styles.memberContributionName, { color: palette.textPrimary }]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <View style={styles.memberContributionBars}>
                    <View style={[styles.memberContributionTrack, { backgroundColor: palette.base }]}>
                      <View
                        style={[
                          styles.memberContributionFill,
                          {
                            width: `${Math.max(4, (item.income / maxMoney) * 100)}%`,
                            backgroundColor: palette.income,
                          },
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
  reportSkeleton: { gap: Space[4] },
  switchOverlay: { zIndex: 9, alignItems: 'center', paddingTop: Space[6] },
  switchStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    padding: Space[4],
    borderRadius: Radius.lg,
  },
  switchAction: { minHeight: 44, justifyContent: 'center' },
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
  filterSheetAnchor: { width: 1, height: 1 },
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
  reportErrorState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[3],
    paddingHorizontal: Space[8],
  },
  reportErrorTitle: { fontSize: 17, fontWeight: '600' },
  reportRetryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
    paddingVertical: Space[2],
  },
  reportRetryText: { fontSize: 15, fontWeight: '600' },
  content: { paddingHorizontal: Space[4], paddingBottom: TabBarInset, gap: Space[4] },
  card: { borderRadius: Radius.lg, padding: Space[4] },
  // The footer's own touch area supplies the bottom breathing room; don't add card padding below it.
  cardWithFooter: { paddingBottom: 0 },
  memberFooter: { minHeight: 44 },
  compactStats: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Space[2],
  },
  scopeNote: { fontSize: 12, lineHeight: 17, marginBottom: Space[1], marginHorizontal: Space[1] },
  overviewComparison: { marginTop: Space[3], gap: Space[1] },
  inlineStatus: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Space[3] },
  noMargin: { marginBottom: 0 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Space[3] },
  expenseMixTitleGroup: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  expenseMixTitle: { fontSize: 17, fontWeight: '600' },
  expenseMixInfoHost: { width: 44, height: 44 },
  expenseMixTotal: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  cardHeaderAction: { flexDirection: 'row', alignItems: 'center', gap: Space[1] },
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
  monthlyOverview: { borderRadius: Radius.lg, padding: Space[4], paddingBottom: Space[3], gap: Space[2] },
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
  monthlyOverviewCell: { flex: 1, minWidth: 0, gap: Space[1], paddingHorizontal: Space[2] },
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
  categoryCaption: { fontSize: 12, fontWeight: '400' },
  monthlyCategoryBody: { alignItems: 'center', gap: Space[3], paddingTop: Space[3] },
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
  incomeTargetEmpty: {
    minHeight: 96,
    borderRadius: Radius.md,
    padding: Space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
  },
  targetEmptyIcon: {
    width: 54,
    height: 54,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  targetEmptyTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700', marginBottom: 2 },
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
  insightDot: { width: 8, height: 8, borderRadius: Radius.full },
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
  heatRows: { gap: 2 },
  heatWeekRow: { flexDirection: 'row', gap: 1 },
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
  memberBarWrap: { flex: 1 },
  memberBarTrack: { height: 10, borderRadius: Radius.full, overflow: 'hidden' },
  memberBarFill: { height: '100%', borderRadius: Radius.full },
  memberAmount: { fontSize: 13, fontVariant: ['tabular-nums'], width: 76, textAlign: 'right' },
  memberCount: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'], textAlign: 'right' },
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
