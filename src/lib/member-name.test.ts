import { afterEach, describe, expect, it } from 'vitest';

import { setAppLocale } from '@/i18n/instance';

import { buildLedgerMembers, memberDisplayName } from './member-name';

describe('memberDisplayName', () => {
  afterEach(() => setAppLocale('zh'));

  it('keeps the current name and marks anyone who has left the family', () => {
    expect(memberDisplayName('小饶', false)).toBe('小饶');
    expect(memberDisplayName('小美', true)).toBe('小美（已退出）');
    setAppLocale('en');
    expect(memberDisplayName('Mei', true)).toBe('Mei (left)');
  });
});

describe('buildLedgerMembers', () => {
  it('uses the live name for current members and the frozen family name after they leave', () => {
    const members = buildLedgerMembers(
      [
        { userId: 'owner', status: 'active', nickname: null, role: 'owner', joinedAt: '2026-01-01', leftAt: null },
        { userId: 'active', status: 'active', nickname: '旧名', role: 'member', joinedAt: '2026-02-01', leftAt: null },
        {
          userId: 'left',
          status: 'left',
          nickname: '小美',
          role: 'member',
          joinedAt: '2026-01-02',
          leftAt: '2026-03-01',
        },
        {
          userId: 'removed',
          status: 'removed',
          nickname: '阿强',
          role: 'member',
          joinedAt: '2026-01-03',
          leftAt: '2026-04-01',
        },
        {
          userId: 'tombstone',
          status: 'left',
          nickname: null,
          role: 'member',
          joinedAt: '2026-01-04',
          leftAt: '2026-02-01',
        },
      ],
      [
        { id: 'owner', nickname: '我自己', avatar_url: 'owner.png' },
        { id: 'active', nickname: '小饶', avatar_url: null },
        { id: 'left', nickname: '已注销用户', avatar_url: null },
        { id: 'tombstone', nickname: '已注销用户', avatar_url: null },
      ],
    );

    expect(members).toEqual([
      { id: 'owner', nickname: '我自己', avatar_url: 'owner.png', departed: false },
      { id: 'active', nickname: '小饶', avatar_url: null, departed: false },
      { id: 'removed', nickname: '阿强', avatar_url: null, departed: true },
      { id: 'left', nickname: '小美', avatar_url: null, departed: true },
      { id: 'tombstone', nickname: '已注销用户', avatar_url: null, departed: true },
    ]);
  });
});
