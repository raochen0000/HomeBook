/**
 * 成员管理（流程 5/6 收口）：户主在此查看成员名册、查看成员资料、转让户主、移除成员，并可邀请家人。
 * 仅户主入口可达（家庭页 → 家庭管理 → 成员管理）。
 * 点成员弹底部菜单（兼作「查看资料」基础信息）；移除 / 转让复用 DangerConfirmSheet 的「输入昵称 + 滑动确认」闸门。
 */
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useLeaveFamily,
  useMemberships,
  useMyProfile,
  useRemoveMember,
  useTransferOwnership,
  type FamilyMembership,
} from '@/api';
import { Radius, Space, usePalette } from '@/constants/design';

import { DangerConfirmSheet } from './danger-confirm-sheet';
import { InviteSheet } from './invite-sheet';

/** 家庭成员人数上限（与家庭页一致，后端未提供该配置）。 */
const MAX_MEMBERS = 8;
/** 成员头像兜底底色，按列表序号轮转。 */
const AVATAR_TINTS = ['#5AA7F0', '#46C98A', '#F5A623', '#9B6DD6'] as const;

function joinLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

export function MemberManageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Body onClose={onClose} /> : null}
    </Modal>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const profileQ = useMyProfile();
  const membershipsQ = useMemberships();
  const removeM = useRemoveMember();
  const transferM = useTransferOwnership();
  const leaveM = useLeaveFamily();

  const myId = profileQ.data?.id;
  const members = membershipsQ.data ?? [];
  const full = members.length >= MAX_MEMBERS;

  const [inviteOpen, setInviteOpen] = useState(false);
  const [detailTarget, setDetailTarget] = useState<FamilyMembership | null>(null);
  const [removeTarget, setRemoveTarget] = useState<FamilyMembership | null>(null);
  const [transferTarget, setTransferTarget] = useState<FamilyMembership | null>(null);

  // 转让成功后追问是否顺便退出（PRD §7.3 AA2）；无论选哪个，转让后本页（户主专属）都应关闭。
  const askLeaveThenClose = () => {
    Alert.alert('转让成功', '你已成为普通成员。要顺便退出这个家庭吗？你的历史记账会保留在家里。', [
      { text: '留在家庭', style: 'cancel', onPress: onClose },
      {
        text: '退出家庭',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveM.mutateAsync();
          } catch (e) {
            Alert.alert('退出失败', (e as Error).message ?? String(e));
          }
          onClose();
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>成员管理</Text>
          <Pressable hitSlop={8} onPress={onClose}>
            <Text style={[styles.action, { color: palette.textSecondary }]}>完成</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          {/* 计数 + 邀请 */}
          <View style={styles.countRow}>
            <Text style={[styles.count, { color: palette.textSecondary }]}>
              {members.length}/{MAX_MEMBERS} 位成员
            </Text>
            <Pressable
              onPress={() => setInviteOpen(true)}
              disabled={full}
              style={[styles.inviteBtn, { backgroundColor: palette.accent, opacity: full ? 0.4 : 1 }]}
            >
              <SymbolView name="person.crop.circle.badge.plus" tintColor={palette.onAccent} size={16} />
              <Text style={[styles.inviteText, { color: palette.onAccent }]}>{full ? '已满员' : '邀请家人'}</Text>
            </Pressable>
          </View>

          <View style={[styles.card, { backgroundColor: palette.card }]}>
            {members.map((m, i) => {
              const tint = AVATAR_TINTS[i % AVATAR_TINTS.length];
              return (
                <View key={m.id}>
                  {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                  <Pressable style={styles.memberRow} onPress={() => setDetailTarget(m)}>
                    {m.avatarUrl ? (
                      <Image source={m.avatarUrl} style={styles.avatar} contentFit="cover" transition={120} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: tint }]}>
                        <SymbolView name="person.fill" tintColor="#FFFFFF" size={20} />
                      </View>
                    )}
                    <View style={styles.flex}>
                      <View style={styles.nameRow}>
                        <Text style={[styles.name, { color: palette.textPrimary }]}>
                          {m.nickname}
                          {m.userId === myId ? '（我）' : ''}
                        </Text>
                        <View style={[styles.roleBadge, { backgroundColor: palette.bannerTint }]}>
                          <Text
                            style={[
                              styles.roleBadgeText,
                              { color: m.role === 'owner' ? palette.textPrimary : palette.textSecondary },
                            ]}
                          >
                            {m.role === 'owner' ? '户主' : '成员'}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.sub, { color: palette.textSecondary }]}>加入于 {joinLabel(m.joinedAt)}</Text>
                    </View>
                    <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={14} />
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Text style={[styles.hint, { color: palette.textTertiary }]}>
            点成员可查看资料、转让户主或移除。被移除者的历史记账会保留在家里。
          </Text>
        </ScrollView>
      </SafeAreaView>

      {/* 成员详情 + 操作（兼作「查看资料」基础信息） */}
      <MemberDetailSheet
        member={detailTarget}
        isSelf={detailTarget?.userId === myId}
        onClose={() => setDetailTarget(null)}
        onTransfer={() => {
          const t = detailTarget;
          setDetailTarget(null);
          setTransferTarget(t);
        }}
        onRemove={() => {
          const t = detailTarget;
          setDetailTarget(null);
          setRemoveTarget(t);
        }}
      />

      {/* 移除二次确认 */}
      <DangerConfirmSheet
        visible={!!removeTarget}
        title={removeTarget ? `移除「${removeTarget.nickname}」` : ''}
        message="移除后 TA 将无法访问本家庭账本；TA 已记录的流水会保留在家里。"
        matchLabel={removeTarget ? `输入对方昵称「${removeTarget.nickname}」以确认` : ''}
        matchValue={removeTarget?.nickname ?? ''}
        slideLabel="滑动以确认移除"
        onConfirm={async () => {
          if (removeTarget) await removeM.mutateAsync(removeTarget.userId);
        }}
        onSuccess={() => setDetailTarget(null)}
        onClose={() => setRemoveTarget(null)}
      />

      {/* 转让二次确认 */}
      <DangerConfirmSheet
        visible={!!transferTarget}
        title={transferTarget ? `转让户主给「${transferTarget.nickname}」` : ''}
        message="转让后你将变成普通成员，对方获得家庭管理权。此操作不可撤销。"
        matchLabel={transferTarget ? `输入对方昵称「${transferTarget.nickname}」以确认` : ''}
        matchValue={transferTarget?.nickname ?? ''}
        slideLabel="滑动以确认转让"
        onConfirm={async () => {
          if (transferTarget) await transferM.mutateAsync(transferTarget.userId);
        }}
        onSuccess={askLeaveThenClose}
        onClose={() => setTransferTarget(null)}
      />

      <InviteSheet visible={inviteOpen} onClose={() => setInviteOpen(false)} />
    </View>
  );
}

// ── 成员详情底部菜单：头部基础信息（查看资料）+ 户主对非自己成员的转让 / 移除操作 ──
function MemberDetailSheet({
  member,
  isSelf,
  onClose,
  onTransfer,
  onRemove,
}: {
  member: FamilyMembership | null;
  isSelf: boolean;
  onClose: () => void;
  onTransfer: () => void;
  onRemove: () => void;
}) {
  const palette = usePalette();
  // 仅对「非自己且非户主」的成员显示破坏性操作（本页本就户主专属，故自己即户主）。
  const showActions = !!member && !isSelf && member.role !== 'owner';
  return (
    <Modal visible={!!member} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.scrim, { backgroundColor: 'rgba(0,0,0,0.45)' }]} onPress={onClose}>
        <Pressable style={[styles.detailCard, { backgroundColor: palette.base }]} onPress={() => {}}>
          {member ? (
            <>
              <View style={styles.detailHead}>
                {member.avatarUrl ? (
                  <Image source={member.avatarUrl} style={styles.detailAvatar} contentFit="cover" transition={120} />
                ) : (
                  <View style={[styles.detailAvatar, styles.avatarFallback, { backgroundColor: AVATAR_TINTS[0] }]}>
                    <SymbolView name="person.fill" tintColor="#FFFFFF" size={28} />
                  </View>
                )}
                <Text style={[styles.detailName, { color: palette.textPrimary }]}>
                  {member.nickname}
                  {isSelf ? '（我）' : ''}
                </Text>
                <Text style={[styles.detailMeta, { color: palette.textSecondary }]}>
                  {member.role === 'owner' ? '户主' : '成员'} · 加入于 {joinLabel(member.joinedAt)}
                </Text>
              </View>

              {showActions ? (
                <>
                  <Pressable style={[styles.detailBtn, { backgroundColor: palette.card }]} onPress={onTransfer}>
                    <SymbolView name="arrow.left.arrow.right" tintColor={palette.textPrimary} size={18} />
                    <Text style={[styles.detailBtnText, { color: palette.textPrimary }]}>转让户主给 TA</Text>
                  </Pressable>
                  <Pressable style={[styles.detailBtn, { backgroundColor: palette.card }]} onPress={onRemove}>
                    <SymbolView name="person.fill.xmark" tintColor={palette.danger} size={18} />
                    <Text style={[styles.detailBtnText, { color: palette.danger }]}>移除成员</Text>
                  </Pressable>
                </>
              ) : null}

              <Pressable style={[styles.detailCancel, { backgroundColor: palette.card }]} onPress={onClose}>
                <Text style={[styles.detailBtnText, { color: palette.info }]}>{showActions ? '取消' : '关闭'}</Text>
              </Pressable>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
  },
  title: { fontSize: 20, fontWeight: '700' },
  action: { fontSize: 16 },
  content: { paddingHorizontal: Space[4], paddingBottom: Space[12], gap: Space[3] },

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
  avatar: { width: 44, height: 44, borderRadius: Radius.full },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  name: { fontSize: 16, fontWeight: '600' },
  sub: { fontSize: 13, lineHeight: 16, marginTop: 2 },
  roleBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: Radius.sm },
  roleBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  hint: { fontSize: 13, lineHeight: 18, paddingHorizontal: Space[1] },

  // 详情底部菜单
  scrim: { flex: 1, justifyContent: 'flex-end', padding: Space[4] },
  detailCard: { borderRadius: Radius.lg, padding: Space[4], gap: Space[2] },
  detailHead: { alignItems: 'center', gap: Space[1], paddingVertical: Space[3] },
  detailAvatar: { width: 64, height: 64, borderRadius: Radius.full },
  detailName: { fontSize: 18, fontWeight: '700', marginTop: Space[1] },
  detailMeta: { fontSize: 13 },
  detailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[2],
    height: 50,
    borderRadius: Radius.md,
  },
  detailBtnText: { fontSize: 16, fontWeight: '600' },
  detailCancel: {
    height: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Space[1],
  },
});
