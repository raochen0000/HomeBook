import { describe, expect, it } from 'vitest';

import { findObsoleteAuthStorageKeys, getSupabaseAuthStorageKey } from './auth-storage';

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
