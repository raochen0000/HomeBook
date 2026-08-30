import { t } from '@/i18n/instance';

export const NICKNAME_MIN_LENGTH = 1;
export const NICKNAME_MAX_LENGTH = 10;

export function nicknameLength(value: string): number {
  return Array.from(value.trim()).length;
}

/** 未上传头像时，取昵称最后一个可见字符作为字母头像。 */
export function avatarInitialFromNickname(value: string): string {
  return Array.from(value.trim()).at(-1) ?? '?';
}

export function validateNickname(value: string): string | null {
  const length = nicknameLength(value);
  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) {
    return t('account.nicknameRange', { min: NICKNAME_MIN_LENGTH, max: NICKNAME_MAX_LENGTH });
  }
  return null;
}

export function normalizeDefaultNickname(value: string): string {
  const trimmed = value.trim();
  const sliced = Array.from(trimmed).slice(0, NICKNAME_MAX_LENGTH).join('');
  return nicknameLength(sliced) >= NICKNAME_MIN_LENGTH ? sliced : '用户';
}
