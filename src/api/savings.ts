/** 储蓄目标数据访问 + 存取 RPC（方案 B 资金闭环，带乐观锁）。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type SavingsGoal = Tables<'savings_goals'>;

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
