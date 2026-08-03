import { useQuery } from '@tanstack/react-query';

import type { Database } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type HomeDashboard = Database['public']['Functions']['get_home_dashboard']['Returns'][number];

export async function fetchHomeDashboard(period: string): Promise<HomeDashboard | null> {
  const { data, error } = await supabase.rpc('get_home_dashboard', { p_period: period }).maybeSingle();
  if (error) throw error;
  return data;
}

export function useHomeDashboard(period: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.homeDashboard(period),
    queryFn: () => fetchHomeDashboard(period),
    enabled,
  });
}
