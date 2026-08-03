/** 流水数据访问 + React Query hooks。金额单位：分（bigint）。 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createHomeTransactionPage,
  HOME_TRANSACTION_PAGE_SIZE,
  homeTransactionCursorFilter,
  type HomeTransactionPage,
  type TransactionCursor,
} from '@/features/home/home-data';
import type { Tables, TablesInsert } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type Transaction = Tables<'transactions'>;

/** 记一笔所需字段（family_id / recorder_user_id 由调用方按当前登录态填入）。 */
export type NewTransaction = Pick<
  TablesInsert<'transactions'>,
  'family_id' | 'type' | 'amount' | 'category_id' | 'recorder_user_id' | 'note' | 'occurred_at'
>;

/** 编辑流水可改字段（family_id 创建后不可变，不在此列）。 */
export type EditTransaction = {
  id: string;
  type: 'expense' | 'income';
  amount: number;
  category_id: string;
  note: string | null;
  occurred_at: string;
  recorder_user_id: string;
};

/**
 * 一次拉取的流水条数上限（减轻后端压力；暂不做真正分页）。
 * 搜索、记账等既有页面沿用该上限；首页改用独立的游标分页和服务端概览。
 */
export const TXN_FETCH_LIMIT = 200;

/**
 * 按周期范围拉取时的上限（报表页跨多期分析用）。报表的「收支对比」最多回看 6 期，
 * 年维度即 6 年，故上限放宽到覆盖多年历史；仍受 RLS 家庭隔离。
 */
export const TXN_RANGE_FETCH_LIMIT = 5000;

/** 报表按周期拉取用的时间窗（ISO，半开区间 [from, to)，与前端 inRange 口径一致）。 */
export type TxnRange = { from: string; to: string };

/**
 * 当前家庭未删除流水，按记账时间倒序（RLS 已隔离家庭）。
 * 不传 range：沿用「最近 TXN_FETCH_LIMIT 条」（首页 / 搜索 / 记账等既有口径，行为不变）。
 * 传 range：按 occurred_at ∈ [from, to) 过滤，上限放宽到 TXN_RANGE_FETCH_LIMIT（报表跨期分析用）。
 */
export async function fetchTransactions(range?: TxnRange): Promise<Transaction[]> {
  let query = supabase
    .from('transactions')
    .select('*')
    .eq('is_deleted', false)
    .order('occurred_at', { ascending: false });
  query = range
    ? query.gte('occurred_at', range.from).lt('occurred_at', range.to).limit(TXN_RANGE_FETCH_LIMIT)
    : query.limit(TXN_FETCH_LIMIT);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/**
 * 传 range 时按时间窗拉取（key 含 from/to，切维度/翻期自动重取）；不传维持既有默认。
 * 失效仍走 queryKeys.transactions 前缀，能一并命中带 range 的变体。
 */
export function useTransactions(range?: TxnRange) {
  return useQuery({
    queryKey: range ? [...queryKeys.transactions, range.from, range.to] : queryKeys.transactions,
    queryFn: () => fetchTransactions(range),
  });
}

export type HomeTransactionFeedPage = HomeTransactionPage<Transaction>;

async function fetchHomeTransactionFeedPage(
  familyId: string,
  cursor: TransactionCursor | undefined,
): Promise<HomeTransactionFeedPage> {
  let query = supabase
    .from('transactions')
    .select('*')
    .eq('family_id', familyId)
    .eq('is_deleted', false)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(HOME_TRANSACTION_PAGE_SIZE);

  if (cursor) {
    query = query.or(homeTransactionCursorFilter(cursor));
  }

  const { data, error } = await query;
  if (error) throw error;
  return createHomeTransactionPage(data);
}

/**
 * 首页专用流水 feed：显式按家庭过滤，首屏 30 条，后续页用 (occurred_at, id) 复合游标追加。
 * query key 保持在 transactions 前缀下，现有记账 mutation 会同时使其失效。
 */
export function useHomeTransactionFeed(familyId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.transactions, 'home-feed', familyId] as const,
    queryFn: ({ pageParam }) => fetchHomeTransactionFeedPage(familyId as string, pageParam),
    initialPageParam: undefined as TransactionCursor | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!familyId,
  });
}

export async function createTransaction(input: NewTransaction): Promise<Transaction> {
  const { data, error } = await supabase.from('transactions').insert(input).select('*').single();
  if (error) throw error;
  return data;
}

export function useCreateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createTransaction,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.transactions }),
        qc.invalidateQueries({ queryKey: ['home_dashboard'] }),
      ]),
  });
}

/** 编辑流水：仅更新可改字段（family_id 不可变，由 DB 触发器兜底拒绝）。 */
export async function updateTransaction(input: EditTransaction): Promise<Transaction> {
  const { id, ...patch } = input;
  const { data, error } = await supabase.from('transactions').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateTransaction,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.transactions }),
        qc.invalidateQueries({ queryKey: ['home_dashboard'] }),
      ]),
  });
}

/** 软删除：置 is_deleted=true（不物理删除）。 */
export async function softDeleteTransaction(id: string): Promise<void> {
  const { error } = await supabase.from('transactions').update({ is_deleted: true }).eq('id', id);
  if (error) throw error;
}

export function useSoftDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: softDeleteTransaction,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.transactions }),
        qc.invalidateQueries({ queryKey: ['home_dashboard'] }),
      ]),
  });
}
