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
import type { DevicePushToken } from 'expo-notifications';
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
async function fetchPushToken(
  devicePushToken?: DevicePushToken,
): Promise<{ token: string; provider: TokenProvider } | null> {
  const N = getNotifications();
  if (!N) return null;
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  const projectId = extra?.eas?.projectId;
  try {
    if (projectId) {
      // Token 轮换监听器必须把事件中的 token 直接传进来；若在监听器内再次获取设备 token，
      // expo-notifications 会再次触发同一个监听器，形成无限注册循环。
      const res = await N.getExpoPushTokenAsync({ projectId, devicePushToken });
      return { token: res.data, provider: 'expo' };
    }
    const res = devicePushToken ?? (await N.getDevicePushTokenAsync());
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
export async function registerPushDevice(devicePushToken?: DevicePushToken): Promise<void> {
  if (!PUSH_DELIVERY_ENABLED) return;
  const N = getNotifications();
  if (!N) return;

  const permission = await N.getPermissionsAsync();
  if (!permission.granted) {
    await unregisterCurrentDevice().catch(() => {});
    return;
  }

  const result = await fetchPushToken(devicePushToken);
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

    let active = true;
    let tokenSubscription: ReturnType<typeof N.addPushTokenListener> | undefined;
    const register = (devicePushToken?: DevicePushToken) =>
      registerPushDevice(devicePushToken).catch((e) => {
        if (__DEV__) console.warn('[push] 上报令牌失败', e);
      });

    // 首次注册完成后再监听轮换。首次 getDevicePushTokenAsync 本身也会发出 token 事件；
    // 若过早安装监听，会造成同一个 token 的重复请求。
    void register().finally(() => {
      if (!active) return;
      tokenSubscription = N.addPushTokenListener((devicePushToken) => {
        void register(devicePushToken);
      });
    });

    // 用户从系统设置改完授权回到 App 时，立即同步令牌/注销状态。
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void register();
    });
    return () => {
      active = false;
      appStateSubscription.remove();
      tokenSubscription?.remove();
    };
  }, [userId]);
}
