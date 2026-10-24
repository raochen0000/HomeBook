/**
 * 昵称编辑（PRD §17）：沿用居中提示框。标题和输入框在上，规则说明在输入框下面。
 * ASCII 计 1、其余字符计 2，上限 20。
 */
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Radius, Space, usePalette } from '@/constants/design';
import { alertOk, t } from '@/i18n';
import { limitNicknameDraft, validateNickname } from '@/lib/profile';

export function NicknamePrompt({
  visible,
  initial,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  initial: string;
  onClose: () => void;
  onSubmit: (nickname: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {visible ? <NicknamePromptBody initial={initial} onClose={onClose} onSubmit={onSubmit} /> : null}
    </Modal>
  );
}

function NicknamePromptBody({
  initial,
  onClose,
  onSubmit,
}: {
  initial: string;
  onClose: () => void;
  onSubmit: (nickname: string) => void;
}) {
  const palette = usePalette();
  const [value, setValue] = useState(initial);

  const confirm = () => {
    const next = value.trim();
    onClose();
    if (!next || next === initial.trim()) return;
    const invalid = validateNickname(next);
    if (invalid) {
      Alert.alert(t('account.nicknameInvalid'), invalid, alertOk());
      return;
    }
    onSubmit(next);
  };

  return (
    <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.dialog, { backgroundColor: palette.card }]}>
        <Text style={[styles.title, { color: palette.textPrimary }]}>{t('account.editNickname')}</Text>
        <TextInput
          value={value}
          onChangeText={(text) => setValue(limitNicknameDraft(text))}
          onSubmitEditing={confirm}
          autoFocus
          autoCorrect={false}
          autoCapitalize="words"
          textContentType="nickname"
          returnKeyType="done"
          placeholder={t('account.nickname')}
          placeholderTextColor={palette.textTertiary}
          style={[styles.input, { color: palette.textPrimary, backgroundColor: palette.cardPill }]}
          accessibilityLabel={t('account.nickname')}
        />
        <Text style={[styles.hint, { color: palette.textSecondary }]}>{t('account.nicknameHint')}</Text>
        <View style={[styles.actions, { borderTopColor: palette.separator }]}>
          <Pressable style={styles.action} onPress={onClose} accessibilityRole="button">
            <Text style={[styles.actionText, { color: palette.accent }]}>{t('common.cancel')}</Text>
          </Pressable>
          <View style={[styles.actionDivider, { backgroundColor: palette.separator }]} />
          <Pressable style={styles.action} onPress={confirm} accessibilityRole="button">
            <Text style={[styles.actionText, styles.actionConfirm, { color: palette.accent }]}>
              {t('account.nicknameOk')}
            </Text>
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space[6],
  },
  dialog: { width: 270, borderRadius: Radius.lg, overflow: 'hidden' },
  title: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '600',
    textAlign: 'center',
    paddingTop: Space[5],
    paddingHorizontal: Space[4],
  },
  input: {
    marginTop: Space[3],
    marginHorizontal: Space[4],
    minHeight: 36,
    borderRadius: Radius.sm,
    paddingHorizontal: Space[3],
    paddingVertical: Space[2],
    fontSize: 16,
  },
  hint: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingTop: Space[2],
    paddingBottom: Space[4],
    paddingHorizontal: Space[4],
  },
  actions: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, minHeight: 44 },
  action: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  actionDivider: { width: StyleSheet.hairlineWidth },
  actionText: { fontSize: 17 },
  actionConfirm: { fontWeight: '600' },
});
