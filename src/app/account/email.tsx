/**
 * G5 邮箱管理小页（绑定 / 换绑）。已登录用户把邮箱挂到当前账号（账号合并，TECH §7.3）。
 * 流程：输入邮箱 → 获取验证码（updateUser({ email }) 触发 email_change 邮件 OTP，60s 倒计时）
 * → 输入 6 位验证码 → 确认绑定（verifyOtp type=email_change）→ 回到账号页，session 自动刷新邮箱。
 * 与手机号页（G4）同构：同一套 field / OTP / 主按钮语言，CTA 用 palette.accent 适配 Light/Night。
 * 说明：email_change 走 OTP 需邮件模板含 {{ .Token }}（运维前提，同短信通道）；未配好时会提示重试。
 * 本页只做绑定 / 换绑，不涉及密码（登录用邮箱+密码，密码在 G7「修改密码」设置）。
 */
import { Stack, useRouter } from 'expo-router';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { Radius, Space, usePalette } from '@/constants/design';
import { singleLineTextInputStyle } from '@/constants/text-input';
import { t, useLocalePreference } from '@/i18n';
import { bindEmail, normalizeEmail, useSession, verifyEmailChange } from '@/lib/auth';

/** OTP 位数（与 Studio 邮件模板配置一致）。 */
const OTP_LEN = 6;

/** 邮箱脱敏为「r***@gmail.com」（与账号页一致）。 */
function maskEmail(email?: string | null): string {
  if (!email) return '';
  const [name, domain] = email.split('@');
  if (!domain) return t('common.bound');
  return `${name.slice(0, 1)}***@${domain}`;
}

/**
 * 绑定 / 验证错误 → 友好文案：
 * - 邮箱已被占用（email_exists）→ 明确提示换邮箱；
 * - 验证码错误 / 过期 → 提示重新获取；
 * - 网络 / 邮件通道异常 → 引导稍后重试；
 * - 其余 → 原始 message 兜底。
 */
function bindErrorText(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string; code?: string };
  const msg = (e?.message ?? '').toLowerCase();
  if (e?.status === 429 || msg.includes('daily email verification code limit')) {
    return t('auth.emailDailyLimit');
  }
  if (e?.code === 'email_exists' || msg.includes('already registered') || msg.includes('already been registered')) {
    return t('account.emailTaken');
  }
  if (e?.code === 'otp_expired' || msg.includes('invalid') || msg.includes('expired') || msg.includes('token')) {
    return t('auth.codeInvalid');
  }
  const status = e?.status;
  const down =
    status === 504 ||
    status === 408 ||
    status === 0 ||
    e?.name === 'AuthRetryableFetchError' ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch');
  if (down) return t('auth.mailUnavailable');
  return e?.message ?? String(err);
}

export default function EmailScreen() {
  const palette = usePalette();
  useLocalePreference();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useSession();

  const currentEmail = session?.user.email || null;
  const hasEmail = !!currentEmail;

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  const normalized = normalizeEmail(email);
  const canSend = !!normalized && cooldown === 0 && !busy;
  const canSubmit = !!normalized && code.length === OTP_LEN && !busy;

  // 倒计时：每秒自减，到 0 停。
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const onSend = async () => {
    if (!canSend) {
      if (!normalized) toast.error(t('auth.invalidEmail'));
      return;
    }
    if (normalized === currentEmail) {
      toast.error(t('account.emailSame'));
      return;
    }
    setBusy(true);
    try {
      await bindEmail(email); // updateUser({ email }) 触发 email_change 验证码下发
      setCooldown(60);
      toast.success(t('account.mailSent'));
    } catch (err) {
      toast.error(bindErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await verifyEmailChange(email, code);
      toast.success(hasEmail ? t('account.rebindOk') : t('account.bindOk'));
      // session 由 onAuthStateChange 自动刷新；稍候返回账号页以展示成功提示。
      setTimeout(() => router.back(), 700);
    } catch (err) {
      toast.error(bindErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <Stack.Screen options={{ headerShown: true, title: t('account.email') }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space[6] }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* 已绑定：当前邮箱卡片 */}
          {hasEmail ? (
            <View style={[styles.currentCard, { backgroundColor: palette.card }]}>
              <Text style={[styles.currentLabel, { color: palette.textSecondary }]}>{t('account.currentEmail')}</Text>
              <Text style={[styles.currentValue, { color: palette.textPrimary }]}>{maskEmail(currentEmail)}</Text>
            </View>
          ) : null}

          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            {hasEmail ? t('account.rebindEmail') : t('account.bindEmail')}
          </Text>

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
              onChangeText={(text) => setCode(text.replace(/\D/g, ''))}
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

          {/* 主按钮 */}
          <Pressable
            onPress={onSubmit}
            disabled={!canSubmit}
            style={[styles.primary, { backgroundColor: palette.ink, opacity: canSubmit ? 1 : 0.35 }]}
          >
            {busy ? (
              <ActivityIndicator color={palette.onInk} />
            ) : (
              <Text style={[styles.primaryText, { color: palette.onInk }]}>
                {hasEmail ? t('account.confirmRebind') : t('account.bindEmail')}
              </Text>
            )}
          </Pressable>

          {/* 安全说明 */}
          <View style={styles.hintRow}>
            <SymbolView name="checkmark.shield" tintColor={palette.textTertiary} size={13} />
            <Text style={[styles.hint, { color: palette.textTertiary }]}>{t('account.bindEmailHint')}</Text>
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

  currentCard: {
    borderRadius: Radius.lg,
    paddingHorizontal: Space[4],
    paddingVertical: Space[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Space[2],
  },
  currentLabel: { fontSize: 15 },
  currentValue: { fontSize: 17, fontWeight: '600' },

  sectionTitle: { fontSize: 15, fontWeight: '600', marginTop: Space[1], marginBottom: Space[1] },

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
