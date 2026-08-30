/**
 * 忘记密码找回（登录页之上的 pageSheet）。单屏三段：邮箱 → 获取验证码（60s 倒计时）→ 输 6 位码 + 设新密码。
 * 流程：sendPasswordResetOtp(email) 发码 → 「重置密码」时 verifyPasswordResetOtp(email,code)
 * 拿到 session → updatePassword(newPassword) 设新密码 → session 变化使登录覆盖层自动卸载，直接进 App。
 *
 * 邮件通道：自托管无 SMTP 出口，recovery 邮件经 Send Email Hook → 阿里云 FC → 邮件推送下发
 * （见 services/email-hook-fc/）。与账号页换绑邮箱（app/account/email.tsx）同构，共用一套 field/OTP 语言。
 * 以 pageSheet 呈现于登录页之上（专注小任务，完成即回登录页），键盘避让、走设计令牌、适配 Light/Night。
 */
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { PageSheet } from '@/components/page-sheet';
import { toast } from '@/components/toast';
import { Radius, Space, useSheetPalette } from '@/constants/design';
import { singleLineTextInputStyle } from '@/constants/text-input';
import { t, useLocalePreference } from '@/i18n';
import { normalizeEmail, sendPasswordResetOtp, updatePassword, verifyPasswordResetOtp } from '@/lib/auth';

/** OTP 位数（与 Studio Email provider 的 Email OTP Length 一致）。 */
const OTP_LEN = 6;

/**
 * 找回/校验错误 → 友好文案：
 * - 验证码错误 / 过期 → 提示重新获取；
 * - 密码过弱（服务端策略）→ 提示；
 * - 网络 / 邮件通道异常 → 引导稍后重试；
 * - 其余 → 原始 message 兜底。
 */
function resetErrorText(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string; code?: string };
  const msg = (e?.message ?? '').toLowerCase();
  if (e?.status === 429 || msg.includes('daily email verification code limit')) {
    return t('auth.emailDailyLimit');
  }
  if (e?.code === 'otp_expired' || msg.includes('invalid') || msg.includes('expired') || msg.includes('token')) {
    return t('auth.codeInvalid');
  }
  if (e?.code === 'weak_password' || msg.includes('password')) {
    return t('auth.weakPassword');
  }
  const down =
    e?.status === 504 ||
    e?.status === 408 ||
    e?.status === 0 ||
    e?.name === 'AuthRetryableFetchError' ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('deadline') ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch');
  if (down) return t('auth.mailUnavailable');
  return e?.message ?? String(err);
}

export function ForgotPasswordSheet({
  visible,
  initialEmail,
  onClose,
}: {
  visible: boolean;
  initialEmail?: string;
  onClose: () => void;
}) {
  const palette = useSheetPalette();
  useLocalePreference();

  const [email, setEmail] = useState(initialEmail ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  // 打开时的表单重置放在 Modal onShow 里（见下），避免在 effect 中同步 setState。

  // 倒计时：每秒自减，到 0 停。
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const normalized = normalizeEmail(email);
  const canSend = !!normalized && cooldown === 0 && !busy;
  const canSubmit = !!normalized && code.length === OTP_LEN && password.length >= 6 && !busy;

  const onSend = async () => {
    if (!canSend) {
      if (!normalized) toast.error(t('auth.invalidEmail'));
      return;
    }
    setBusy(true);
    try {
      await sendPasswordResetOtp(email);
      setCooldown(60);
      toast.success(t('auth.recoverSent'));
    } catch (err) {
      toast.error(resetErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async () => {
    if (!canSubmit) {
      if (!normalized) toast.error(t('auth.invalidEmail'));
      else if (code.length !== OTP_LEN) toast.error(t('auth.recoverCodeLen'));
      else if (password.length < 6) toast.error(t('auth.newPasswordMin'));
      return;
    }
    setBusy(true);
    try {
      // 校验验证码 → 拿到 session → 设新密码。成功后 session 变化会卸载登录页，直接进 App。
      await verifyPasswordResetOtp(email, code);
      await updatePassword(password);
      // 兜底关闭（正常情况下父层随 session 卸载，这里防止极端时序下残留）。
      onClose();
    } catch (err) {
      toast.error(resetErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageSheet
      visible={visible}
      onClose={onClose}
      onShow={() => {
        // 每次打开用登录页已填的邮箱预填，并清掉上次的验证码/密码/倒计时残留。
        setEmail(initialEmail ?? '');
        setCode('');
        setPassword('');
        setCooldown(0);
      }}
    >
      <View style={[styles.root, { backgroundColor: palette.base }]}>
        <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
          {/* 头部：取消 + 标题 */}
          <View style={styles.header}>
            <Pressable hitSlop={8} onPress={onClose} disabled={busy} style={styles.headerBtn}>
              <Text style={[styles.cancelText, { color: busy ? palette.textTertiary : palette.textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Text style={[styles.headerTitle, { color: palette.textPrimary }]}>{t('auth.recoverTitle')}</Text>
            <View style={styles.headerBtn} />
          </View>

          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
            >
              <Text style={[styles.subtitle, { color: palette.textSecondary }]}>{t('auth.recoverHint')}</Text>

              {/* 邮箱 */}
              <View style={[styles.field, { backgroundColor: palette.card }]}>
                <SymbolView name="envelope" tintColor={palette.textTertiary} size={16} />
                <View style={styles.fieldGap} />
                <TextInput
                  style={[styles.input, { color: palette.textPrimary }]}
                  placeholder={t('auth.emailPlaceholder')}
                  placeholderTextColor={palette.textTertiary}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  inputMode="email"
                  textContentType="emailAddress"
                  editable={!busy}
                />
                {email.length > 0 ? (
                  <Pressable hitSlop={8} onPress={() => setEmail('')} accessibilityLabel={t('account.clearEmail')}>
                    <SymbolView name="xmark.circle.fill" tintColor={palette.textTertiary} size={16} />
                  </Pressable>
                ) : null}
              </View>

              {/* 验证码 */}
              <View style={[styles.field, { backgroundColor: palette.card }]}>
                <TextInput
                  style={[styles.input, { color: palette.textPrimary }]}
                  placeholder={t('auth.codePlaceholder')}
                  placeholderTextColor={palette.textTertiary}
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  maxLength={OTP_LEN}
                  editable={!busy}
                />
                <View style={[styles.ccDivider, { backgroundColor: palette.separator }]} />
                <Pressable hitSlop={6} onPress={onSend} disabled={!canSend} accessibilityLabel={t('auth.getCode')}>
                  <Text style={[styles.sendText, { color: canSend ? palette.textPrimary : palette.textTertiary }]}>
                    {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.getCode')}
                  </Text>
                </Pressable>
              </View>

              {/* 新密码 */}
              <View style={[styles.field, { backgroundColor: palette.card }]}>
                <SymbolView name="lock" tintColor={palette.textTertiary} size={16} />
                <View style={styles.fieldGap} />
                <TextInput
                  style={[styles.input, { color: palette.textPrimary }]}
                  placeholder={t('auth.newPasswordPlaceholder')}
                  placeholderTextColor={palette.textTertiary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  textContentType="newPassword"
                  editable={!busy}
                  onSubmitEditing={onSubmit}
                  returnKeyType="go"
                />
                <Pressable
                  hitSlop={8}
                  onPress={() => setShowPassword((v) => !v)}
                  accessibilityLabel={t('auth.showPassword')}
                >
                  <SymbolView name={showPassword ? 'eye.slash' : 'eye'} tintColor={palette.textSecondary} size={18} />
                </Pressable>
              </View>

              {/* 主按钮 */}
              <Pressable
                onPress={onSubmit}
                disabled={!canSubmit}
                style={[styles.primary, { backgroundColor: palette.ink, opacity: canSubmit ? 1 : 0.35 }]}
              >
                {busy ? (
                  <ActivityIndicator color={palette.onInk} />
                ) : (
                  <Text style={[styles.primaryText, { color: palette.onInk }]}>{t('auth.resetPassword')}</Text>
                )}
              </Pressable>

              {/* 安全说明 */}
              <View style={styles.hintRow}>
                <SymbolView name="checkmark.shield" tintColor={palette.textTertiary} size={13} />
                <Text style={[styles.hint, { color: palette.textTertiary }]}>{t('auth.resetSuccessHint')}</Text>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </PageSheet>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 52,
    paddingHorizontal: Space[4],
  },
  headerBtn: { minWidth: 44, justifyContent: 'center' },
  cancelText: { fontSize: 16 },
  headerTitle: { fontSize: 17, fontWeight: '600' },

  content: { padding: Space[4], gap: Space[3] },
  subtitle: { fontSize: 14, lineHeight: 20, marginBottom: Space[1] },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
  },
  fieldGap: { width: Space[2] },
  ccDivider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: Space[3] },
  input: singleLineTextInputStyle,
  sendText: { fontSize: 15, fontWeight: '600' },

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
