import { describe, expect, it } from 'vitest';

import {
  classifyEmailSignInFailure,
  EMAIL_CHANGE_RESEND_SECONDS,
  emailChangeResendCooldown,
  isObfuscatedExistingSignUpUser,
} from './email-auth-flow';

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

describe('email change resend cooldown', () => {
  const sentAt = '2026-10-24T12:00:00.000Z';
  const sent = Date.parse(sentAt);

  it('allows resend when the last send time is missing or unreadable', () => {
    expect(emailChangeResendCooldown(null)).toBe(0);
    expect(emailChangeResendCooldown('not-a-date')).toBe(0);
  });

  it('counts down from the last send and then allows resend', () => {
    expect(emailChangeResendCooldown(sentAt, sent)).toBe(EMAIL_CHANGE_RESEND_SECONDS);
    expect(emailChangeResendCooldown(sentAt, sent + 10_000)).toBe(EMAIL_CHANGE_RESEND_SECONDS - 10);
    expect(emailChangeResendCooldown(sentAt, sent + EMAIL_CHANGE_RESEND_SECONDS * 1000)).toBe(0);
  });

  it('waits a full interval when the device clock is behind the send time', () => {
    expect(emailChangeResendCooldown(sentAt, sent - 5_000)).toBe(EMAIL_CHANGE_RESEND_SECONDS);
  });
});
