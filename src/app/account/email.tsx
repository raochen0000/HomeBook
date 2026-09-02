/**
 * G5 邮箱管理小页（绑定 / 换绑）。已登录用户把邮箱挂到当前账号（账号合并，TECH §7.3）。
 * 流程：输入邮箱 → 发送确认链接。首次绑定只确认新邮箱；安全换绑会分别向旧、新邮箱发送链接，
 * 两个链接均确认后由 Cloud Auth 提交变更。回到 App 时刷新会话以显示最新邮箱。
 * 本页只做绑定 / 换绑，不涉及密码（登录用邮箱+密码，密码在 G7「修改密码」设置）。
 */
import { Stack, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useState } from 'react';
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
import { bindEmail, normalizeEmail, useSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

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
  const { session } = useSession();

  const currentEmail = session?.user.email || null;
  const hasEmail = !!currentEmail;

  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const normalized = normalizeEmail(email);
  const canSubmit = !!normalized && !busy;

  useFocusEffect(
    useCallback(() => {
      void supabase.auth.refreshSession().catch(() => {});
    }, []),
  );

  const onSubmit = async () => {
    if (!canSubmit) {
      if (!normalized) toast.error(t('auth.invalidEmail'));
      return;
    }
    if (normalized === currentEmail) {
      toast.error(t('account.emailSame'));
      return;
    }
    setBusy(true);
    try {
      await bindEmail(email);
      toast.success(hasEmail ? t('account.rebindEmailLinkSent') : t('account.bindEmailLinkSent'));
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
                {hasEmail ? t('account.sendRebindEmail') : t('account.sendBindEmail')}
              </Text>
            )}
          </Pressable>

          {/* 安全说明 */}
          <View style={styles.hintRow}>
            <SymbolView name="checkmark.shield" tintColor={palette.textTertiary} size={13} />
            <Text style={[styles.hint, { color: palette.textTertiary }]}>
              {hasEmail ? t('account.rebindEmailHint') : t('account.bindEmailHint')}
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
  input: singleLineTextInputStyle,

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
