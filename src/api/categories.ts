/** 分类数据访问 + React Query hooks。 */
import { useQuery } from '@tanstack/react-query';

import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type Category = Tables<'categories'>;

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
