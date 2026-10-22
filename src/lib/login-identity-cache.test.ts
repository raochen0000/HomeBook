import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  beginLoginIdentityRead,
  loginIdentitiesForAccount,
  peekLoginIdentities,
  rememberLoginIdentities,
  resetLoginIdentityCache,
  subscribeLoginIdentities,
} from './login-identity-cache';

describe('login identity cache', () => {
  afterEach(() => {
    resetLoginIdentityCache();
  });

  it('shows a fresh apple link instead of the stale session snapshot', () => {
    const session = [{ provider: 'email' }];
    const snapshot = {
      userId: 'user-1',
      identities: [{ provider: 'email' }, { provider: 'apple' }],
    };

    expect(loginIdentitiesForAccount('user-1', session, snapshot).map((identity) => identity.provider)).toEqual([
      'email',
      'apple',
    ]);
  });

  it('does not reuse another user snapshot', () => {
    const session = [{ provider: 'email' }, { provider: 'apple' }];
    const snapshot = { userId: 'user-2', identities: [{ provider: 'email' }] };

    expect(loginIdentitiesForAccount('user-1', session, snapshot).map((identity) => identity.provider)).toEqual([
      'email',
      'apple',
    ]);
  });

  it('keeps the newest identity read when an older request finishes later', () => {
    const first = beginLoginIdentityRead();
    const second = beginLoginIdentityRead();
    const seen: string[][] = [];
    const unsubscribe = subscribeLoginIdentities(() => {
      seen.push((peekLoginIdentities('user-1') ?? []).map((identity) => identity.provider));
    });

    expect(rememberLoginIdentities(second, 'user-1', [{ provider: 'email' }, { provider: 'apple' }])).toBe(true);
    expect(rememberLoginIdentities(first, 'user-1', [{ provider: 'email' }])).toBe(false);

    expect(peekLoginIdentities('user-1')?.map((identity) => identity.provider)).toEqual(['email', 'apple']);
    expect(seen).toEqual([['email', 'apple']]);
    unsubscribe();
  });

  it('replaces a linked apple identity after unbind', () => {
    const linked = beginLoginIdentityRead();
    rememberLoginIdentities(linked, 'user-1', [{ provider: 'email' }, { provider: 'apple' }]);
    const unlinked = beginLoginIdentityRead();
    rememberLoginIdentities(unlinked, 'user-1', [{ provider: 'email' }]);

    expect(peekLoginIdentities('user-1')?.some((identity) => identity.provider === 'apple')).toBe(false);
  });

  it('does not notify when a stale read is ignored', () => {
    const listener = vi.fn();
    subscribeLoginIdentities(listener);
    const current = beginLoginIdentityRead();
    const stale = current - 1;

    expect(rememberLoginIdentities(stale, 'user-1', [{ provider: 'apple' }])).toBe(false);
    expect(listener).not.toHaveBeenCalled();
    expect(peekLoginIdentities('user-1')).toBeNull();
  });
});
