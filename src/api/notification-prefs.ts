/**
 * 通知分类开关（PRD §18.3.3 / DATAMODEL §5.6 / 流程 13 §15）。
 * 服务端持久化：notification_preferences 每用户一行、六列布尔，RLS 仅本人可读写。
 * 客户端直读 + upsert（onConflict = user_id）；行不存在（老用户 / 从未改过）→ 回落全开默认。
 *
 * 本表只落用户「愿不愿收该类系统推送」的意愿：关掉某类仅停系统推送，App 内通知中心始终可见。
 * 系统推送（expo-notifications + APNs）尚未接入，落地后由投递侧读取本表决定是否推送对应分类。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

/** 六类推送分类键（映射流程 13 §15 事件清单）。 */
export type NotificationCategoryKey =
  | 'family_activity'
  | 'budget_alert'
  | 'savings_progress'
  | 'monthly_summary'
  | 'member_change'
  | 'account_security';

export type NotificationPrefs = Record<NotificationCategoryKey, boolean>;

/** 展示顺序即页面从上到下的顺序，也是唯一的分类真源。 */
export const NOTIFICATION_CATEGORY_KEYS: NotificationCategoryKey[] = [
  'family_activity',
  'budget_alert',
  'savings_progress',
  'monthly_summary',
  'member_change',
  'account_security',
];

/** 默认全开：多数用户希望收到全部提醒，且行不存在时以此兜底、开关无跳变。 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  family_activity: true,
  budget_alert: true,
  savings_progress: true,
  monthly_summary: true,
  member_change: true,
  account_security: true,
};

/** 本人通知偏好；行不存在时回落全开默认（RLS 保证只查得到自己）。 */
export async function fetchNotificationPrefs(): Promise<NotificationPrefs> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('未登录');

  const { data, error } = await supabase
    .from('notification_preferences')
    .select('family_activity, budget_alert, savings_progress, monthly_summary, member_change, account_security')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_NOTIFICATION_PREFS };

  // 与默认合并：即便将来加列、旧行缺字段也回落默认，不会读出 undefined。
  return { ...DEFAULT_NOTIFICATION_PREFS, ...data };
}

export function useNotificationPrefs() {
  return useQuery({ queryKey: queryKeys.notificationPrefs, queryFn: fetchNotificationPrefs });
}

/** upsert 整行偏好（客户端持有全部六值，整行写避免动态列 SQL）。 */
export async function saveNotificationPrefs(next: NotificationPrefs): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('未登录');

  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: user.id, ...next }, { onConflict: 'user_id' });
  if (error) throw error;
}

/** 保存偏好：乐观更新让开关即时响应，失败回滚，落定后失效重拉。 */
export function useSaveNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveNotificationPrefs,
    onMutate: async (next: NotificationPrefs) => {
      await qc.cancelQueries({ queryKey: queryKeys.notificationPrefs });
      const prev = qc.getQueryData<NotificationPrefs>(queryKeys.notificationPrefs);
      qc.setQueryData(queryKeys.notificationPrefs, next);
      return { prev };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.notificationPrefs, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.notificationPrefs }),
  });
}
