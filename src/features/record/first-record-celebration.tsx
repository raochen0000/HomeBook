/**
 * 首次记账庆祝（PRD §4.3 S1）：居中弹窗，半透明遮罩 + 🎉 + 文案，用户手动关闭。
 * 在记账面板「关闭之后」由父层展示（不叠在面板之上），见 app/index.tsx 的 onDismiss 接线。
 * 视觉中性（DESIGN v0.5.0 去礼花的彩色装饰，仅保留一个 emoji 点缀）。
 */
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Radius, Space, usePalette } from '@/constants/design';

export function FirstRecordCelebration({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const palette = usePalette();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={[styles.card, { backgroundColor: palette.base }]}>
          <Text style={styles.emoji}>🎉</Text>
          <Text style={[styles.title, { color: palette.textPrimary }]}>记下了第一笔</Text>
          <Text style={[styles.sub, { color: palette.textSecondary }]}>往后每一笔，都是一家人生活的印记。</Text>
          <Pressable onPress={onClose} style={[styles.btn, { backgroundColor: palette.accent }]}>
            <Text style={[styles.btnText, { color: palette.onAccent }]}>好的</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space[8],
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius.lg,
    paddingVertical: Space[6],
    paddingHorizontal: Space[5],
    alignItems: 'center',
    gap: Space[3],
  },
  emoji: { fontSize: 48 },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  sub: { fontSize: 14, textAlign: 'center', lineHeight: 21 },
  btn: {
    marginTop: Space[3],
    height: 46,
    alignSelf: 'stretch',
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: 16, fontWeight: '600' },
});
