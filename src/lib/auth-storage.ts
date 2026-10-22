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
