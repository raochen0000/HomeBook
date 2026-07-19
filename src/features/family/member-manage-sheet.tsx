/**
 * 成员管理（流程 5/6 收口）：户主在此查看成员名册、转让户主、移除成员，并可邀请家人。
 * 仅户主入口可达（家庭页 → 家庭管理 → 成员管理）。
 * 点其他成员弹系统操作单（转让 / 移除）；移除 / 转让复用 DangerConfirmSheet 的「输入昵称 + 滑动确认」闸门。
 * 邀请页为独立 pageSheet，由父层（家庭页）打开——本页先关闭再请求父层开，避免 pageSheet 叠加（DESIGN §9.9）。
 */
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  useLeaveFamily,
  useMemberships,
  useMyProfile,
  useRemoveMember,
  useTransferOwnership,
  type FamilyMembership,
} from '@/api';
import { Radius, Space, useAvatarTints, usePalette } from '@/constants/design';

import { DangerConfirmSheet } from './danger-confirm-sheet';

/** 家庭成员人数上限（与家庭页一致，后端未提供该配置）。 */
const MAX_MEMBERS = 8;

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
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      {visible ? <Body onClose={onClose} onRequestInvite={onRequestInvite} /> : null}
    </Modal>
  );
}

function Body({ onClose, onRequestInvite }: { onClose: () => void; onRequestInvite: () => void }) {
  const palette = usePalette();
  const avatarTints = useAvatarTints();
  const profileQ = useMyProfile();
  const membershipsQ = useMemberships();
  const removeM = useRemoveMember();
  const transferM = useTransferOwnership();
  const leaveM = useLeaveFamily();

  const myId = profileQ.data?.id;
  const members = membershipsQ.data ?? [];
  const full = members.length >= MAX_MEMBERS;

  const [removeTarget, setRemoveTarget] = useState<FamilyMembership | null>(null);
  const [transferTarget, setTransferTarget] = useState<FamilyMembership | null>(null);

  // 点其他成员 → 系统操作单（无输入的「选操作」，DESIGN §9.9 规则 1）；自己 / 户主无可用操作。
  const onMemberTap = (m: FamilyMembership) => {
    if (m.userId === myId || m.role === 'owner') return;
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: m.nickname,
        message: `成员 · 加入于 ${joinLabel(m.joinedAt)}`,
        options: ['转让户主给 TA', '移除成员', '取消'],
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
              onPress={onRequestInvite}
              disabled={full}
              style={[styles.inviteBtn, { backgroundColor: palette.accent, opacity: full ? 0.4 : 1 }]}
            >
              <SymbolView name="person.crop.circle.badge.plus" tintColor={palette.onAccent} size={16} />
              <Text style={[styles.inviteText, { color: palette.onAccent }]}>{full ? '已满员' : '邀请家人'}</Text>
            </Pressable>
          </View>

          <View style={[styles.card, { backgroundColor: palette.card }]}>
            {members.map((m, i) => {
              const tint = avatarTints[i % avatarTints.length];
              // 只有「其他普通成员」有可执行操作，才可点、才显示 chevron。
              const actionable = m.userId !== myId && m.role !== 'owner';
              return (
                <View key={m.id}>
                  {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                  <Pressable style={styles.memberRow} onPress={() => onMemberTap(m)} disabled={!actionable}>
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
                    {actionable ? <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={14} /> : null}
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Text style={[styles.hint, { color: palette.textTertiary }]}>
            点其他成员可转让户主或移除。被移除者的历史记账会保留在家里。
          </Text>
        </ScrollView>
      </SafeAreaView>

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
});
