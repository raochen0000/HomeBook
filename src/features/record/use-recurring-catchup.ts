/**
 * 定时收支补记（PRD §18 自定义能力）。挂在根布局：登录态下、首屏可交互后或 App 进前台时调
 * generate_due_recurring_transactions() RPC，补记缺失的到期流水（服务端幂等，多设备安全）。
 *
 * 后台定时任务是主要生成途径；此 RPC 是前台补记和旧版客户端兼容路径。按天节流
 * 减少重复请求；服务端以同一期和同一天去重，并且不会在所选北京时间之前生成当天的流水。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState, InteractionManager } from 'react-native';

import { generateDueRecurring, queryKeys } from '@/api';
import { useSession } from '@/lib/auth';

const LAST_CATCHUP_KEY = 'recurring.lastCatchupDate';
/** 首屏交互后再等一小段，避免与 dashboard / 流水首屏抢网。 */
const CATCHUP_YIELD_MS = 1500;

/** 本地「年-月-日」日键（按天节流）。 */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function useRecurringCatchup() {
  const { session, offline } = useSession();
  const userId = offline ? null : (session?.user.id ?? null);
  const qc = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    let initialPaintPending = true;
    let yieldTimer: ReturnType<typeof setTimeout> | null = null;
    let interactionHandle: { cancel: () => void } | null = null;

    const run = async () => {
      if (running.current) return;
      const today = todayKey();
      const last = await AsyncStorage.getItem(LAST_CATCHUP_KEY).catch(() => null);
      if (last === today) return; // 今天已补记过，跳过
      running.current = true;
      try {
        const n = await generateDueRecurring();
        await AsyncStorage.setItem(LAST_CATCHUP_KEY, today).catch(() => {});
        if (active && n > 0) {
          await Promise.all([
            qc.invalidateQueries({ queryKey: queryKeys.transactions }),
            qc.invalidateQueries({ queryKey: ['home_dashboard'] }),
          ]);
        }
      } catch (e) {
        if (__DEV__) console.warn('[recurring] 补记失败', e);
      } finally {
        running.current = false;
      }
    };

    // 等首屏交互完成后再短延迟补记，让概览与首个流水页先占网。
    interactionHandle = InteractionManager.runAfterInteractions(() => {
      yieldTimer = setTimeout(() => {
        initialPaintPending = false;
        run();
      }, CATCHUP_YIELD_MS);
    });
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && !initialPaintPending) run();
    });
    return () => {
      active = false;
      interactionHandle?.cancel();
      if (yieldTimer) clearTimeout(yieldTimer);
      sub.remove();
    };
  }, [userId, qc]);
}
