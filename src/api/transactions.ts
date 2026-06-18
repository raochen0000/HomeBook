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

/** 当前家庭未删除流水，按记账时间倒序（RLS 已隔离家庭）。 */
export async function fetchTransactions(): Promise<Transaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('is_deleted', false)
    .order('occurred_at', { ascending: false });
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
