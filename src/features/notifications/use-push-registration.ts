/**
 * 推送设备令牌注册（PRD §18.3.3 层级二 / DATAMODEL §5.7）。挂在根布局：
 * 登录且已授权时取推送令牌上报，撤销授权时注销；登出/注销的注销在 signOut/deleteAccount 里做
 * （那时 session 仍有效，见 src/api/device-tokens.ts unregisterCurrentDevice）。
 *
 * PUSH_DELIVERY_ENABLED 已开启：令牌获取（getExpoPushTokenAsync / APNs）依赖 Apple Developer、
 * Push 能力和 `aps-environment` 配置。落库链路（device_tokens 表 + register/unregister RPC）已就绪，
 * 但生产投递仍需 APNs 与线上 FC 端到端验收。
 */
import Constants from 'expo-constants';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import {
  registerDeviceToken,
  rememberDeviceToken,
  unregisterCurrentDevice,
  type DevicePlatform,
  type TokenProvider,
} from '@/api';
import { useSession } from '@/lib/auth';

import { getNotifications } from './expo-notifications-safe';

/** iOS 推送令牌注册开关；生产投递仍以 APNs 与 FC 的端到端验收为准。 */
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

/**
 * 将当前 iOS 设备的最新令牌与当前登录用户绑定。
 * 授权刚完成、App 回到前台，以及 iOS 轮换 token 时都可安全重复调用（服务端按 token upsert）。
 */
export async function registerPushDevice(): Promise<void> {
  if (!PUSH_DELIVERY_ENABLED) return;
  const N = getNotifications();
  if (!N) return;

  const permission = await N.getPermissionsAsync();
  if (!permission.granted) {
    await unregisterCurrentDevice().catch(() => {});
    return;
  }

  const result = await fetchPushToken();
  if (!result) return;
  await registerDeviceToken(result.token, Platform.OS as DevicePlatform, result.provider);
  await rememberDeviceToken(result.token);
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

    const register = () => {
      registerPushDevice().catch((e) => {
        if (__DEV__) console.warn('[push] 上报令牌失败', e);
      });
    };
    register();

    // 用户从系统设置改完授权回到 App 时，立即同步令牌/注销状态。
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') register();
    });
    // iOS/Expo 刷新设备 token 时重新上报，避免旧 token 静默失效。
    const tokenSubscription = N.addPushTokenListener(() => register());
    return () => {
      appStateSubscription.remove();
      tokenSubscription.remove();
    };
  }, [userId]);
}
