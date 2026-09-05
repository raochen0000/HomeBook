/** 服务端完整统计：RPC 以当前家庭和家庭账期时区聚合，客户端不再由最近流水累加。 */
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

import type { Database, Json } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type MonthlySummaryAnalytics = Database['public']['Functions']['get_monthly_summary']['Returns'][number];
export type BudgetProgressAnalytics = Database['public']['Functions']['get_budget_progress']['Returns'][number];
export type FamilyActivityAnalytics = Database['public']['Functions']['get_family_activity']['Returns'][number];

type ReportSummary = {
  transactionCount: number;
  incomeAmount: number;
  expenseAmount: number;
  expenseNormalAmount: number;
};
export type ReportAnalytics = {
  summary: ReportSummary;
  expenseCategories: { categoryId: string; currentAmount: number; previousAmount: number }[];
  incomeCategories: { categoryId: string; amount: number }[];
  members: {
    userId: string;
    count: number;
    incomeAmount: number;
    expenseAmount: number;
    expenseNormalAmount: number;
  }[];
  memberCategories: { userId: string; categoryId: string; amount: number }[];
  topExpenses: { id: string; categoryId: string; note: string | null; amount: number; occurredAt: string }[];
  days: {
    date: string;
    incomeAmount: number;
    expenseAmount: number;
    incomeNormalAmount: number;
    expenseNormalAmount: number;
  }[];
};
export type ReportAnalyticsInput = {
  start: string;
  end: string;
  previousStart: string;
  historyStart: string;
  memberIds: string[];
  categoryIds: string[];
};

export const EMPTY_REPORT_ANALYTICS: ReportAnalytics = {
  summary: { transactionCount: 0, incomeAmount: 0, expenseAmount: 0, expenseNormalAmount: 0 },
  expenseCategories: [],
  incomeCategories: [],
  members: [],
  memberCategories: [],
  topExpenses: [],
  days: [],
};

function asRecord(value: Json | undefined): Record<string, Json | undefined> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function asNumber(value: Json | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asString(value: Json | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function asRows<T>(value: Json | undefined, map: (row: Record<string, Json | undefined>) => T | null): T[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const parsed = asRecord(item);
        const result = parsed ? map(parsed) : null;
        return result ? [result] : [];
      })
    : [];
}

function parseReportAnalytics(value: Json): ReportAnalytics {
  const root = asRecord(value);
  if (!root) return EMPTY_REPORT_ANALYTICS;
  const summary = asRecord(root.summary) ?? {};
  return {
    summary: {
      transactionCount: asNumber(summary.transactionCount),
      incomeAmount: asNumber(summary.incomeAmount),
      expenseAmount: asNumber(summary.expenseAmount),
      expenseNormalAmount: asNumber(summary.expenseNormalAmount),
    },
    expenseCategories: asRows(root.expenseCategories, (row) => {
      const categoryId = asString(row.categoryId);
      return categoryId
        ? { categoryId, currentAmount: asNumber(row.currentAmount), previousAmount: asNumber(row.previousAmount) }
        : null;
    }),
    incomeCategories: asRows(root.incomeCategories, (row) => {
      const categoryId = asString(row.categoryId);
      return categoryId ? { categoryId, amount: asNumber(row.amount) } : null;
    }),
    members: asRows(root.members, (row) => {
      const userId = asString(row.userId);
      return userId
        ? {
            userId,
            count: asNumber(row.count),
            incomeAmount: asNumber(row.incomeAmount),
            expenseAmount: asNumber(row.expenseAmount),
            expenseNormalAmount: asNumber(row.expenseNormalAmount),
          }
        : null;
    }),
    memberCategories: asRows(root.memberCategories, (row) => {
      const userId = asString(row.userId);
      const categoryId = asString(row.categoryId);
      return userId && categoryId ? { userId, categoryId, amount: asNumber(row.amount) } : null;
    }),
    topExpenses: asRows(root.topExpenses, (row) => {
      const id = asString(row.id);
      const categoryId = asString(row.categoryId);
      const occurredAt = asString(row.occurredAt);
      return id && categoryId && occurredAt
        ? { id, categoryId, occurredAt, note: asString(row.note), amount: asNumber(row.amount) }
        : null;
    }),
    days: asRows(root.days, (row) => {
      const date = asString(row.date);
      return date
        ? {
            date,
            incomeAmount: asNumber(row.incomeAmount),
            expenseAmount: asNumber(row.expenseAmount),
            incomeNormalAmount: asNumber(row.incomeNormalAmount),
            expenseNormalAmount: asNumber(row.expenseNormalAmount),
          }
        : null;
    }),
  };
}

function parseCategoryUsage(value: Json): Map<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
  return new Map(
    Object.entries(value).flatMap(([categoryId, amount]) =>
      typeof amount === 'number' && Number.isFinite(amount) ? [[categoryId, amount] as const] : [],
    ),
  );
}

export type BudgetProgress = { usedAmount: number; byCategory: Map<string, number> };

export async function fetchMonthlySummary(period: string): Promise<MonthlySummaryAnalytics | null> {
  const { data, error } = await supabase.rpc('get_monthly_summary', { p_period: period }).maybeSingle();
  if (error) throw error;
  return data;
}

export function useMonthlySummary(period: string) {
  return useQuery({ queryKey: queryKeys.monthlySummary(period), queryFn: () => fetchMonthlySummary(period) });
}

export async function fetchBudgetProgress(period: string): Promise<BudgetProgress> {
  const { data, error } = await supabase.rpc('get_budget_progress', { p_period: period }).maybeSingle();
  if (error) throw error;
  return { usedAmount: data?.used_amount ?? 0, byCategory: parseCategoryUsage(data?.category_usage ?? {}) };
}

export function useBudgetProgress(period: string) {
  return useQuery({ queryKey: queryKeys.budgetProgress(period), queryFn: () => fetchBudgetProgress(period) });
}

export async function fetchFamilyActivity(): Promise<FamilyActivityAnalytics | null> {
  const { data, error } = await supabase.rpc('get_family_activity').maybeSingle();
  if (error) throw error;
  return data;
}

export function useFamilyActivity() {
  return useQuery({ queryKey: queryKeys.familyActivity, queryFn: fetchFamilyActivity });
}

export async function fetchReportAnalytics(input: ReportAnalyticsInput): Promise<ReportAnalytics> {
  const { data, error } = await supabase.rpc('get_report_analytics', {
    p_start: input.start,
    p_end: input.end,
    p_previous_start: input.previousStart,
    p_history_start: input.historyStart,
    p_member_ids: input.memberIds,
    p_category_ids: input.categoryIds,
  });
  if (error) throw error;
  return parseReportAnalytics(data);
}

export function useReportAnalytics(input: ReportAnalyticsInput) {
  return useQuery({ queryKey: queryKeys.reportAnalytics(input), queryFn: () => fetchReportAnalytics(input) });
}

export type CategoryDetailInput = {
  start: string;
  end: string;
  historyStart: string;
  categoryIds: string[];
};
export type CategoryDetailPage = {
  count: number;
  amount: number;
  notes: { name: string; amount: number; count: number }[];
  days: { date: string; amount: number }[];
  rows: { id: string; note: string | null; amount: number; occurredAt: string }[];
};

function parseCategoryDetail(value: Json): CategoryDetailPage {
  const root = asRecord(value) ?? {};
  return {
    count: asNumber(root.count),
    amount: asNumber(root.amount),
    notes: asRows(root.notes, (row) => {
      const name = asString(row.name);
      return name ? { name, amount: asNumber(row.amount), count: asNumber(row.count) } : null;
    }),
    days: asRows(root.days, (row) => {
      const date = asString(row.date);
      return date ? { date, amount: asNumber(row.amount) } : null;
    }),
    rows: asRows(root.rows, (row) => {
      const id = asString(row.id);
      const occurredAt = asString(row.occurredAt);
      return id && occurredAt ? { id, occurredAt, note: asString(row.note), amount: asNumber(row.amount) } : null;
    }),
  };
}

async function fetchCategoryDetail(
  input: CategoryDetailInput,
  cursor?: { occurredAt: string; id: string },
): Promise<CategoryDetailPage> {
  const { data, error } = await supabase.rpc('get_report_category_detail', {
    p_start: input.start,
    p_end: input.end,
    p_history_start: input.historyStart,
    p_category_ids: input.categoryIds,
    p_cursor_occurred_at: cursor?.occurredAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  });
  if (error) throw error;
  return parseCategoryDetail(data);
}

export function useCategoryDetail(input: CategoryDetailInput | null) {
  return useInfiniteQuery({
    queryKey: ['analytics', 'report-category-detail', input] as const,
    queryFn: ({ pageParam }) => fetchCategoryDetail(input as CategoryDetailInput, pageParam),
    initialPageParam: undefined as { occurredAt: string; id: string } | undefined,
    getNextPageParam: (lastPage) => {
      const last = lastPage.rows.at(-1);
      return lastPage.rows.length === 50 && last ? { occurredAt: last.occurredAt, id: last.id } : undefined;
    },
    enabled: !!input,
  });
}

export type SearchTransactionsInput = {
  keyword: string;
  keywordCategoryIds: string[];
  keywordRecorderIds: string[];
  types: ('income' | 'expense')[];
  categoryIds: string[];
  recorderIds: string[];
  datePreset: string;
  customFrom: string | null;
  customTo: string | null;
  amountMin: number | null;
  amountMax: number | null;
};
export type SearchTransactionRow = {
  id: string;
  familyId: string;
  type: 'income' | 'expense';
  amount: number;
  categoryId: string;
  recorderUserId: string;
  note: string | null;
  occurredAt: string;
  source: string;
  updatedAt: string;
  lastEditorUserId: string | null;
};
export type SearchTransactionsPage = {
  count: number;
  expenseAmount: number;
  incomeAmount: number;
  rows: SearchTransactionRow[];
};

function parseSearchTransactions(value: Json): SearchTransactionsPage {
  const root = asRecord(value) ?? {};
  return {
    count: asNumber(root.count),
    expenseAmount: asNumber(root.expenseAmount),
    incomeAmount: asNumber(root.incomeAmount),
    rows: asRows(root.rows, (row) => {
      const id = asString(row.id);
      const familyId = asString(row.familyId);
      const type = asString(row.type);
      const categoryId = asString(row.categoryId);
      const recorderUserId = asString(row.recorderUserId);
      const occurredAt = asString(row.occurredAt);
      const source = asString(row.source);
      const updatedAt = asString(row.updatedAt);
      return id &&
        familyId &&
        (type === 'income' || type === 'expense') &&
        categoryId &&
        recorderUserId &&
        occurredAt &&
        source &&
        updatedAt
        ? {
            id,
            familyId,
            type,
            categoryId,
            recorderUserId,
            occurredAt,
            source,
            updatedAt,
            note: asString(row.note),
            lastEditorUserId: asString(row.lastEditorUserId),
            amount: asNumber(row.amount),
          }
        : null;
    }),
  };
}

async function fetchSearchTransactions(
  input: SearchTransactionsInput,
  cursor?: { occurredAt: string; id: string },
): Promise<SearchTransactionsPage> {
  const { data, error } = await supabase.rpc('search_transactions', {
    p_keyword: input.keyword,
    p_keyword_category_ids: input.keywordCategoryIds,
    p_keyword_recorder_ids: input.keywordRecorderIds,
    p_types: input.types,
    p_category_ids: input.categoryIds,
    p_recorder_ids: input.recorderIds,
    p_date_preset: input.datePreset,
    p_custom_from: input.customFrom,
    p_custom_to: input.customTo,
    p_amount_min: input.amountMin,
    p_amount_max: input.amountMax,
    p_cursor_occurred_at: cursor?.occurredAt ?? null,
    p_cursor_id: cursor?.id ?? null,
  });
  if (error) throw error;
  return parseSearchTransactions(data);
}

export function useSearchTransactions(input: SearchTransactionsInput | null) {
  return useInfiniteQuery({
    queryKey: ['analytics', 'search', input] as const,
    queryFn: ({ pageParam }) => fetchSearchTransactions(input as SearchTransactionsInput, pageParam),
    initialPageParam: undefined as { occurredAt: string; id: string } | undefined,
    getNextPageParam: (lastPage) => {
      const last = lastPage.rows.at(-1);
      return lastPage.rows.length === 50 && last ? { occurredAt: last.occurredAt, id: last.id } : undefined;
    },
    enabled: !!input,
  });
}
