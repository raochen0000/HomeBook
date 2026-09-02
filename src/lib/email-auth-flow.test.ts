import { describe, expect, it } from 'vitest';

import { classifyEmailSignInFailure, isObfuscatedExistingSignUpUser } from './email-auth-flow';

describe('email password auth fallback', () => {
  it('does not retry sign-up for an unconfirmed email', () => {
    expect(classifyEmailSignInFailure({ code: 'email_not_confirmed', status: 400 })).toBe('confirm-email');
  });

  it('only retries sign-up for credential-style failures', () => {
    expect(classifyEmailSignInFailure({ code: 'invalid_credentials', status: 400 })).toBe('try-sign-up');
    expect(classifyEmailSignInFailure({ status: 500 })).toBe('stop');
    expect(classifyEmailSignInFailure({ status: 429 })).toBe('rate-limited');
  });

  it('recognizes Supabase obfuscated existing users', () => {
    expect(isObfuscatedExistingSignUpUser({ identities: [] })).toBe(true);
    expect(isObfuscatedExistingSignUpUser({ identities: [{}] })).toBe(false);
  });
});
