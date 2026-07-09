export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 10;

export function nicknameLength(value: string): number {
  return Array.from(value.trim()).length;
}

export function validateNickname(value: string): string | null {
  const length = nicknameLength(value);
  if (length < NICKNAME_MIN_LENGTH || length > NICKNAME_MAX_LENGTH) {
    return `昵称需为 ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH} 个字符`;
  }
  return null;
}

export function normalizeDefaultNickname(value: string): string {
  const trimmed = value.trim();
  const sliced = Array.from(trimmed).slice(0, NICKNAME_MAX_LENGTH).join('');
  return nicknameLength(sliced) >= NICKNAME_MIN_LENGTH ? sliced : '用户';
}
