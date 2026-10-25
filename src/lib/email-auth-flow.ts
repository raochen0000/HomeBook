/**
 * 邮箱密码登录的服务端失败分类。
 *
 * Supabase 使用 `email_not_confirmed` 区分「已注册但尚未确认邮箱」，此时不可回退到
 * signUp。其余凭据类 400/401 才可能是新邮箱，允许走“登录即注册”的兼容流程。
 */
export type EmailSignInFailure = {
  code?: string;
  status?: number;
};

export type EmailSignInNextStep = 'confirm-email' | 'rate-limited' | 'stop' | 'try-sign-up';

export function classifyEmailSignInFailure(error: EmailSignInFailure): EmailSignInNextStep {
  if (error.code === 'email_not_confirmed') return 'confirm-email';
  if (error.status === 429) return 'rate-limited';
  if (error.status && ![400, 401].includes(error.status)) return 'stop';
  return 'try-sign-up';
}

/**
 * 开启邮箱确认时，对已存在账号调用 signUp 会返回防枚举的伪用户，且没有 identity。
 * 新建的邮箱账号则会带有 email identity；不要把前者再提示为“注册成功”。
 */
export function isObfuscatedExistingSignUpUser(user: { identities?: unknown[] } | null): boolean {
  return !user?.identities?.length;
}

/** 绑定 / 更换邮箱的验证码位数，与 Cloud Email OTP Length 一致。 */
export const EMAIL_CHANGE_CODE_LENGTH = 6;

/** 同一地址重新发送验证码的间隔，与找回密码一致。 */
export const EMAIL_CHANGE_RESEND_SECONDS = 60;

/**
 * 距离可以再次发送还要等的秒数。
 * 没有发送时间或时间无法解析时返回 0；时钟超前时按完整间隔计算，避免立刻连发。
 */
export function emailChangeResendCooldown(sentAt: string | null | undefined, now = Date.now()): number {
  if (!sentAt) return 0;
  const sent = Date.parse(sentAt);
  if (!Number.isFinite(sent)) return 0;
  const elapsed = Math.floor((now - sent) / 1000);
  if (elapsed < 0) return EMAIL_CHANGE_RESEND_SECONDS;
  return Math.max(0, EMAIL_CHANGE_RESEND_SECONDS - elapsed);
}
