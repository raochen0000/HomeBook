/**
 * 系统推送授权态（层级一 · 权限注册 / 本地通知）。通知设置页顶部引导条据此显隐「去开启」。
 *
 * 本期只做「读授权态 + 请求授权」：调过一次 requestPermissionsAsync 后，iOS 才会给本 App
 * 建「通知」设置行；此时读到的 granted/canAskAgain 即真实态。远程推送（APNs token + 投递）
 * 属层级二，需付费账号 + Push 能力 + 配置插件（aps-environment），另行接入。
 *
 * 授权态可能在系统设置里被用户改动，故 mount + 每次 App 回前台都重新读一次。
 * 原生模块经 getNotifications() 惰性安全加载：缺席（旧包未重编）时降级为 available=false，不崩溃。
 */
import type { NotificationPermissionsStatus } from 'expo-notifications';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { getNotifications } from './expo-notifications-safe';

export type PushPermission = {
  /** 已授权（可收系统通知）。 */
  granted: boolean;
  /** 仍可弹系统授权框（true=从未问过 / undetermined；false=已拒，需去系统设置改）。 */
  canAskAgain: boolean;
  /** 首次读取完成前为 false，用于避免引导条闪现。 */
  ready: boolean;
  /** 原生通知模块是否可用（旧包未重编时为 false，此时无法弹框、只能跳系统设置）。 */
  available: boolean;
};

const INITIAL: PushPermission = { granted: false, canAskAgain: true, ready: false, available: true };
const UNAVAILABLE: PushPermission = { granted: false, canAskAgain: false, ready: true, available: false };

export function usePushPermission() {
  // 惰性初始化：原生缺席时初始态即 UNAVAILABLE，effect 可直接 return（不在 effect 里同步 setState）。
  const [perm, setPerm] = useState<PushPermission>(() => (getNotifications() ? INITIAL : UNAVAILABLE));

  const apply = useCallback((res: NotificationPermissionsStatus) => {
    setPerm({ granted: res.granted, canAskAgain: res.canAskAgain, ready: true, available: true });
  }, []);

  const refresh = useCallback(async () => {
    const N = getNotifications();
    if (!N) {
      setPerm(UNAVAILABLE);
      return null;
    }
    const res = await N.getPermissionsAsync();
    apply(res);
    return res;
  }, [apply]);

  useEffect(() => {
    const N = getNotifications();
    if (!N) return; // 原生缺席：初始态已是 UNAVAILABLE，无需订阅
    let active = true;
    // 首次读取：setState 落在 .then 回调里（与本仓 use-search-history 同范式），非同步 setState。
    N.getPermissionsAsync().then((res) => {
      if (active) apply(res);
    });
    // 用户可能切到系统设置改授权再切回，前台化时重读。
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [apply, refresh]);

  /** 弹系统授权框（仅 canAskAgain 时有效；已拒时系统不再弹，调用方应转跳系统设置）。 */
  const request = useCallback(async () => {
    const N = getNotifications();
    if (!N) {
      setPerm(UNAVAILABLE);
      return null;
    }
    const res = await N.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: true, allowSound: true },
    });
    apply(res);
    return res;
  }, [apply]);

  return { ...perm, request, refresh };
}
