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

/** 按主键读取单笔流水；用于聚合卡片跳转到具体流水详情，不承担列表加载。 */
export async function fetchTransaction(id: string): Promise<Transaction | null> {
  const { data, error } = await supabase.from('transactions').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export function useTransaction(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.transaction(id ?? ''),
    queryFn: () => fetchTransaction(id as string),
    enabled: !!id,
  });
}

/** 仅判断家庭是否已有任意流水，避免记账面板为「首笔」提示加载历史列表。 */
export async function fetchHasTransactions(familyId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('transactions')
    .select('id')
    .eq('family_id', familyId)
    .eq('is_deleted', false)
    .limit(1);
  if (error) throw error;
  return data.length > 0;
}

export function useHasTransactions(familyId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.hasTransactions(familyId ?? ''),
    queryFn: () => fetchHasTransactions(familyId as string),
    enabled: !!familyId,
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
        qc.invalidateQueries({ queryKey: queryKeys.analytics }),
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
        qc.invalidateQueries({ queryKey: queryKeys.analytics }),
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
        qc.invalidateQueries({ queryKey: queryKeys.analytics }),
        qc.invalidateQueries({ queryKey: ['home_dashboard'] }),
      ]),
  });
}
