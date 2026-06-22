/**
 * 破坏性操作二次确认对话框（流程 5/6 共用）：警示文案 +「输入指定文字」闸门 + 滑动确认。
 * 用于：移除成员（输入对方昵称）、转让户主（输入对方昵称）、解散家庭（输入家庭名）。
 *
 * 透明 fade Modal（非 pageSheet），可叠在页面或另一个 Modal（如转让面板）之上。
 * onConfirm 抛错则就地提示并重置滑块（改 key 强制重挂）；成功则触发 onSuccess 后关闭。
 */
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { SlideToConfirm } from '@/components/ui/slide-to-confirm';
import { Radius, Space, usePalette } from '@/constants/design';

export function DangerConfirmSheet({
  visible,
  title,
  message,
  matchLabel,
  matchValue,
  slideLabel,
  onConfirm,
  onSuccess,
  onClose,
}: {
  visible: boolean;
  title: string;
  message: string;
  /** 输入框上方提示，如「输入对方昵称「老王」以确认」。 */
  matchLabel: string;
  /** 需要逐字匹配的目标串（昵称 / 家庭名）。 */
  matchValue: string;
  /** 滑块文字，如「滑动以确认移除」。 */
  slideLabel: string;
  /** 执行实际动作；抛错即视为失败。 */
  onConfirm: () => Promise<void>;
  /** 成功后、关闭前的回调（如转让后追问是否退出）。 */
  onSuccess?: () => void;
  onClose: () => void;
}) {
  const palette = usePalette();
  const [input, setInput] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0); // 改变即重挂滑块以复位

  const matched = input.trim().toLowerCase() === matchValue.trim().toLowerCase();

  const reset = () => {
    setInput('');
    setPending(false);
    setError(null);
    setAttempt(0);
  };

  const handleClose = () => {
    if (pending) return;
    reset();
    onClose();
  };

  const handleConfirm = async () => {
    if (!matched || pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onSuccess?.();
      reset();
      onClose();
    } catch (e) {
      setError((e as Error).message ?? String(e));
      setPending(false);
      setAttempt((a) => a + 1); // 滑块回位
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.scrim, { backgroundColor: 'rgba(0,0,0,0.45)' }]}
      >
        <View style={[styles.card, { backgroundColor: palette.base }]}>
          <Text style={[styles.title, { color: palette.danger }]}>{title}</Text>
          <Text style={[styles.message, { color: palette.textSecondary }]}>{message}</Text>

          <Text style={[styles.matchLabel, { color: palette.textSecondary }]}>{matchLabel}</Text>
          <TextInput
            style={[styles.input, { backgroundColor: palette.card, color: palette.textPrimary }]}
            value={input}
            onChangeText={(t) => {
              setInput(t);
              setError(null);
            }}
            placeholder={matchValue}
            placeholderTextColor={palette.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!pending}
          />

          {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

          <View style={styles.slideWrap}>
            <SlideToConfirm
              key={attempt}
              label={slideLabel}
              enabled={matched}
              busy={pending}
              danger
              onConfirm={() => void handleConfirm()}
            />
          </View>

          <Pressable onPress={handleClose} hitSlop={8} style={styles.cancel} disabled={pending}>
            <Text style={{ color: palette.info, fontSize: 16 }}>取消</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Space[6] },
  card: { width: '100%', maxWidth: 400, borderRadius: Radius.lg, padding: Space[5], gap: Space[3] },
  title: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  matchLabel: { fontSize: 13, marginTop: Space[2] },
  input: {
    height: 48,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
    fontSize: 16,
    textAlign: 'center',
  },
  error: { fontSize: 13, textAlign: 'center' },
  slideWrap: { marginTop: Space[2] },
  cancel: { alignSelf: 'center', paddingVertical: Space[2], marginTop: Space[1] },
});
