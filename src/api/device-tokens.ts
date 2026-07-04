/**
 * 推送设备令牌（PRD §18.3.3 层级二 / DATAMODEL §5.7）。
 * 每台设备一行的推送令牌，供服务端投递侧按 notification_preferences 决定后发系统推送。
 * 写只走 SECURITY DEFINER RPC（register/unregister）——避免「同设备换登录用户认领他人 token 行」
 * 的 RLS 死角；投递侧以 service_role 读。令牌获取（getExpoPushTokenAsync / APNs）依赖付费
 * Apple Developer，故本层先建、由 use-push-registration 的 PUSH_DELIVERY_ENABLED 开关灰度。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';

export type DevicePlatform = 'ios' | 'android';
export type TokenProvider = 'expo' | 'apns';

/** 本机已注册令牌的本地记录键——供登出/注销时（session 仍有效）取回并注销。 */
const STORED_TOKEN_KEY = 'push.device_token.v1';

/** 注册/更新本设备令牌（同设备换用户时服务端改挂当前登录者）。 */
export async function registerDeviceToken(
  token: string,
  platform: DevicePlatform,
  provider: TokenProvider = 'expo',
): Promise<void> {
  const { error } = await supabase.rpc('register_device_token', {
    p_token: token,
    p_platform: platform,
    p_provider: provider,
  });
  if (error) throw error;
}

/** 注销本设备令牌（登出/注销时，仅注销本人挂着的行）。 */
export async function unregisterDeviceToken(token: string): Promise<void> {
  const { error } = await supabase.rpc('unregister_device_token', { p_token: token });
  if (error) throw error;
}

/** 记住本机已注册的令牌（注册成功后调用），供登出时注销。 */
export async function rememberDeviceToken(token: string): Promise<void> {
  await AsyncStorage.setItem(STORED_TOKEN_KEY, token).catch(() => {});
}

/**
 * 登出 / 注销前调用（此时 session 仍有效）：注销本机令牌并清本地记录。best-effort——
 * 未注册过（本地无记录）则直接返回；注销失败不阻断登出（换用户时 register 会改挂新用户兜底）。
 */
export async function unregisterCurrentDevice(): Promise<void> {
  const token = await AsyncStorage.getItem(STORED_TOKEN_KEY).catch(() => null);
  await AsyncStorage.removeItem(STORED_TOKEN_KEY).catch(() => {});
  if (!token) return;
  try {
    await unregisterDeviceToken(token);
  } catch {
    // best-effort：忽略注销失败
  }
}
