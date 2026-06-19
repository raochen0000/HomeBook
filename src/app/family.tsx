/**
 * 家庭（Tab 3）：成员与身份 + 邀请/加入 + 转让/退出/解散（流程 3/4/5）。
 * 用 RN 渲染（交互态多，沿用 mine.tsx 的卡片风格）；二维码/扫码在独立 Sheet 内。
 */
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useCreateFamily, useDissolveFamily, useLeaveFamily, useMemberships, useMyFamily, useMyProfile } from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Radius, Space, usePalette } from '@/constants/design';
import { InviteSheet } from '@/features/family/invite-sheet';
import { ScanSheet } from '@/features/family/scan-sheet';
import { TransferSheet } from '@/features/family/transfer-sheet';

export default function FamilyScreen() {
  const palette = usePalette();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const membershipsQ = useMemberships();
  const createFamilyM = useCreateFamily();
  const leaveM = useLeaveFamily();
  const dissolveM = useDissolveFamily();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);

  const myId = profileQ.data?.id;
  const family = familyQ.data;
  const members = membershipsQ.data ?? [];
  const isOwner = !!family && family.owner_user_id === myId;
  const candidates = members.filter((m) => m.userId !== myId);

  const onCreate = () => {
    Alert.prompt(
      '创建家庭',
      '给你的家庭起个名字',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '创建',
          onPress: async (name?: string) => {
            try {
              await createFamilyM.mutateAsync({ name: name?.trim() || '我的家' });
            } catch (e) {
              Alert.alert('创建失败', (e as Error).message ?? String(e));
            }
          },
        },
      ],
      'plain-text',
      '我的家',
    );
  };

  const onLeave = () => {
    Alert.alert('退出家庭', '退出后你将看不到这个家的账本。确定退出吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          try {
            await leaveM.mutateAsync();
          } catch (e) {
            Alert.alert('退出失败', (e as Error).message ?? String(e));
          }
        },
      },
    ]);
  };

  const onDissolve = () => {
    Alert.alert('解散家庭', '解散后全部成员将退出，账本不再可用。此操作不可恢复，确定解散吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '解散',
        style: 'destructive',
        onPress: async () => {
          try {
            await dissolveM.mutateAsync();
          } catch (e) {
            Alert.alert('解散失败', (e as Error).message ?? String(e));
          }
        },
      },
    ]);
  };

  const loading = profileQ.isLoading || familyQ.isLoading;
  const busy = createFamilyM.isPending || leaveM.isPending || dissolveM.isPending;

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.header}>
          <ThemedText style={[styles.title, { color: palette.textPrimary }]}>家庭</ThemedText>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : !family ? (
          // ── 无家庭：创建 / 加入 ──
          <View style={styles.center}>
            <SymbolView name="person.2" tintColor={palette.textTertiary} size={48} />
            <ThemedText style={{ color: palette.textSecondary }}>你还没有加入家庭</ThemedText>
            <View style={styles.emptyActions}>
              <Pressable
                disabled={busy}
                onPress={onCreate}
                style={[styles.primary, { backgroundColor: palette.accent, opacity: busy ? 0.5 : 1 }]}
              >
                <ThemedText style={[styles.primaryText, { color: palette.onAccent }]}>创建家庭</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setScanOpen(true)}
                style={[styles.secondary, { borderColor: palette.separator }]}
              >
                <ThemedText style={{ color: palette.textPrimary, fontSize: 16 }}>扫码加入家庭</ThemedText>
              </Pressable>
            </View>
          </View>
        ) : (
          // ── 有家庭：成员 + 操作 ──
          <ScrollView contentContainerStyle={styles.content}>
            <View style={[styles.familyCard, { backgroundColor: palette.card }]}>
              <ThemedText style={[styles.familyName, { color: palette.textPrimary }]}>{family.name}</ThemedText>
              <ThemedText style={{ color: palette.textSecondary, fontSize: 13 }}>
                {family.member_count} 位成员{isOwner ? ' · 你是户主' : ''}
              </ThemedText>
            </View>

            <View style={styles.section}>
              <ThemedText style={[styles.sectionTitle, { color: palette.textSecondary }]}>成员</ThemedText>
              <View style={[styles.card, { backgroundColor: palette.card }]}>
                {members.map((m, i) => (
                  <View key={m.id}>
                    {i > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                    <View style={styles.memberRow}>
                      <SymbolView name="person.crop.circle.fill" tintColor={palette.textTertiary} size={36} />
                      <ThemedText style={[styles.memberName, { color: palette.textPrimary }]}>
                        {m.nickname}
                        {m.userId === myId ? '（我）' : ''}
                      </ThemedText>
                      <View style={styles.flex} />
                      {m.role === 'owner' ? (
                        <View style={[styles.badge, { backgroundColor: palette.bannerTint }]}>
                          <ThemedText style={[styles.badgeText, { color: palette.warning }]}>户主</ThemedText>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            </View>

            {/* 操作 */}
            <View style={styles.section}>
              {isOwner ? (
                <View style={[styles.card, { backgroundColor: palette.card }]}>
                  <ActionRow icon="qrcode" label="邀请家人" onPress={() => setInviteOpen(true)} />
                  <View style={[styles.divider, { backgroundColor: palette.separator }]} />
                  <ActionRow
                    icon="arrow.left.arrow.right"
                    label="转让户主"
                    onPress={() => setTransferOpen(true)}
                    disabled={candidates.length === 0}
                  />
                  <View style={[styles.divider, { backgroundColor: palette.separator }]} />
                  <ActionRow icon="trash" label="解散家庭" danger onPress={onDissolve} />
                </View>
              ) : (
                <View style={[styles.card, { backgroundColor: palette.card }]}>
                  <ActionRow icon="rectangle.portrait.and.arrow.right" label="退出家庭" danger onPress={onLeave} />
                </View>
              )}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>

      <InviteSheet visible={inviteOpen} onClose={() => setInviteOpen(false)} />
      <ScanSheet visible={scanOpen} onClose={() => setScanOpen(false)} />
      <TransferSheet visible={transferOpen} onClose={() => setTransferOpen(false)} candidates={candidates} />
    </View>
  );
}

function ActionRow({
  icon,
  label,
  onPress,
  danger,
  disabled,
}: {
  icon: Parameters<typeof SymbolView>[0]['name'];
  label: string;
  onPress: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const palette = usePalette();
  const color = danger ? palette.danger : palette.textPrimary;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.actionRow, { opacity: disabled ? 0.4 : 1 }]}>
      <SymbolView name={icon} tintColor={color} size={20} />
      <ThemedText style={[styles.actionLabel, { color }]}>{label}</ThemedText>
      <View style={styles.flex} />
      {!danger ? <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={14} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: Space[4], paddingTop: Space[2], paddingBottom: Space[3] },
  title: { fontSize: 34, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[3], paddingHorizontal: Space[6] },
  emptyActions: { width: '100%', gap: Space[3], marginTop: Space[4] },
  primary: { height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '600' },
  secondary: {
    height: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  content: { paddingHorizontal: Space[4], paddingBottom: Space[12], gap: Space[6] },
  familyCard: { padding: Space[5], borderRadius: Radius.lg, gap: Space[1] },
  familyName: { fontSize: 24, fontWeight: '700' },
  section: { gap: Space[2] },
  sectionTitle: { fontSize: 13, paddingHorizontal: Space[1] },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: Space[4] },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingVertical: Space[3],
    paddingHorizontal: Space[4],
  },
  memberName: { fontSize: 17, fontWeight: '500' },
  badge: { paddingHorizontal: Space[2], paddingVertical: 2, borderRadius: Radius.sm },
  badgeText: { fontSize: 12, fontWeight: '600' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingVertical: Space[4],
    paddingHorizontal: Space[4],
  },
  actionLabel: { fontSize: 17 },
});
