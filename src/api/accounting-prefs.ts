/**
 * 记账偏好（PRD §18.3.1 / DATAMODEL §5.8）。
 * 服务端持久化：accounting_preferences 每用户一行，RLS 仅本人可读写。
 * 客户端直读 + 整行 upsert（onConflict = user_id）；行不存在（老用户 / 从未改过）→ 回落默认。
 *
 * 收纳「仅影响本人视角」的偏好：默认记账类型、记一笔后行为、金额隐私、报表卡片显隐 / 排序。
 * 报表卡片的排序 / 隐藏语义见 @/lib/report-cards（注册表 + resolveCardLayout）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase';

import { queryKeys } from './keys';

export type DefaultTxnType = 'expense' | 'income';
export type AfterRecordBehavior = 'close' | 'continue';

export type AccountingPrefs = {
  default_txn_type: DefaultTxnType;
  after_record_behavior: AfterRecordBehavior;
  amount_privacy: boolean;
  report_card_order: string[];
  report_card_hidden: string[];
  show_monthly_summary_entry: boolean;
};

/** 默认值：与迁移 0028/0030 的列默认一致；行不存在时以此兜底，控件无跳变。 */
export const DEFAULT_ACCOUNTING_PREFS: AccountingPrefs = {
  default_txn_type: 'expense',
  after_record_behavior: 'close',
  amount_privacy: false,
  report_card_order: [],
  report_card_hidden: [],
  show_monthly_summary_entry: true,
};

const COLUMNS =
  'default_txn_type, after_record_behavior, amount_privacy, report_card_order, report_card_hidden, show_monthly_summary_entry';

/** 本人记账偏好；行不存在时回落默认（RLS 保证只查得到自己）。 */
export async function fetchAccountingPrefs(): Promise<AccountingPrefs> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('未登录');

  const { data, error } = await supabase
    .from('accounting_preferences')
    .select(COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_ACCOUNTING_PREFS };

  // 与默认合并：即便将来加列、旧行缺字段也回落默认，不会读出 undefined。
  return { ...DEFAULT_ACCOUNTING_PREFS, ...data } as AccountingPrefs;
}

export function useAccountingPrefs() {
  return useQuery({ queryKey: queryKeys.accountingPrefs, queryFn: fetchAccountingPrefs });
}

/** upsert 整行偏好（客户端持有全部字段，整行写避免动态列 SQL）。 */
export async function saveAccountingPrefs(next: AccountingPrefs): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('未登录');

  const { error } = await supabase
    .from('accounting_preferences')
    .upsert({ user_id: user.id, ...next }, { onConflict: 'user_id' });
  if (error) throw error;
}

/** 保存偏好：乐观更新让控件即时响应，失败回滚，落定后失效重拉。 */
export function useSaveAccountingPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveAccountingPrefs,
    onMutate: async (next: AccountingPrefs) => {
      await qc.cancelQueries({ queryKey: queryKeys.accountingPrefs });
      const prev = qc.getQueryData<AccountingPrefs>(queryKeys.accountingPrefs);
      qc.setQueryData(queryKeys.accountingPrefs, next);
      return { prev };
    },
    onError: (_err, _next, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.accountingPrefs, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.accountingPrefs }),
  });
}
