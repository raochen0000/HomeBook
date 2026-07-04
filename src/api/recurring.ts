/**
 * 定时收支规则（PRD §18 自定义能力 / DATAMODEL §5.9）。金额单位：分。
 * 家庭共享：list 由 RLS 隔离到当前家庭（同 transactions）。规则本身可增删改；生成的流水
 * 由 generate_due_recurring_transactions() RPC 在服务端幂等补记（见 use-recurring-catchup）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tables, TablesInsert } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type RecurringRule = Tables<'recurring_transactions'>;

/** 新建规则所需字段（family_id / recorder_user_id / created_by 由调用方按当前登录态填入）。 */
export type NewRecurringRule = Pick<
  TablesInsert<'recurring_transactions'>,
  | 'family_id'
  | 'type'
  | 'amount'
  | 'category_id'
  | 'note'
  | 'recorder_user_id'
  | 'created_by'
  | 'day_of_month'
  | 'start_date'
  | 'end_date'
>;

/** 编辑规则可改字段（family_id / created_by 创建后不可变，不在此列）。 */
export type EditRecurringRule = {
  id: string;
  type?: 'expense' | 'income';
  amount?: number;
  category_id?: string;
  note?: string | null;
  recorder_user_id?: string;
  day_of_month?: number;
  start_date?: string;
  end_date?: string | null;
  enabled?: boolean;
};

/** 当前家庭全部定时收支规则，按记账日升序（RLS 已隔离家庭）。 */
export async function fetchRecurringRules(): Promise<RecurringRule[]> {
  const { data, error } = await supabase
    .from('recurring_transactions')
    .select('*')
    .order('day_of_month', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data;
}

export function useRecurringRules() {
  return useQuery({ queryKey: queryKeys.recurringRules, queryFn: fetchRecurringRules });
}

export async function createRecurringRule(input: NewRecurringRule): Promise<RecurringRule> {
  const { data, error } = await supabase.from('recurring_transactions').insert(input).select('*').single();
  if (error) throw error;
  return data;
}

export function useCreateRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createRecurringRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.recurringRules }),
  });
}

/** 编辑规则（含 enabled 开关）：只更新传入字段。 */
export async function updateRecurringRule(input: EditRecurringRule): Promise<RecurringRule> {
  const { id, ...patch } = input;
  const { data, error } = await supabase.from('recurring_transactions').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export function useUpdateRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateRecurringRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.recurringRules }),
  });
}

/** 删除规则（物理删除；已生成的历史流水不受影响，recurring_runs 随规则级联清理）。 */
export async function deleteRecurringRule(id: string): Promise<void> {
  const { error } = await supabase.from('recurring_transactions').delete().eq('id', id);
  if (error) throw error;
}

export function useDeleteRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteRecurringRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.recurringRules }),
  });
}

/** 补记当前家庭到期的定时收支（幂等 RPC），返回本次新生成条数。 */
export async function generateDueRecurring(): Promise<number> {
  const { data, error } = await supabase.rpc('generate_due_recurring_transactions');
  if (error) throw error;
  return data ?? 0;
}

/** 显式触发一次补记（新建 / 编辑规则后用，使新规则立即生效）；生成后失效流水缓存。 */
export function useGenerateDueRecurring() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: generateDueRecurring,
    onSuccess: (n) => {
      if (n > 0) qc.invalidateQueries({ queryKey: queryKeys.transactions });
    },
  });
}
