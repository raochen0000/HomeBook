/**
 * 登录态与登录方式（流程 1）。**手机号 OTP 为主 + 邮箱密码 / Apple 为次**，登录即注册、无独立注册页。
 * 手机号 OTP：GoTrue 原生流程（实例已内置 Aliyun SMS provider，服务端直发/校验/签发 session），
 * 客户端仅调 signInWithOtp / verifyOtp；仅 +86 大陆号。账号合并＝已登录时 bindPhone 绑定（见 TECH §7.3）。
 *
 * 用户主表 = `auth.users`（Supabase Auth）+ `public.profiles`（业务字段，由 handle_new_user 触发器自动建行）。
 */
import * as AppleAuthentication from 'expo-apple-authentication';
import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { supabase } from './supabase';

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
 * 邮箱登录；账号不存在则自动注册（实例已开 mailer_autoconfirm，注册即拿到 session）。
 * Supabase 出于防枚举对「无此账号」与「密码错误」都返回同一错误，故先试登录、失败再试注册：
 * 注册成功＝原本没账号；注册报「已注册」＝其实是密码错了。
 */
export async function signInWithEmail(email: string, password: string): Promise<void> {
  const trimmed = email.trim();
  const signIn = await supabase.auth.signInWithPassword({ email: trimmed, password });
  if (!signIn.error) return;

  const signUp = await supabase.auth.signUp({
    email: trimmed,
    password,
    options: { data: { nickname: trimmed.split('@')[0] } },
  });
  if (signUp.error) {
    // 邮箱已注册 → 说明账号存在、是密码不对；其它则是注册校验失败（如邮箱格式被拒）
    const code = (signUp.error as { code?: string }).code;
    if (code === 'user_already_exists') {
      throw new Error('该邮箱已注册，但密码不正确');
    }
    throw new Error(signUp.error.message || '注册失败，请重试');
  }
  // autoconfirm 关闭的环境下 signUp 不直接给 session，这里兜底提示
  if (!signUp.data.session) {
    throw new Error('注册成功，请前往邮箱确认后再登录');
  }
}

// ── 手机号 OTP（主登录方式，仅 +86 大陆）──────────────────────────────────────

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
  if (!e164) throw new Error('请输入有效的中国大陆手机号');
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
  if (error) throw error;
}

/** 校验登录验证码 → 拿到 session（未注册则自动建号，profiles 由触发器建行）。 */
export async function verifyPhoneOtp(phone: string, token: string): Promise<void> {
  const e164 = normalizeCnPhone(phone);
  if (!e164) throw new Error('请输入有效的中国大陆手机号');
  const { error } = await supabase.auth.verifyOtp({ phone: e164, token, type: 'sms' });
  if (error) throw error;
}

/**
 * 已登录用户绑定手机号（账号合并：把手机号挂到当前 auth.users）。
 * 触发后会向该号发送验证码，需再调 verifyPhoneChange 完成。
 */
export async function bindPhone(phone: string): Promise<void> {
  const e164 = normalizeCnPhone(phone);
  if (!e164) throw new Error('请输入有效的中国大陆手机号');
  const { error } = await supabase.auth.updateUser({ phone: e164 });
  if (error) throw error;
}

/** 绑定手机号的验证码确认（type=phone_change，区别于登录的 sms）。 */
export async function verifyPhoneChange(phone: string, token: string): Promise<void> {
  const e164 = normalizeCnPhone(phone);
  if (!e164) throw new Error('请输入有效的中国大陆手机号');
  const { error } = await supabase.auth.verifyOtp({ phone: e164, token, type: 'phone_change' });
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

  if (!credential.identityToken) throw new Error('Apple 未返回身份令牌');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;

  // Apple 仅首次登录返回姓名；有则回填本人昵称，且仅当仍是默认 '用户'（不覆盖已改过的）。
  const name = [credential.fullName?.familyName, credential.fullName?.givenName].filter(Boolean).join('');
  if (name && data.user) {
    await supabase.from('profiles').update({ nickname: name }).eq('id', data.user.id).eq('nickname', '用户');
  }
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
