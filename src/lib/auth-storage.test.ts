import { describe, expect, it } from 'vitest';

import { findObsoleteAuthStorageKeys, getSupabaseAuthStorageKey, parseOfflineDisplaySession } from './auth-storage';

describe('Supabase session storage during a project migration', () => {
  it('keeps the Cloud project session and removes only obsolete GoTrue sessions', () => {
    const currentKey = getSupabaseAuthStorageKey(new URL('https://ygbfvzmomeobkgjzmzla.supabase.co'));

    expect(
      findObsoleteAuthStorageKeys(
        [
          `${currentKey}-user`,
          `${currentKey}-code-verifier`,
          'sb-api-auth-token',
          'sb-api-auth-token-user',
          'supabase.auth.token',
          '@homebook/locale',
        ],
        currentKey,
      ),
    ).toEqual(['sb-api-auth-token', 'sb-api-auth-token-user', 'supabase.auth.token']);
  });
});

describe('offline display identity', () => {
  const userId = '12345678-1234-4234-8234-123456789abc';
  it('recovers only the display identity and strips all credentials', () => {
    const result = parseOfflineDisplaySession(
      JSON.stringify({
        access_token: 'private-access-token',
        refresh_token: 'private-refresh-token',
        user: { id: userId, email: 'user@example.test' },
      }),
    );
    expect(result?.user.id).toBe(userId);
    expect(result?.user.email).toBe('user@example.test');
    expect(result?.access_token).toBe('');
    expect(result?.refresh_token).toBe('');
  });

  it('rejects malformed or signed-out storage', () => {
    expect(parseOfflineDisplaySession(null)).toBeNull();
    expect(parseOfflineDisplaySession('{')).toBeNull();
    expect(parseOfflineDisplaySession(JSON.stringify({ user: { id: userId }, access_token: 'token' }))).toBeNull();
    expect(
      parseOfflineDisplaySession(
        JSON.stringify({ user: { id: '../other' }, access_token: 'token', refresh_token: 'token' }),
      ),
    ).toBeNull();
  });
});
