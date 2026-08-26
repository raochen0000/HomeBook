/**
 * 通知（流程 13 关键子集）：App 内只暂存未处理消息；用户阅读或确认后立即删除。
 * 通知中心固定展示最新 100 条，不做分页、归档或已读留存。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { Tables } from '@/lib/database.types';
import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type Notification = Tables<'notifications'>;

/** 本人尚未处理的 App 内通知，按时间倒序（RLS 仅返回本人）。 */
export async function fetchUnreadNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('channel', 'in_app')
    .order('created_at', { ascending: false })
    .limit(100);
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

/** 通知中心：本人最新 100 条尚未处理的 App 内通知，按时间倒序。 */
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

export async function deleteNotification(id: string): Promise<void> {
  const { error } = await supabase.from('notifications').delete().eq('id', id).eq('channel', 'in_app');
  if (error) throw error;
}

/** 仅删除当前通知中心展示的消息，不会误删未显示的较早通知。 */
export async function deleteNotifications(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from('notifications').delete().in('id', ids).eq('channel', 'in_app');
  if (error) throw error;
}

/** 删除后让通知中心与关键兜底查询同步刷新（按 ['notifications'] 前缀）。 */
export function useDeleteNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

export function useDeleteNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteNotifications,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}
