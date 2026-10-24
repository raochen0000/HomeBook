import { t } from '@/i18n/instance';

/** 至少 1 个可见字符（按 Unicode 码点计）。 */
export const NICKNAME_MIN_LENGTH = 1;
/**
 * 视觉宽度上限。ASCII（英文、数字、空格和半角符号）计 1，其余字符计 2。
 * 因此最多约 20 个英文字母，或 10 个汉字。
 */
export const NICKNAME_MAX_WIDTH = 20;

function nicknameUnitWidth(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0;
  return codePoint <= 0x7f ? 1 : 2;
}

/** 未上传头像时，取昵称最后一个可见字符作为字母头像。 */
export function avatarInitialFromNickname(value: string): string {
  return Array.from(value.trim()).at(-1) ?? '?';
}

/** 不去空格，供输入过程中的计数和截断。 */
export function nicknameWidth(value: string): number {
  let width = 0;
  for (const char of Array.from(value)) width += nicknameUnitWidth(char);
  return width;
}

/** 按宽度截断，不截断单个字符。保留输入中的空格，保存前再 trim。 */
export function limitNicknameDraft(value: string): string {
  let width = 0;
  let out = '';
  for (const char of Array.from(value)) {
    const unit = nicknameUnitWidth(char);
    if (width + unit > NICKNAME_MAX_WIDTH) break;
    out += char;
    width += unit;
  }
  return out;
}

export function validateNickname(value: string): string | null {
  const trimmed = value.trim();
  if (Array.from(trimmed).length < NICKNAME_MIN_LENGTH || nicknameWidth(trimmed) > NICKNAME_MAX_WIDTH) {
    return t('account.nicknameHint');
  }
  return null;
}

/** 把系统回填的姓名收进宽度上限；空结果回退为「用户」。 */
export function normalizeDefaultNickname(value: string): string {
  const fitted = limitNicknameDraft(value.trim());
  return Array.from(fitted).length >= NICKNAME_MIN_LENGTH ? fitted : '用户';
}
