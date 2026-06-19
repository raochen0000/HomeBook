/** 预算（流程 8）：总预算 + 分类预算 CRUD（直连表，RLS 允许家庭成员写；仅户主可改由 UI 校验）。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type Budget = Tables<'budgets'>;
export type BudgetCategory = Tables<'budget_categories'>;
export type BudgetBundle = { budget: Budget | null; categories: BudgetCategory[] };

/** 取某账期（YYYY-MM）的预算（含分类预算）；RLS 仅返回本家庭。 */
export async function fetchBudget(period: string): Promise<BudgetBundle> {
  const { data: budget, error } = await supabase.from('budgets').select('*').eq('period', period).maybeSingle();
  if (error) throw error;
  if (!budget) return { budget: null, categories: [] };
  const { data: cats, error: e2 } = await supabase.from('budget_categories').select('*').eq('budget_id', budget.id);
  if (e2) throw e2;
  return { budget, categories: cats ?? [] };
}

export function useBudget(period: string) {
  return useQuery({ queryKey: queryKeys.budget(period), queryFn: () => fetchBudget(period) });
}

export type SaveBudgetInput = {
  familyId: string;
  period: string;
  totalAmount: number;
  alertEnabled: boolean;
  categories: { category_id: string; amount: number }[];
};

/** 保存预算：upsert 总预算 + 全量替换分类预算（户主操作）。 */
export async function saveBudget(input: SaveBudgetInput): Promise<void> {
  const existing = await supabase.from('budgets').select('id').eq('period', input.period).maybeSingle();
  if (existing.error) throw existing.error;

  let budgetId: string;
  if (existing.data) {
    budgetId = existing.data.id;
    const { error } = await supabase
      .from('budgets')
      .update({ total_amount: input.totalAmount, alert_enabled: input.alertEnabled })
      .eq('id', budgetId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('budgets')
      .insert({
        family_id: input.familyId,
        period: input.period,
        total_amount: input.totalAmount,
        alert_enabled: input.alertEnabled,
      })
      .select('id')
      .single();
    if (error) throw error;
    budgetId = data.id;
  }

  // 全量替换分类预算（先删后插；amount 必须 > 0）
  const del = await supabase.from('budget_categories').delete().eq('budget_id', budgetId);
  if (del.error) throw del.error;
  const rows = input.categories
    .filter((c) => c.amount > 0)
    .map((c) => ({ budget_id: budgetId, category_id: c.category_id, amount: c.amount }));
  if (rows.length > 0) {
    const { error } = await supabase.from('budget_categories').insert(rows);
    if (error) throw error;
  }
}

export function useSaveBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveBudget,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budget'] }),
  });
}
