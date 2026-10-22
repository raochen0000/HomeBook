/**
 * 敏感操作前重新认证：邮箱密码账号重新登录；仅 Apple 账号重新走原生 Apple 授权。
 * 成功会得到由 Cloud Auth 签发的新会话，账号注销 RPC 还会在数据库端校验该会话的新鲜度。
 */
import type { User } from '@supabase/supabase-js';
import { Alert } from 'react-native';

import { t } from '@/i18n';
import { hasEmailLogin, reauthenticateWithApple, reauthenticateWithPassword } from '@/lib/auth';

function requestCurrentPassword(): Promise<string | null> {
  return new Promise((resolve) => {
    Alert.prompt(
      t('account.reauthTitle'),
      t('account.reauthMessage'),
      [
        { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
        { text: t('common.confirm'), onPress: (password?: string) => resolve(password ?? '') },
      ],
      'secure-text',
    );
  });
}

/** 用户取消时返回 false；认证失败抛给原页面的既有错误提示。 */
export async function requireSensitiveReauthentication(user: User | null | undefined): Promise<boolean> {
  if (!user) throw new Error(t('common.pleaseLogin'));

  if (hasEmailLogin(user)) {
    if (!user.email) throw new Error(t('auth.reauthEmailUnavailable'));
    const password = await requestCurrentPassword();
    if (!password) return false;
    await reauthenticateWithPassword({ expectedUserId: user.id, email: user.email, password });
    return true;
  }

  return reauthenticateWithApple(user.id);
}
