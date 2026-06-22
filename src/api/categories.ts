/** 分类数据访问 + React Query hooks。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type Category = Tables<'categories'>;
export type CategoryType = 'expense' | 'income';

/** 拉取可用分类（系统预设 + 当前家庭，RLS 已过滤）；系统分类排在前。 */
export async function fetchCategories(type?: 'expense' | 'income'): Promise<Category[]> {
  let query = supabase
    .from('categories')
    .select('*')
    .eq('status', 'active')
    .order('is_system', { ascending: false })
    .order('name', { ascending: true });
  if (type) query = query.eq('type', type);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export function useCategories(type?: 'expense' | 'income') {
  return useQuery({
    queryKey: queryKeys.categories(type),
    queryFn: () => fetchCategories(type),
  });
}

// ── 按家庭隐藏系统分类（流程 11 / MVP §2.4）──────────────────────────────────
// 系统分类是全局单行，不能改其全局 status；隐藏走 family_hidden_categories 覆盖表。
// 隐藏项在全局仍 active，故 useCategories() 仍能解析历史流水的分类名（显示零回归），
// 只在「记账/预算选择器」用 useVisibleCategories 剔除。

/** 当前家庭隐藏的系统分类 id（RLS 已按家庭过滤，无需传 family_id）。 */
export async function fetchHiddenCategoryIds(): Promise<string[]> {
  const { data, error } = await supabase.from('family_hidden_categories').select('category_id');
  if (error) throw error;
  return data.map((r) => r.category_id);
}

export function useHiddenCategoryIds() {
  return useQuery({
    queryKey: queryKeys.hiddenCategories,
    queryFn: fetchHiddenCategoryIds,
    select: (ids) => new Set(ids),
  });
}

// ── 自定义分类管理（流程 11）─────────────────────────────────────────────────
// RLS：家庭成员可对 family_id 非空的分类增改；系统分类（family_id=null）全局只读。

export type NewCategory = { family_id: string; name: string; icon: string; type: CategoryType };

export async function createCategory(input: NewCategory): Promise<Category> {
  const { data, error } = await supabase
    .from('categories')
    .insert({ ...input, is_system: false, status: 'active' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateCategory(id: string, patch: { name?: string; icon?: string }): Promise<Category> {
  const { data, error } = await supabase.from('categories').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

/** 停用（软删除）自定义分类——历史流水仍显示原分类名（DATAMODEL §3.5）。 */
export async function archiveCategory(id: string): Promise<void> {
  const { error } = await supabase.from('categories').update({ status: 'archived' }).eq('id', id);
  if (error) throw error;
}

/** 隐藏系统分类（按家庭覆盖，幂等）。 */
export async function hideSystemCategory(familyId: string, categoryId: string): Promise<void> {
  const { error } = await supabase
    .from('family_hidden_categories')
    .upsert({ family_id: familyId, category_id: categoryId }, { onConflict: 'family_id,category_id' });
  if (error) throw error;
}

/** 取消隐藏系统分类。 */
export async function unhideSystemCategory(familyId: string, categoryId: string): Promise<void> {
  const { error } = await supabase
    .from('family_hidden_categories')
    .delete()
    .eq('family_id', familyId)
    .eq('category_id', categoryId);
  if (error) throw error;
}

/** 任一分类写操作都让全部 categories + 隐藏覆盖查询失效。 */
function useCategoryMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: queryKeys.hiddenCategories });
    },
  });
}

export function useCreateCategory() {
  return useCategoryMutation((input: NewCategory) => createCategory(input));
}

export function useUpdateCategory() {
  return useCategoryMutation(({ id, ...patch }: { id: string; name?: string; icon?: string }) =>
    updateCategory(id, patch),
  );
}

export function useArchiveCategory() {
  return useCategoryMutation((id: string) => archiveCategory(id));
}

export function useHideSystemCategory() {
  return useCategoryMutation(({ familyId, categoryId }: { familyId: string; categoryId: string }) =>
    hideSystemCategory(familyId, categoryId),
  );
}

export function useUnhideSystemCategory() {
  return useCategoryMutation(({ familyId, categoryId }: { familyId: string; categoryId: string }) =>
    unhideSystemCategory(familyId, categoryId),
  );
}
