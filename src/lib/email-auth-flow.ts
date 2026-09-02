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
