/**
 * 成员管理（流程 5/6 收口）：户主在此查看成员名册、转让户主、移除成员，并可邀请家人。
 * 仅户主入口可达（家庭页 → 家庭管理 → 成员管理）。
 * 点其他成员弹系统操作单（转让 / 移除）；移除 / 转让复用 DangerConfirmSheet 的「输入昵称 + 滑动确认」闸门。
 * 邀请页为独立 pageSheet，由父层（家庭页）打开——本页先关闭再请求父层开，避免 pageSheet 叠加（DESIGN §9.9）。
 */
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useLeaveFamily,
  useMemberships,
  useMyProfile,
  useRemoveMember,
  useTransferOwnership,
  type FamilyMembership,
} from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { UserAvatar } from '@/components/user-avatar';
import { Radius, Space, useSheetPalette } from '@/constants/design';
import { MAX_FAMILY_MEMBERS } from '@/constants/family';
import { alertOk, t, useLocalePreference } from '@/i18n';

import { DangerConfirmSheet } from './danger-confirm-sheet';

function joinLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function MemberManageSheet({
  visible,
  onClose,
  onRequestInvite,
  onDismiss,
}: {
  visible: boolean;
  onClose: () => void;
  /** 关闭本页并请求父层打开邀请页（pageSheet 不叠加，故先关再开，DESIGN §9.9）。 */
  onRequestInvite: () => void;
  /** 本页完全消失后回调，供父层在 dismiss 动画结束后再打开邀请页。 */
  onDismiss?: () => void;
}) {
  return (
    <PageSheet visible={visible} onClose={onClose} onDismiss={onDismiss}>
      <Body onClose={onClose} onRequestInvite={onRequestInvite} />
    </PageSheet>
  );
}

function Body({ onClose, onRequestInvite }: { onClose: () => void; onRequestInvite: () => void }) {
  const palette = useSheetPalette();
  useLocalePreference();
  const profileQ = useMyProfile();
  const membershipsQ = useMemberships();
  const removeM = useRemoveMember();
  const transferM = useTransferOwnership();
  const leaveM = useLeaveFamily();

  const myId = profileQ.data?.id;
  const members = membershipsQ.data ?? [];
  const full = members.length >= MAX_FAMILY_MEMBERS;

  const [removeTarget, setRemoveTarget] = useState<FamilyMembership | null>(null);
  const [transferTarget, setTransferTarget] = useState<FamilyMembership | null>(null);

  // 点其他成员 → 系统操作单（无输入的「选操作」，DESIGN §9.9 规则 1）；自己 / 户主无可用操作。
  const onMemberTap = (m: FamilyMembership) => {
    if (m.userId === myId || m.role === 'owner') return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: m.nickname,
        message: t('member.joined', { date: joinLabel(m.joinedAt) }),
        options: [t('member.transferTo'), t('member.remove'), t('common.cancel')],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (i) => {
        if (i === 0) setTransferTarget(m);
        else if (i === 1) setRemoveTarget(m);
      },
    );
  };

  // 转让成功后追问是否顺便退出（PRD §7.3 AA2）；无论选哪个，转让后本页（户主专属）都应关闭。
  const askLeaveThenClose = () => {
    Alert.alert(t('member.transferOk'), t('member.transferOkBody'), [
      { text: t('member.stay'), style: 'cancel', onPress: onClose },
      {
        text: t('family.leave'),
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveM.mutateAsync();
          } catch (e) {
            Alert.alert(t('family.leaveFailed'), (e as Error).message ?? String(e), alertOk());
          }
          onClose();
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        {/* 悬浮磨砂标题区（自动保存型：纯标题，DESIGN §9.9）；关闭靠下滑手势 */}
        <SheetHeader title={t('family.members')} />

        <ScrollView contentContainerStyle={styles.content}>
          {/* 计数 + 邀请 */}
          <View style={styles.countRow}>
            <Text style={[styles.count, { color: palette.textSecondary }]}>
              {t('family.memberCountOf', { count: members.length, max: MAX_FAMILY_MEMBERS })}
            </Text>
            <Pressable
              onPress={onRequestInvite}
              disabled={full}
              style={[styles.inviteBtn, { backgroundColor: palette.ink, opacity: full ? 0.4 : 1 }]}
            >
              <SymbolView name="person.crop.circle.badge.plus" tintColor={palette.onInk} size={16} />
              <Text style={[styles.inviteText, { color: palette.onInk }]}>
                {full ? t('member.full') : t('family.invite')}
              </Text>
            </Pressable>
          </View>

          <View style={[styles.card, { backgroundColor: palette.card }]}>
            {members.map((m, i) => {
              // 只有「其他普通成员」有可执行操作，才可点、才显示 chevron。
              const actionable = m.userId !== myId && m.role !== 'owner';
              return (
                <View key={m.id}>
                  {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                  <Pressable style={styles.memberRow} onPress={() => onMemberTap(m)} disabled={!actionable}>
                    <UserAvatar avatarUrl={m.avatarUrl} nickname={m.nickname} size={44} />
                    <View style={styles.flex}>
                      <View style={styles.nameRow}>
                        <Text style={[styles.name, { color: palette.textPrimary }]}>
                          {m.nickname}
                          {m.userId === myId ? t('member.meSuffix') : ''}
                        </Text>
                        <View style={[styles.roleBadge, { backgroundColor: palette.bannerTint }]}>
                          <Text
                            style={[
                              styles.roleBadgeText,
                              { color: m.role === 'owner' ? palette.textPrimary : palette.textSecondary },
                            ]}
                          >
                            {m.role === 'owner' ? t('common.owner') : t('common.member')}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.sub, { color: palette.textSecondary }]}>
                        {t('member.joinedAt', { date: joinLabel(m.joinedAt) })}
                      </Text>
                    </View>
                    {actionable ? <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={14} /> : null}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Text style={[styles.hint, { color: palette.textTertiary }]}>{t('member.manageHint')}</Text>
        </ScrollView>
      </SafeAreaView>

      {/* 移除二次确认 */}
      <DangerConfirmSheet
        visible={!!removeTarget}
        title={removeTarget ? t('member.removeTitle', { name: removeTarget.nickname }) : ''}
        message={t('member.removeBody')}
        matchLabel={removeTarget ? t('member.removeMatch', { name: removeTarget.nickname }) : ''}
        matchValue={removeTarget?.nickname ?? ''}
        slideLabel={t('member.removeSlide')}
        onConfirm={async () => {
          if (removeTarget) await removeM.mutateAsync(removeTarget.userId);
        }}
        onClose={() => setRemoveTarget(null)}
      />

      {/* 转让二次确认 */}
      <DangerConfirmSheet
        visible={!!transferTarget}
        title={transferTarget ? t('member.transferTitle', { name: transferTarget.nickname }) : ''}
        message={t('member.transferBody')}
        matchLabel={transferTarget ? t('member.transferMatch', { name: transferTarget.nickname }) : ''}
        matchValue={transferTarget?.nickname ?? ''}
        slideLabel={t('member.transferSlide')}
        onConfirm={async () => {
          if (transferTarget) await transferM.mutateAsync(transferTarget.userId);
        }}
        onSuccess={askLeaveThenClose}
        onClose={() => setTransferTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[6],
    paddingTop: Space[5],
    paddingBottom: Space[4],
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  action: { fontSize: 16 },
  content: {
    paddingTop: SHEET_CONTENT_TOP_PADDING,
    paddingHorizontal: Space[6],
    paddingBottom: Space[12],
    gap: Space[3],
  },

  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[1],
  },
  count: { fontSize: 14 },
  inviteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[1],
    paddingHorizontal: Space[3],
    paddingVertical: Space[2],
    borderRadius: Radius.full,
  },
  inviteText: { fontSize: 14, fontWeight: '600' },

  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Space[4] + 44 + Space[3] },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingVertical: Space[3],
    paddingHorizontal: Space[4],
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  name: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, lineHeight: 16, marginTop: 2 },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.sm },
  roleBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18, paddingHorizontal: Space[1] },
});
