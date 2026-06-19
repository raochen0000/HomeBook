/** 通知（流程 13 关键子集）：被移除 / 家庭解散 / 户主转让 的 App 内兜底提示。 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type Notification = Tables<'notifications'>;

/** 本人未读的 App 内通知，按时间倒序（RLS 仅返回本人）。 */
export async function fetchUnreadNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .is('read_at', null)
    .eq('channel', 'in_app')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export function useUnreadNotifications() {
  return useQuery({
    queryKey: queryKeys.notifications,
    queryFn: fetchUnreadNotifications,
    // 兜底实时性：前台聚焦时重新拉取（MVP 未接 Realtime）。
    refetchOnWindowFocus: true,
  });
}

/** 通知中心：本人全部 App 内通知（含已读），按时间倒序。 */
export async function fetchAllNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('channel', 'in_app')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}

export function useAllNotifications() {
  return useQuery({
    queryKey: queryKeys.notificationsAll,
    queryFn: fetchAllNotifications,
    refetchOnWindowFocus: true,
  });
}

export async function markNotificationRead(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}

export async function markAllNotificationsRead(): Promise<void> {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null);
  if (error) throw error;
}

/** 标记已读后让未读与全部两个查询都失效（按 ['notifications'] 前缀）。 */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}
