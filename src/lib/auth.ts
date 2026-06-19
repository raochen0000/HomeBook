/**
 * 登录态与登录方式（流程 1）。MVP 范围：**邮箱密码 + Apple ID**，未注册自动注册。
 * 手机号短信 OTP 暂不做（阿里云短信未接，见 TECH §7.3）。
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
