/**
 * G4 邮箱管理小页（绑定 / 更换）。
 * 重新认证后，6 位验证码只发到新邮箱；在本页输入后立即生效，密码不变。
 * 验证通过前当前邮箱保持有效。新邮箱输入框始终保留；验证码发到与输入框相同的地址时，才在下方出现。
 * 同一地址重发不再重新认证。改成另一个地址后，需要重新认证再获取验证码。
 */
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
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
import { requireSensitiveReauthentication } from '@/features/auth/sensitive-reauth';
import { t, useLocalePreference } from '@/i18n';
import { bindEmail, normalizeEmail, resendEmailChange, useSession, verifyEmailChange } from '@/lib/auth';
import { EMAIL_CHANGE_CODE_LENGTH, emailChangeResendCooldown } from '@/lib/email-auth-flow';
import { supabase } from '@/lib/supabase';

type EmailChangeResult = { email: string; kind: 'bind' | 'change' };

/**
 * 绑定 / 验证错误 → 友好文案：
 * - 邮箱已被占用（email_exists）→ 明确提示换邮箱；
 * - 验证码错误或过期 → 提示重新获取，邮箱不变；
 * - 验证通过但服务端未改邮箱 → 不显示成功；
 * - 发送过频 / 网络异常 → 引导稍后重试。
 */
function emailChangeErrorText(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string; code?: string };
  const msg = (e?.message ?? '').toLowerCase();
  if (e?.code === 'email_change_incomplete') return t('account.emailChangeNotApplied');
  if (msg.includes('daily email verification code limit')) return t('auth.emailDailyLimit');
  if (
    e?.status === 429 ||
    msg.includes('only request this after') ||
    msg.includes('security purposes') ||
    msg.includes('rate limit')
  ) {
    return t('account.emailCodeTooSoon');
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
  const { session, loading } = useSession();

  const currentEmail = session?.user.email || null;
  const pendingEmail = session?.user.new_email || null;

  // null：还没改过输入框，未完成的新邮箱可以直接填进来；字符串：以用户输入为准，包括清空。
  const [draft, setDraft] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [awaitingEmail, setAwaitingEmail] = useState<string | null>(null);
  const [localSentAt, setLocalSentAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [result, setResult] = useState<EmailChangeResult | null>(null);
  // undefined：会话还没准备好；null：打开页面时没有邮箱（首次绑定）。
  const [openedWithEmail, setOpenedWithEmail] = useState<string | null | undefined>(undefined);
  if (!loading && openedWithEmail === undefined) {
    setOpenedWithEmail(currentEmail);
  }

  const email = draft ?? pendingEmail ?? '';
  const normalized = normalizeEmail(email);
  const sentTo = pendingEmail || awaitingEmail;
  const verifying = !result && !!normalized && normalized === sentTo;
  const success =
    result ??
    (verifying && currentEmail === normalized && !pendingEmail
      ? { email: normalized, kind: openedWithEmail ? 'change' : 'bind' }
      : null);
  const sentAt = success || !verifying ? null : (localSentAt ?? session?.user.email_change_sent_at ?? null);
  const cooldown = emailChangeResendCooldown(sentAt, now);
  const canRequest = !!normalized && !verifying && !busy;
  const canConfirm = verifying && code.length === EMAIL_CHANGE_CODE_LENGTH && !busy;
  const canResend = verifying && cooldown === 0 && !busy;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [cooldown, now]);

  useFocusEffect(
    useCallback(() => {
      void supabase.auth.refreshSession().catch(() => {});
    }, []),
  );

  const markSent = (address: string) => {
    setDraft(address);
    setAwaitingEmail(address);
    setCode('');
    setLocalSentAt(new Date().toISOString());
    setNow(Date.now());
    toast.success(t('auth.codeSent'));
  };

  const onRequestCode = async () => {
    if (!canRequest) {
      if (!normalized) toast.error(t('auth.invalidEmail'));
      return;
    }
    if (normalized === currentEmail) {
      toast.error(t('account.emailSame'));
      return;
    }
    setBusy(true);
    try {
      if (!(await requireSensitiveReauthentication(session?.user))) return;
      await bindEmail(normalized);
      markSent(normalized);
    } catch (err) {
      toast.error(emailChangeErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    if (!canResend || !normalized) return;
    setBusy(true);
    try {
      await resendEmailChange(normalized);
      markSent(normalized);
    } catch (err) {
      toast.error(emailChangeErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    if (!canConfirm || !normalized) {
      if (code.length !== EMAIL_CHANGE_CODE_LENGTH) toast.error(t('auth.recoverCodeLen'));
      return;
    }
    const kind = openedWithEmail ? 'change' : 'bind';
    setBusy(true);
    try {
      await verifyEmailChange(normalized, code);
      setResult({ email: normalized, kind });
    } catch (err) {
      toast.error(emailChangeErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const showCurrent = success?.email ?? (!success ? currentEmail : null);

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <Stack.Screen options={{ headerShown: true, title: t('account.email') }} />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.textSecondary} />
        </View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space[6] }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            {showCurrent ? (
              <View style={[styles.currentCard, { backgroundColor: palette.card }]}>
                <Text style={[styles.currentLabel, { color: palette.textSecondary }]}>{t('account.currentEmail')}</Text>
                <Text style={[styles.currentValue, { color: palette.textPrimary }]}>{showCurrent}</Text>
              </View>
            ) : null}

            {success ? (
              <>
                <Text style={[styles.result, { color: palette.textPrimary }]}>
                  {success.kind === 'change'
                    ? t('account.emailChangedBody', { email: success.email })
                    : t('account.emailBoundBody')}
                </Text>
                <Pressable
                  onPress={() => router.back()}
                  style={[styles.primary, { backgroundColor: palette.ink }]}
                  accessibilityRole="button"
                >
                  <Text style={[styles.primaryText, { color: palette.onInk }]}>{t('common.done')}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
                  {currentEmail ? t('account.rebindEmail') : t('account.bindEmail')}
                </Text>
                <View style={[styles.field, { backgroundColor: palette.card }]}>
                  <SymbolView name="envelope" tintColor={palette.textTertiary} size={16} />
                  <View style={styles.fieldGap} />
                  <TextInput
                    style={[styles.input, { color: palette.textPrimary }]}
                    placeholder={t('auth.emailPlaceholder')}
                    placeholderTextColor={palette.textTertiary}
                    value={email}
                    onChangeText={setDraft}
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    keyboardType="email-address"
                    inputMode="email"
                    textContentType="emailAddress"
                    editable={!busy}
                  />
                  {email.length > 0 ? (
                    <Pressable hitSlop={8} onPress={() => setDraft('')} accessibilityLabel={t('account.clearEmail')}>
                      <SymbolView name="xmark.circle.fill" tintColor={palette.textTertiary} size={16} />
                    </Pressable>
                  ) : null}
                </View>
                {verifying ? (
                  <View style={[styles.field, { backgroundColor: palette.card }]}>
                    <TextInput
                      style={[styles.input, { color: palette.textPrimary }]}
                      placeholder={t('auth.codePlaceholder')}
                      placeholderTextColor={palette.textTertiary}
                      value={code}
                      onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, EMAIL_CHANGE_CODE_LENGTH))}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      textContentType="oneTimeCode"
                      autoComplete="one-time-code"
                      maxLength={EMAIL_CHANGE_CODE_LENGTH}
                      editable={!busy}
                      accessibilityLabel={t('auth.codePlaceholder')}
                    />
                    <View style={[styles.codeDivider, { backgroundColor: palette.separator }]} />
                    <Pressable
                      hitSlop={6}
                      onPress={onResend}
                      disabled={!canResend}
                      accessibilityRole="button"
                      accessibilityLabel={t('auth.getCode')}
                    >
                      <Text
                        style={[styles.sendText, { color: canResend ? palette.textPrimary : palette.textTertiary }]}
                      >
                        {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.getCode')}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                <Pressable
                  onPress={verifying ? onConfirm : onRequestCode}
                  disabled={verifying ? !canConfirm : !canRequest}
                  style={[
                    styles.primary,
                    { backgroundColor: palette.ink, opacity: (verifying ? canConfirm : canRequest) ? 1 : 0.35 },
                  ]}
                  accessibilityRole="button"
                >
                  {busy ? (
                    <ActivityIndicator color={palette.onInk} />
                  ) : (
                    <Text style={[styles.primaryText, { color: palette.onInk }]}>
                      {verifying ? t('common.confirm') : t('auth.getCode')}
                    </Text>
                  )}
                </Pressable>
                <View style={styles.hintRow}>
                  <SymbolView name="checkmark.shield" tintColor={palette.textTertiary} size={13} />
                  <Text style={[styles.hint, { color: palette.textTertiary }]}>
                    {verifying && normalized
                      ? `${t('account.emailCodeSent', { email: normalized })} ${t('account.emailCodeHint')}`
                      : currentEmail
                        ? t('account.rebindEmailHint')
                        : t('account.bindEmailHint')}
                  </Text>
                </View>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
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
  currentLabel: { fontSize: 15, flexShrink: 0 },
  currentValue: { flexShrink: 1, marginLeft: Space[3], fontSize: 17, fontWeight: '600', textAlign: 'right' },

  sectionTitle: { fontSize: 15, fontWeight: '600', marginTop: Space[1], marginBottom: Space[1] },
  result: { fontSize: 16, lineHeight: 24 },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
  },
  fieldGap: { width: Space[2] },
  codeDivider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: Space[3] },
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
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: Space[1],
    marginTop: Space[2],
    paddingHorizontal: Space[2],
  },
  hint: { flexShrink: 1, fontSize: 12, lineHeight: 16, textAlign: 'center' },
});
