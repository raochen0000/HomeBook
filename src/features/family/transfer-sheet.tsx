/**
 * 转让户主（流程 5）：户主从家庭成员中选一人移交户主身份。
 * 选中后走「输入对方昵称 + 滑动确认」二次确认；转让成功后追问是否顺便退出家庭。
 */
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLeaveFamily, useTransferOwnership, type FamilyMembership } from '@/api';
import { Radius, Space, usePalette } from '@/constants/design';

import { DangerConfirmSheet } from './danger-confirm-sheet';

export function TransferSheet({
  visible,
  onClose,
  candidates,
}: {
  visible: boolean;
  onClose: () => void;
  /** 可转让对象（已排除自己）。 */
  candidates: FamilyMembership[];
}) {
  const palette = usePalette();
  const transferM = useTransferOwnership();
  const leaveM = useLeaveFamily();
  const [selected, setSelected] = useState<FamilyMembership | null>(null);

  // 转让成功后追问是否顺便退出（多数转让动机即为离开，PRD §7.3 AA2）。
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView style={styles.flex}>
          <View style={styles.topBar}>
            <Text style={[styles.title, { color: palette.textPrimary }]}>转让户主</Text>
            <Pressable hitSlop={8} onPress={onClose}>
              <Text style={[styles.action, { color: palette.textSecondary }]}>取消</Text>
            </Pressable>
          </View>

          {candidates.length === 0 ? (
            <View style={styles.center}>
              <Text style={{ color: palette.textSecondary }}>家里还没有其他成员可转让</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {candidates.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => setSelected(m)}
                  style={[styles.row, { backgroundColor: palette.card }]}
                >
                  <SymbolView name="person.crop.circle.fill" tintColor={palette.textTertiary} size={32} />
                  <Text style={[styles.name, { color: palette.textPrimary }]}>{m.nickname}</Text>
                  <View style={styles.flex} />
                  <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={14} />
                </Pressable>
              ))}
            </View>
          )}
        </SafeAreaView>
      </View>

      <DangerConfirmSheet
        visible={!!selected}
        title={selected ? `转让户主给「${selected.nickname}」` : ''}
        message="转让后你将变成普通成员，对方获得家庭管理权。此操作不可撤销。"
        matchLabel={selected ? `输入对方昵称「${selected.nickname}」以确认` : ''}
        matchValue={selected?.nickname ?? ''}
        slideLabel="滑动以确认转让"
        onConfirm={async () => {
          if (selected) await transferM.mutateAsync(selected.userId);
        }}
        onSuccess={askLeaveThenClose}
        onClose={() => setSelected(null)}
      />
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: Space[4], gap: Space[2], paddingTop: Space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space[3], padding: Space[4], borderRadius: Radius.md },
  name: { fontSize: 17, fontWeight: '500' },
});
