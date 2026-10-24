import { t } from '@/i18n/instance';

/** 当前家庭成员关系里，用来决定账本展示名的字段。 */
export type MembershipNameSource = {
  userId: string;
  status: string;
  /** 离开家庭时冻结的昵称。仍在家庭中时为空。 */
  nickname: string | null;
  role: string;
  joinedAt: string;
  leftAt: string | null;
};

export type ProfileNameSource = {
  id: string;
  nickname: string;
  avatar_url: string | null;
};

/** 账本里可见的人：仍在家庭中，或曾经属于当前家庭。 */
export type LedgerMember = {
  id: string;
  /** 原名称，不含「已退出」。头像末字用这个。 */
  nickname: string;
  avatar_url: string | null;
  /** 自己退出、被移出，或注销后自动退出。 */
  departed: boolean;
};

/** 仍在家庭中只显示原名称；已经离开的在名称后加「（已退出）」。 */
export function memberDisplayName(nickname: string, departed: boolean): string {
  if (!departed) return nickname;
  return t('member.leftName', { name: nickname });
}

/**
 * 成员名单以当前家庭的成员关系为准，不收录其他家庭的注销账号。
 * 仍在家的人用现在的昵称；已经离开的人用离开时冻结的名称。
 */
export function buildLedgerMembers(memberships: MembershipNameSource[], profiles: ProfileNameSource[]): LedgerMember[] {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  return [...memberships]
    .sort((a, b) => {
      const group = (row: MembershipNameSource) => (row.status === 'active' ? (row.role === 'owner' ? 0 : 1) : 2);
      const groupDiff = group(a) - group(b);
      if (groupDiff !== 0) return groupDiff;
      if (a.status === 'active') return a.joinedAt.localeCompare(b.joinedAt);
      return (b.leftAt ?? '').localeCompare(a.leftAt ?? '') || a.joinedAt.localeCompare(b.joinedAt);
    })
    .map((membership) => {
      const departed = membership.status !== 'active';
      const profile = profileById.get(membership.userId);
      const frozen = membership.nickname?.trim() || null;
      const live = profile?.nickname?.trim() || null;
      return {
        id: membership.userId,
        nickname: (departed ? frozen || live : live || frozen) ?? '',
        avatar_url: departed ? null : (profile?.avatar_url ?? null),
        departed,
      };
    });
}
