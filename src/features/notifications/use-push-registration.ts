/**
 * 推送设备令牌注册（PRD §18.3.3 层级二 / DATAMODEL §5.7）。挂在根布局：
 * 登录且已授权时取推送令牌上报，撤销授权时注销；登出/注销的注销在 signOut/deleteAccount 里做
 * （那时 session 仍有效，见 src/api/device-tokens.ts unregisterCurrentDevice）。
 *
 * 灰度开关 PUSH_DELIVERY_ENABLED 默认关：令牌获取（getExpoPushTokenAsync / APNs）依赖
 * 付费 Apple Developer + Push 能力 + `aps-environment` 配置，未就绪前调用会抛错，故整段先短路
 * （连原生权限查询都不触发）。APNs 配好后把开关翻 true 即通——落库链路（device_tokens 表 +
 * register/unregister RPC）已就绪。
 */
import Constants from 'expo-constants';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import {
  registerDeviceToken,
  rememberDeviceToken,
  unregisterCurrentDevice,
  type DevicePlatform,
  type TokenProvider,
} from '@/api';
import { useSession } from '@/lib/auth';

import { getNotifications } from './expo-notifications-safe';

/** 层级二灰度开关：APNs（付费 Apple Developer + Push 能力 + aps-environment）就绪后置 true。 */
export const PUSH_DELIVERY_ENABLED = true;

/** 取本设备推送令牌（有 EAS projectId 走 Expo 推送服务，否则回落直连 APNs）。失败/不可用回 null。 */
async function fetchPushToken(): Promise<{ token: string; provider: TokenProvider } | null> {
  const N = getNotifications();
  if (!N) return null;
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const projectId = extra?.eas?.projectId;
  try {
    if (projectId) {
      const res = await N.getExpoPushTokenAsync({ projectId });
      return { token: res.data, provider: 'expo' };
    }
    const res = await N.getDevicePushTokenAsync();
    return { token: String(res.data), provider: 'apns' };
  } catch (e) {
    if (__DEV__) console.warn('[push] 取令牌失败（层级二未就绪时属正常）', e);
    return null;
  }
}

export function usePushRegistration() {
  const { session } = useSession();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!PUSH_DELIVERY_ENABLED) return;
    // 未登录：注销由 signOut/deleteAccount 负责（那时 session 仍有效），此处不动。
    if (!userId) return;
    const N = getNotifications();
    if (!N) return; // 原生模块缺席（旧包未重编）：降级跳过

    let active = true;
    N.getPermissionsAsync().then((perm) => {
      if (!active) return;
      if (!perm.granted) {
        // 已登录但（在系统设置里）撤销了授权：注销令牌，服务端停止向本设备推送。
        unregisterCurrentDevice().catch(() => {});
        return;
      }
      fetchPushToken().then((res) => {
        if (!active || !res) return;
        registerDeviceToken(res.token, Platform.OS as DevicePlatform, res.provider)
          .then(() => rememberDeviceToken(res.token))
          .catch((e) => {
            if (__DEV__) console.warn('[push] 上报令牌失败', e);
          });
      });
    });
    return () => {
      active = false;
    };
  }, [userId]);
}
