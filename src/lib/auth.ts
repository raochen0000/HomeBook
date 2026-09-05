/**
 * 登录态与登录方式（流程 1）：邮箱密码 + Apple，登录即注册、无独立注册页。
 *
 * 用户主表 = `auth.users`（Supabase Auth）+ `public.profiles`（业务字段，由 handle_new_user 触发器自动建行）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { unregisterCurrentDevice } from '@/api/device-tokens';
import { t } from '@/i18n/instance';

import { classifyEmailSignInFailure, isObfuscatedExistingSignUpUser } from './email-auth-flow';
import { normalizeDefaultNickname } from './profile';
import { supabase } from './supabase';

/** GoTrue 持久化会话键（`sb-<ref>-auth-token` 及其 -user / -code-verifier 后缀）。 */
function isAuthStorageKey(key: string): boolean {
  return key.includes('-auth-token') || key === 'supabase.auth.token';
}

/**
 * 清掉本机会话。服务端会话已删或账号已封禁时，默认 `signOut({ scope: 'global' })`
 * 会先请求 `/logout`；若返回非 401/403/404（例如 banned 用户 400），GoTrue 不会走
 * `_removeSession`，AsyncStorage 里的 JWT 会留下「已注销用户」僵尸会话。
 */
async function clearLocalSession(): Promise<void> {
  try {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (!error) {
      const leftover = (await AsyncStorage.getAllKeys()).filter(isAuthStorageKey);
      if (leftover.length === 0) return;
    }
  } catch {
    // 服务端拒绝登出时仍继续抹本地存储。
  }

  const leftover = (await AsyncStorage.getAllKeys()).filter(isAuthStorageKey);
  if (leftover.length > 0) await AsyncStorage.multiRemove(leftover);
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) throw error;
}

/** 订阅当前会话；loading 用于首帧避免登录页闪现。 */
export function useSession(): { session: Session | null; loading: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

/**
 * 邮箱登录；账号不存在则自动注册。
 * Supabase 出于防枚举对「无此账号」与「密码错误」不保证可区分，故先试登录、凭据类失败再试注册。
 * 已注册但未确认邮箱会返回稳定的 `email_not_confirmed`，必须直接提示确认而非再次注册。
 */
export type EmailSignInResult = 'signed-in' | 'confirmation-required';

export async function signInWithEmail(email: string, password: string): Promise<EmailSignInResult> {
  const trimmed = email.trim();
  const signIn = await supabase.auth.signInWithPassword({ email: trimmed, password });
  if (!signIn.error) return 'signed-in';

  switch (classifyEmailSignInFailure(signIn.error)) {
    case 'confirm-email':
      throw new Error(t('auth.emailNotConfirmed'));
    case 'rate-limited':
      throw new Error(t('auth.tooManyAttempts'));
    case 'stop':
      throw new Error(signIn.error.message || t('auth.loginFailed'));
    case 'try-sign-up':
      break;
  }

  const signUp = await supabase.auth.signUp({
    email: trimmed,
    password,
    options: { data: { nickname: normalizeDefaultNickname(trimmed.split('@')[0]) } },
  });
  if (signUp.error) {
    // 邮箱已注册时不区分账号存在/密码错误，避免通过登录文案枚举邮箱。
    const code = (signUp.error as { code?: string }).code;
    if (code === 'user_already_exists') {
      throw new Error(t('auth.emailOrPasswordWrong'));
    }
    throw new Error(signUp.error.message || t('auth.signUpFailed'));
  }
  if (isObfuscatedExistingSignUpUser(signUp.data.user)) {
    throw new Error(t('auth.emailOrPasswordWrong'));
  }
  // autoconfirm 关闭时，注册已成功但尚未建立会话；由界面以成功态提示前往邮箱确认。
  if (!signUp.data.session) {
    return 'confirmation-required';
  }
  return 'signed-in';
}

/**
 * 忘记密码 · 发送找回验证码。resetPasswordForEmail 触发 recovery 动作，
 * 邮件由 Cloud Auth 的自定义 SMTP 下发 6 位 OTP。
 * 出于防枚举，账号不存在时服务端同样返回成功（用户只是收不到码），故不据此判断账号是否存在。
 */
export async function sendPasswordResetOtp(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error(t('auth.invalidEmail'));
  const { error } = await supabase.auth.resetPasswordForEmail(normalized);
  if (error) throw error;
}

/**
 * 忘记密码 · 校验找回验证码。verifyOtp(type=recovery) 通过后 GoTrue 即签发 session，
 * 随后调 updatePassword 设新密码（当前 session 即授权）。成功后用户直接进入登录态。
 */
export async function verifyPasswordResetOtp(email: string, token: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error(t('auth.invalidEmail'));
  const { error } = await supabase.auth.verifyOtp({ email: normalized, token, type: 'recovery' });
  if (error) throw error;
}

// ── 已停用的手机号 OTP（仅保留历史兼容实现；首版不暴露入口）──────────────────────

/**
 * 把输入规整为大陆手机号的 E.164（`+86…`）。
 * 容错去掉空格/分隔符与前导 0，接受带不带 +86/86 前缀；仅 11 位、1[3-9] 开头放行，否则返回 null。
 */
export function normalizeCnPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const local = digits.replace(/^0+/, '').replace(/^86/, '');
  if (!/^1[3-9]\d{9}$/.test(local)) return null;
  return `+86${local}`;
}

/** 发送登录验证码（登录即注册；GoTrue 经阿里云短信下发，shouldCreateUser 默认 true）。 */
export async function sendPhoneOtp(phone: string): Promise<void> {
  const e164 = normalizeCnPhone(phone);
  if (!e164) throw new Error(t('auth.invalidCnPhone'));
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
  if (error) throw error;
}

/** 校验登录验证码 → 拿到 session（未注册则自动建号，profiles 由触发器建行）。 */
export async function verifyPhoneOtp(phone: string, token: string): Promise<void> {
  const e164 = normalizeCnPhone(phone);
  if (!e164) throw new Error(t('auth.invalidCnPhone'));
  const { error } = await supabase.auth.verifyOtp({ phone: e164, token, type: 'sms' });
  if (error) throw error;
}

/**
 * 已登录用户绑定手机号（账号合并：把手机号挂到当前 auth.users）。
 * 触发后会向该号发送验证码，需再调 verifyPhoneChange 完成。
 */
export async function bindPhone(phone: string): Promise<void> {
  const e164 = normalizeCnPhone(phone);
  if (!e164) throw new Error(t('auth.invalidCnPhone'));
  const { error } = await supabase.auth.updateUser({ phone: e164 });
  if (error) throw error;
}

/** 绑定手机号的验证码确认（type=phone_change，区别于登录的 sms）。 */
export async function verifyPhoneChange(phone: string, token: string): Promise<void> {
  const e164 = normalizeCnPhone(phone);
  if (!e164) throw new Error(t('auth.invalidCnPhone'));
  const { error } = await supabase.auth.verifyOtp({ phone: e164, token, type: 'phone_change' });
  if (error) throw error;
}

// ── 邮箱绑定 / 换绑（次登录方式，账号合并）───────────────────────────────────────

/** 校验并规整邮箱（去空格、转小写）；格式非法返回 null。 */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * 已登录用户绑定 / 换绑邮箱（把邮箱挂到当前 auth.users）。
 * Cloud 的 Secure email change 开启时，已有邮箱的换绑会分别向旧、新邮箱发送确认链接；
 * 两个链接均被确认后由服务端提交变更。客户端不消费 email_change OTP。
 */
export async function bindEmail(email: string): Promise<void> {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error(t('auth.invalidEmail'));
  const { error } = await supabase.auth.updateUser({ email: normalized });
  if (error) throw error;
}

/** Apple 原生设备是否支持 Sign in with Apple（仅 iOS）。 */
export async function isAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  return AppleAuthentication.isAvailableAsync();
}

/**
 * Apple ID 登录：取 Apple 身份令牌 → Supabase `signInWithIdToken`（需后端已配置 Apple provider）。
 * 用户取消（ERR_REQUEST_CANCELED）静默返回，不当作错误。
 */
export async function signInWithApple(): Promise<void> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return;
    throw e;
  }

  if (!credential.identityToken) throw new Error(t('auth.appleNoToken'));

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;

  // Apple 仅首次登录返回姓名；有则回填本人昵称，且仅当仍是默认 '用户'（不覆盖已改过的）。
  const name = [credential.fullName?.familyName, credential.fullName?.givenName].filter(Boolean).join('');
  if (name && data.user) {
    await supabase
      .from('profiles')
      .update({ nickname: normalizeDefaultNickname(name) })
      .eq('id', data.user.id)
      .eq('nickname', '用户');
  }
}

/**
 * 已登录用户绑定 Apple（账号合并）：原生取 Apple 身份令牌 → linkIdentity 传 token 走 id_token 关联
 * （免浏览器 OAuth，GoTrue POST /token?grant_type=id_token&link_identity=true），成功后 session 自动刷新。
 * 用户在 Apple 弹窗取消返回 false；绑定成功返回 true。需后端已配置 Apple provider 且开启 Manual Linking。
 */
export async function bindApple(): Promise<boolean> {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return false;
    throw e;
  }
  if (!credential.identityToken) throw new Error(t('auth.appleNoToken'));
  const { error } = await supabase.auth.linkIdentity({ provider: 'apple', token: credential.identityToken });
  if (error) throw error;
  return true;
}

/**
 * 解绑 Apple：读身份列表找到 apple identity → unlinkIdentity。
 * GoTrue 会拦截「唯一登录方式」的解绑（single_identity_not_deletable），错误原样抛出供 UI 展示。
 */
export async function unbindApple(): Promise<void> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;
  const apple = data?.identities?.find((i) => i.provider === 'apple');
  if (!apple) throw new Error(t('auth.appleNotBound'));
  const { error: unlinkError } = await supabase.auth.unlinkIdentity(apple);
  if (unlinkError) throw unlinkError;
}

/** 设置 / 修改登录密码（当前 session 即授权，无需旧密码；Supabase updateUser）。 */
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  // 先注销本设备推送令牌（此时 session 仍有效；未注册过则内部直接返回）。
  await unregisterCurrentDevice();
  const { error } = await supabase.auth.signOut();
  if (error) await clearLocalSession();
}

/**
 * 账号注销（软注销）：家庭流水等共享数据保留、原家庭成员仍可见，注销者从成员名单消失、登录身份被删除。
 * 服务端在 delete_account RPC 内完成（含匿名化墓碑 + 清空凭据 + 删身份/会话）；成功后清本地 session。
 * 多人家庭户主会被服务端拦下（须先转让/解散），错误原样抛出供 UI 展示。
 */
export async function deleteAccount(): Promise<void> {
  // 软注销保留 profiles 墓碑，device_tokens 不会随 FK 级联，故须在删会话前显式注销本设备令牌。
  await unregisterCurrentDevice();
  const { error } = await supabase.rpc('delete_account');
  if (error) throw error;
  // 服务端已删会话并封禁账号，只能清本地；global signOut 可能失败且不触发 SIGNED_OUT。
  await clearLocalSession();
}
