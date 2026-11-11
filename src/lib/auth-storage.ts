import type { Session } from '@supabase/supabase-js';

/** Supabase 在设备存储中使用的项目命名空间会话键。 */
export function getSupabaseAuthStorageKey(supabaseUrl: URL): string {
  return `sb-${supabaseUrl.hostname.split('.')[0]}-auth-token`;
}

/** GoTrue 会话及其 user / PKCE code-verifier 附属键。 */
export function isSupabaseAuthStorageKey(key: string): boolean {
  return key.includes('-auth-token') || key === 'supabase.auth.token';
}

/**
 * 切换 Supabase 项目后，旧项目命名空间的 JWT 不能用于新项目。
 * 保留当前项目及其附属键，清理其余 GoTrue 会话键，避免日后回退或 SDK 行为变化时误读。
 */
export function findObsoleteAuthStorageKeys(keys: readonly string[], currentStorageKey: string): string[] {
  return keys.filter((key) => isSupabaseAuthStorageKey(key) && !key.startsWith(currentStorageKey));
}
/** Recover only a local display identity; empty credentials can never authorize an API request. */
export function parseOfflineDisplaySession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      !parsed ||
      !('user' in parsed) ||
      typeof parsed.user !== 'object' ||
      !parsed.user ||
      !('id' in parsed.user) ||
      typeof parsed.user.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.user.id) ||
      !('access_token' in parsed) ||
      typeof parsed.access_token !== 'string' ||
      !parsed.access_token ||
      !('refresh_token' in parsed) ||
      typeof parsed.refresh_token !== 'string' ||
      !parsed.refresh_token
    )
      return null;
    const email = 'email' in parsed.user && typeof parsed.user.email === 'string' ? parsed.user.email : undefined;
    return {
      access_token: '',
      refresh_token: '',
      expires_in: 0,
      token_type: 'bearer',
      user: { id: parsed.user.id, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '', email },
    };
  } catch {
    return null;
  }
}
