/**
 * G4 手机号管理小页（绑定 / 换绑）。已登录用户把手机号挂到当前账号（账号合并，TECH §7.3）。
 * 流程：输入 +86 手机号 → 获取验证码（GoTrue updateUser 触发 phone_change OTP，60s 倒计时）
 * → 输入 6 位验证码 → 确认绑定（verifyOtp type=phone_change）→ 回到账号页，session 自动刷新手机号。
 * 视觉沿用登录页手机号 OTP 表单（同一套 field / OTP / 主按钮语言），但 CTA 用 palette.accent
 * 以适配 Light/Night（登录页硬编码的深色按钮在深色 base 上会不可见）。仅 +86 大陆号。
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
import { bindPhone, normalizeCnPhone, useSession, verifyPhoneChange } from '@/lib/auth';

/** OTP 位数（与 Studio Phone provider 配置一致）。 */
const OTP_LEN = 6;

/** +86 手机号脱敏为「138 **** 5678」。 */
function maskPhone(e164?: string | null): string {
  if (!e164) return '';
  const local = e164.replace(/^\+?86/, '');
  if (local.length !== 11) return '已绑定';
  return `${local.slice(0, 3)} **** ${local.slice(7)}`;
}

/**
 * 绑定 / 验证错误 → 友好文案：
 * - 手机号已被占用（phone_exists）→ 明确提示换号；
 * - 验证码错误 / 过期 → 提示重新获取；
 * - 网络 / 短信通道异常 → 引导稍后重试；
 * - 其余 → 原始 message 兜底。
 */
function bindErrorText(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string; code?: string };
  const msg = (e?.message ?? '').toLowerCase();
  if (e?.code === 'phone_exists' || msg.includes('already registered') || msg.includes('already been registered')) {
    return '该手机号已被其他账号绑定，请更换号码';
  }
  if (e?.code === 'otp_expired' || msg.includes('invalid') || msg.includes('expired') || msg.includes('token')) {
    return '验证码错误或已过期，请重新获取';
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
  if (down) return '短信服务暂时不可用，请稍后重试';
  return e?.message ?? String(err);
}

export default function PhoneScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useSession();

  const currentPhone = session?.user.phone || null;
  const hasPhone = !!currentPhone;

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [busy, setBusy] = useState(false);

  const e164 = normalizeCnPhone(phone);
  const canSend = !!e164 && cooldown === 0 && !busy;
  const canSubmit = !!e164 && code.length === OTP_LEN && !busy;

  // 倒计时：每秒自减，到 0 停。
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onSend = async () => {
    if (!canSend) {
      if (!e164) toast.error('请输入有效的中国大陆手机号');
      return;
    }
    if (e164 === currentPhone) {
      toast.error('新手机号不能与当前手机号相同');
      return;
    }
    setBusy(true);
    try {
      await bindPhone(phone); // updateUser({ phone }) 触发 phone_change 验证码下发
      setCooldown(60);
      toast.success('验证码已发送');
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
      await verifyPhoneChange(phone, code);
      toast.success(hasPhone ? '换绑成功' : '绑定成功');
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
      <Stack.Screen options={{ headerShown: true, title: '手机号' }} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space[6] }]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* 已绑定：当前号码卡片 */}
          {hasPhone ? (
            <View style={[styles.currentCard, { backgroundColor: palette.card }]}>
              <Text style={[styles.currentLabel, { color: palette.textSecondary }]}>当前手机号</Text>
              <Text style={[styles.currentValue, { color: palette.textPrimary }]}>{maskPhone(currentPhone)}</Text>
            </View>
          ) : null}

          <Text style={[styles.sectionTitle, { color: palette.textPrimary }]}>
            {hasPhone ? '换绑手机号' : '绑定手机号'}
          </Text>

          {/* 手机号 */}
          <View style={[styles.field, { backgroundColor: palette.card }]}>
            <Text style={[styles.cc, { color: palette.textPrimary }]}>+86</Text>
            <SymbolView name="chevron.down" tintColor={palette.textTertiary} size={11} />
            <View style={[styles.ccDivider, { backgroundColor: palette.separator }]} />
            <TextInput
              style={[styles.input, { color: palette.textPrimary }]}
              placeholder="请输入手机号"
              placeholderTextColor={palette.textTertiary}
              value={phone}
              onChangeText={(t) => setPhone(t.replace(/\D/g, ''))}
              keyboardType="number-pad"
              textContentType="telephoneNumber"
              maxLength={11}
              editable={!busy}
            />
            {phone.length > 0 ? (
              <Pressable hitSlop={8} onPress={() => setPhone('')} accessibilityLabel="清除手机号">
                <SymbolView name="xmark.circle.fill" tintColor={palette.textTertiary} size={16} />
              </Pressable>
            ) : null}
          </View>

          {/* 验证码 */}
          <View style={[styles.field, { backgroundColor: palette.card }]}>
            <TextInput
              style={[styles.input, { color: palette.textPrimary }]}
              placeholder="请输入验证码"
              placeholderTextColor={palette.textTertiary}
              value={code}
              onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              maxLength={OTP_LEN}
              editable={!busy}
            />
            <View style={[styles.ccDivider, { backgroundColor: palette.separator }]} />
            <Pressable hitSlop={6} onPress={onSend} disabled={!canSend} accessibilityLabel="获取验证码">
              <Text style={[styles.sendText, { color: canSend ? palette.textPrimary : palette.textTertiary }]}>
                {cooldown > 0 ? `${cooldown}s 后重发` : '获取验证码'}
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
              <Text style={[styles.primaryText, { color: palette.onInk }]}>{hasPhone ? '确认换绑' : '绑定手机号'}</Text>
            )}
          </Pressable>

          {/* 安全说明 */}
          <View style={styles.hintRow}>
            <SymbolView name="checkmark.shield" tintColor={palette.textTertiary} size={13} />
            <Text style={[styles.hint, { color: palette.textTertiary }]}>
              绑定后可用该手机号进行登录；目前仅支持中国大陆手机号。
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
  currentValue: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },

  sectionTitle: { fontSize: 15, fontWeight: '600', marginTop: Space[1], marginBottom: Space[1] },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
  },
  cc: { fontSize: 16, fontWeight: '600' },
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
