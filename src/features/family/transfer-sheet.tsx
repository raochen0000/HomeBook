/**
 * 转让户主（流程 5）：户主从家庭成员中选一人移交户主身份（二次确认）。
 */
import { SymbolView } from 'expo-symbols';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTransferOwnership, type FamilyMembership } from '@/api';
import { Radius, Space, usePalette } from '@/constants/design';

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

  const pick = (m: FamilyMembership) => {
    Alert.alert('转让户主', `确定把户主转让给「${m.nickname}」吗？转让后你将成为普通成员。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '转让',
        style: 'destructive',
        onPress: async () => {
          try {
            await transferM.mutateAsync(m.userId);
            onClose();
          } catch (e) {
            Alert.alert('转让失败', (e as Error).message ?? String(e));
          }
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

          {transferM.isPending ? (
            <View style={styles.center}>
              <ActivityIndicator />
            </View>
          ) : candidates.length === 0 ? (
            <View style={styles.center}>
              <Text style={{ color: palette.textSecondary }}>家里还没有其他成员可转让</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {candidates.map((m) => (
                <Pressable key={m.id} onPress={() => pick(m)} style={[styles.row, { backgroundColor: palette.card }]}>
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
