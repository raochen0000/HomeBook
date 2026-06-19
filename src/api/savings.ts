/** 储蓄目标数据访问 + 存取 RPC（方案 B 资金闭环，带乐观锁）。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type SavingsGoal = Tables<'savings_goals'>;
export type SavingsEntry = Tables<'savings_entries'>;

export async function fetchSavingsGoals(): Promise<SavingsGoal[]> {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export function useSavingsGoals() {
  return useQuery({ queryKey: queryKeys.savingsGoals, queryFn: fetchSavingsGoals });
}

/** 某目标的存取记录（倒序）。 */
export async function fetchSavingsEntries(goalId: string): Promise<SavingsEntry[]> {
  const { data, error } = await supabase
    .from('savings_entries')
    .select('*')
    .eq('goal_id', goalId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export function useSavingsEntries(goalId: string | null) {
  return useQuery({
    queryKey: queryKeys.savingsEntries(goalId ?? ''),
    queryFn: () => fetchSavingsEntries(goalId as string),
    enabled: !!goalId,
  });
}

// ── 目标 CRUD（创建/编辑直连表，RLS 允许家庭成员写；删除走 RPC 做资金回吐）──────

export type NewGoal = {
  family_id: string;
  name: string;
  target_amount: number;
  deadline?: string | null;
  note?: string | null;
};

export async function createGoal(input: NewGoal): Promise<SavingsGoal> {
  const { data, error } = await supabase.from('savings_goals').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateGoal(
  id: string,
  patch: { name?: string; target_amount?: number; deadline?: string | null; note?: string | null },
): Promise<SavingsGoal> {
  const { data, error } = await supabase.from('savings_goals').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** 删除目标：已存余额回吐为收入流水（仅户主，走 RPC 保证原子）。 */
export async function deleteGoal(goalId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_savings_goal', { p_goal_id: goalId });
  if (error) throw error;
}

/** 目标增改删都影响目标列表；删除还会生成流水。 */
function useGoalMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.savingsGoals });
      qc.invalidateQueries({ queryKey: queryKeys.transactions });
    },
  });
}

export function useCreateGoal() {
  return useGoalMutation((input: NewGoal) => createGoal(input));
}

export function useUpdateGoal() {
  return useGoalMutation(
    ({
      id,
      ...patch
    }: {
      id: string;
      name?: string;
      target_amount?: number;
      deadline?: string | null;
      note?: string | null;
    }) => updateGoal(id, patch),
  );
}

export function useDeleteGoal() {
  return useGoalMutation((goalId: string) => deleteGoal(goalId));
}

/** 存入：金额单位分；version 为读取目标时的乐观锁版本号。 */
export async function savingsDeposit(
  goalId: string,
  amountCents: number,
  version: number,
  note = '',
): Promise<SavingsGoal> {
  const { data, error } = await supabase.rpc('savings_deposit', {
    p_goal_id: goalId,
    p_amount: amountCents,
    p_note: note,
    p_expected_version: version,
  });
  if (error) throw error;
  return data;
}

export async function savingsWithdraw(
  goalId: string,
  amountCents: number,
  version: number,
  note = '',
): Promise<SavingsGoal> {
  const { data, error } = await supabase.rpc('savings_withdraw', {
    p_goal_id: goalId,
    p_amount: amountCents,
    p_note: note,
    p_expected_version: version,
  });
  if (error) throw error;
  return data;
}

/** 存取会同时影响目标与流水，两者都失效。 */
function useSavingsMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.savingsGoals });
      qc.invalidateQueries({ queryKey: queryKeys.transactions });
      qc.invalidateQueries({ queryKey: ['savings_entries'] });
    },
  });
}

export type SavingsArgs = { goalId: string; amountCents: number; version: number; note?: string };

export function useSavingsDeposit() {
  return useSavingsMutation(({ goalId, amountCents, version, note }: SavingsArgs) =>
    savingsDeposit(goalId, amountCents, version, note),
  );
}

export function useSavingsWithdraw() {
  return useSavingsMutation(({ goalId, amountCents, version, note }: SavingsArgs) =>
    savingsWithdraw(goalId, amountCents, version, note),
  );
}
