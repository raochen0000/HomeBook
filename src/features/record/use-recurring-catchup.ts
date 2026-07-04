/**
 * 定时收支补记（PRD §18 自定义能力）。挂在根布局：登录态下、App 进前台时调
 * generate_due_recurring_transactions() RPC，补记缺失的到期流水（服务端幂等，多设备安全）。
 *
 * 采用「客户端触发、服务端幂等生成」：无需 cron/Edge Function 基建，契合自托管 + 防火墙约束；
 * 代价是需 App 至少每月打开一次（对活跃记账用户几乎无感）。按天节流（AsyncStorage 记上次补记日），
 * 避免每次前台都打后端；RPC 本身幂等，即便偶发重复调用也不会重复记账。新建/编辑规则后由
 * 列表页另行显式触发一次（不受节流限制），使新规则立即生效。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { generateDueRecurring, queryKeys } from '@/api';
import { useSession } from '@/lib/auth';

const LAST_CATCHUP_KEY = 'recurring.lastCatchupDate';

/** 本地「年-月-日」日键（按天节流）。 */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function useRecurringCatchup() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;
  const qc = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;

    const run = async () => {
      if (running.current) return;
      const today = todayKey();
      const last = await AsyncStorage.getItem(LAST_CATCHUP_KEY).catch(() => null);
      if (last === today) return; // 今天已补记过，跳过
      running.current = true;
      try {
        const n = await generateDueRecurring();
        await AsyncStorage.setItem(LAST_CATCHUP_KEY, today).catch(() => {});
        if (active && n > 0) qc.invalidateQueries({ queryKey: queryKeys.transactions });
      } catch (e) {
        if (__DEV__) console.warn('[recurring] 补记失败', e);
      } finally {
        running.current = false;
      }
    };

    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [userId, qc]);
}
