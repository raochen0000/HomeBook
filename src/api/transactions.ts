/** 流水数据访问 + React Query hooks。金额单位：分（bigint）。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

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
 * 注意：脉搏卡的本月汇总仍由前端基于该结果集计算，所以上限必须足够覆盖「本月」全部流水；
 * 200 对绝大多数家庭都绰绰有余，后续如需更大历史再升级为分页 + 服务端汇总。
 */
export const TXN_FETCH_LIMIT = 200;

/** 当前家庭未删除流水，按记账时间倒序，最多 TXN_FETCH_LIMIT 条（RLS 已隔离家庭）。 */
export async function fetchTransactions(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('is_deleted', false)
    .order('occurred_at', { ascending: false })
    .limit(TXN_FETCH_LIMIT);
  if (error) throw error;
  return data;
}

export function useTransactions() {
  return useQuery({ queryKey: queryKeys.transactions, queryFn: fetchTransactions });
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions }),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.transactions }),
  });
}
