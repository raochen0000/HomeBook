/**
 * G7 修改 / 设置登录密码。已登录用户直接 updateUser({ password })（当前 session 即授权，无需旧密码）。
 * 流程：输入新密码 + 确认 → 保存 → 回到账号页。密码用于「邮箱 + 密码」登录（邮箱在 G5 绑定）。
 * 与手机号 / 邮箱页同构：同一套 field / 主按钮语言，CTA 用 palette.accent 适配 Light/Night。
 * 未绑邮箱时给出提示（设了密码也要先绑邮箱才能用密码登录）。
 */
import { Stack, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { Radius, Space, usePalette } from '@/constants/design';
import { singleLineTextInputStyle } from '@/constants/text-input';
import { updatePassword, useSession } from '@/lib/auth';

/** 密码最短长度（与 Supabase Auth 最小长度一致）。 */
const MIN_LEN = 6;

/**
 * 改密错误 → 友好文案：
 * - 新旧密码相同（same_password）→ 提示换一个；
 * - 弱密码（weak_password）→ 提示更复杂；
 * - 网络异常 → 稍后重试；
 * - 其余 → 原始 message 兜底。
 */
function passwordErrorText(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string; code?: string };
  const msg = (e?.message ?? '').toLowerCase();
  if (e?.code === 'same_password' || msg.includes('should be different')) {
    return '新密码不能与当前密码相同';
  }
  if (e?.code === 'weak_password' || msg.includes('weak') || msg.includes('password should')) {
    return '密码强度不够，请换一个更复杂的密码';
  }
  const down =
    e?.status === 0 ||
    e?.name === 'AuthRetryableFetchError' ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch');
  if (down) return '网络异常，请稍后重试';
  return e?.message ?? String(err);
}

export default function PasswordScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useSession();
  const hasEmail = !!session?.user.email;

  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  const lengthOk = pwd.length >= MIN_LEN;
  const matchOk = confirm.length > 0 && pwd === confirm;
  const canSave = lengthOk && matchOk && !busy;
  // 确认框已填且不一致时才提示（避免边输入边报错）。
  const mismatch = confirm.length > 0 && pwd !== confirm;

  const onSave = async () => {
    if (!canSave) {
      if (!lengthOk) toast.error(`密码至少 ${MIN_LEN} 位`);
      else if (!matchOk) toast.error('两次输入的密码不一致');
      return;
    }
    setBusy(true);
    try {
      await updatePassword(pwd);
      toast.success('密码已更新');
      setTimeout(() => router.back(), 700);
    } catch (err) {
      toast.error(passwordErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <Stack.Screen options={{ headerShown: true, title: '修改密码' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space[6] }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>设置新密码</Text>

          {/* 新密码 */}
          <View style={[styles.field, { backgroundColor: palette.card }]}>
            <SymbolView name="lock" tintColor={palette.textTertiary} size={16} />
            <View style={styles.fieldGap} />
            <TextInput
              style={[styles.input, { color: palette.textPrimary }]}
              placeholder={`请输入新密码（至少 ${MIN_LEN} 位）`}
              placeholderTextColor={palette.textTertiary}
              value={pwd}
              onChangeText={setPwd}
              secureTextEntry={!showPwd}
              autoCapitalize="none"
              autoComplete="new-password"
              autoCorrect={false}
              textContentType="newPassword"
              editable={!busy}
            />
            <Pressable
              hitSlop={8}
              onPress={() => setShowPwd((v) => !v)}
              accessibilityLabel={showPwd ? '隐藏密码' : '显示密码'}
            >
              <SymbolView name={showPwd ? 'eye.slash' : 'eye'} tintColor={palette.textSecondary} size={18} />
            </Pressable>
          </View>

          {/* 确认新密码 */}
          <View style={[styles.field, { backgroundColor: palette.card }]}>
            <SymbolView name="lock.rotation" tintColor={palette.textTertiary} size={16} />
            <View style={styles.fieldGap} />
            <TextInput
              style={[styles.input, { color: palette.textPrimary }]}
              placeholder="请再次输入新密码"
              placeholderTextColor={palette.textTertiary}
              value={confirm}
              onChangeText={setConfirm}
              secureTextEntry={!showPwd}
              autoCapitalize="none"
              autoComplete="new-password"
              autoCorrect={false}
              textContentType="newPassword"
              editable={!busy}
              onSubmitEditing={onSave}
              returnKeyType="done"
            />
          </View>

          {/* 不一致即时提示 */}
          {mismatch ? (
            <View style={styles.errorRow}>
              <SymbolView name="exclamationmark.circle" tintColor={palette.danger} size={13} />
              <Text style={[styles.errorText, { color: palette.danger }]}>两次输入的密码不一致</Text>
            </View>
          ) : null}

          {/* 主按钮 */}
          <Pressable
            onPress={onSave}
            disabled={!canSave}
            style={[styles.primary, { backgroundColor: palette.ink, opacity: canSave ? 1 : 0.35 }]}
          >
            {busy ? (
              <ActivityIndicator color={palette.onInk} />
            ) : (
              <Text style={[styles.primaryText, { color: palette.onInk }]}>保存密码</Text>
            )}
          </Pressable>

          {/* 安全说明 */}
          <View style={styles.hintRow}>
            <SymbolView name="checkmark.shield" tintColor={palette.textTertiary} size={13} />
            <Text style={[styles.hint, { color: palette.textTertiary }]}>
              {hasEmail
                ? '设置后可用「邮箱 + 密码」登录家账。'
                : '当前未绑定邮箱；设置密码后需先绑定邮箱，才能用「邮箱 + 密码」登录。'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: Space[4], gap: Space[3] },

  sectionTitle: { fontSize: 15, fontWeight: '600', marginTop: Space[1], marginBottom: Space[1] },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
  },
  fieldGap: { width: Space[2] },
  input: singleLineTextInputStyle,

  errorRow: { flexDirection: 'row', alignItems: 'center', gap: Space[1], paddingHorizontal: Space[1] },
  errorText: { fontSize: 12 },

  primary: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Space[3],
  },
  primaryText: { fontSize: 17, fontWeight: '600' },

  hintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[1],
    marginTop: Space[2],
    paddingHorizontal: Space[2],
  },
  hint: { flexShrink: 1, fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
