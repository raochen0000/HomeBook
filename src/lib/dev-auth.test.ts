import { beforeEach, describe, expect, it, vi } from 'vitest';

import { devSignIn, TEST_ACCOUNTS } from './dev-auth';

const auth = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock('./supabase', () => ({ supabase: { auth } }));

describe('development test account login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not register an account when its login fails', async () => {
    const failure = new Error('Email not confirmed');
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: failure });

    await expect(devSignIn(TEST_ACCOUNTS.a)).rejects.toBe(failure);
    expect(auth.signUp).not.toHaveBeenCalled();
  });
});
