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

/** 保存预算：由服务端在同一事务内校验并替换一级分类预算。 */
export async function saveBudget(input: SaveBudgetInput): Promise<void> {
  const { error } = await supabase.rpc('save_family_budget', {
    p_family_id: input.familyId,
    p_period: input.period,
    p_total_amount: input.totalAmount,
    p_alert_enabled: input.alertEnabled,
    p_categories: input.categories.filter((category) => category.amount > 0),
  });
  if (error) throw error;
}

export function useSaveBudget() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveBudget,
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['budget'] }),
        // 首页 Hero 的预算总额来自 get_home_dashboard，保存后需一并刷新。
        qc.invalidateQueries({ queryKey: ['home_dashboard'] }),
      ]),
  });
}
