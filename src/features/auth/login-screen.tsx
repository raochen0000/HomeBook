/**
 * 登录页（流程 1）。目标形态：手机号 OTP 为主 + 邮箱 / Apple 为次；登录即注册、无独立注册页。
 *
 * **当前阶段（2026-06-30）：手机号 OTP 入口已展示**（手机号为主 + 邮箱 / Apple 为次）。
 * 短信通道已定方案——阿里云「短信认证服务」经 Send SMS Hook → FC 下发（免企业资质，代码见
 * `services/sms-hook-fc/`），客户端流程不变；待 FC 部署 + GoTrue 配 hook 后即通（详见 REMAINING #10）。
 * 未部署完成前「获取验证码」会失败，开发阶段用邮箱登录推进；由 `PHONE_OTP_ENABLED` 开关控制。
 *
 * 单屏内 phone / email 两态切换（「其它方式登录」互跳）；手机号单屏放「手机号 + 验证码」，
 * 「获取验证码」带 60s 倒计时。以全屏覆盖层渲染于 Tab 之上（无 session 时显示），
 * 登录成功后随 session 变化自动卸载（见 _layout.tsx）。
 *
 * 设计取舍（2026-06-26 与用户确认）：纯品牌头无插画；协议默认勾选仅告知（不拦截登录）；
 * 协议页 / 忘记密码先占位（toast）；走设计令牌、适配 Light/Night。
 */
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
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

import { Toast } from '@/components/toast';
import { Radius, Space, usePalette } from '@/constants/design';
import {
  isAppleAuthAvailable,
  normalizeCnPhone,
  sendPhoneOtp,
  signInWithApple,
  signInWithEmail,
  verifyPhoneOtp,
} from '@/lib/auth';

/** 协议链接蓝（一次性，沿用 iOS 系统蓝）。 */
const LINK_BLUE = '#0A84FF';
/** OTP 位数（与 Studio Phone provider 配置一致）。 */
const OTP_LEN = 6;

/**
 * 手机号 OTP 总开关。当前为开：手机号为主、显示「手机号 / 邮箱」互跳入口。
 * 注意短信通道需先完成运维部署（FC + GoTrue hook，REMAINING #10 / services/sms-hook-fc/），
 * 未部署完成前「获取验证码」会失败，开发阶段请改用邮箱登录。置 false 可隐藏手机号入口、回退为仅邮箱 + Apple。
 */
const PHONE_OTP_ENABLED = true;

/**
 * 把手机号 OTP 收/验的错误映射成友好文案：
 * - 验证码错误 / 过期 → 明确提示重新获取；
 * - 504 / 超时 / 网络不可达（短信通道异常）→ 引导改用邮箱 / Apple；
 * - 其余 → 原始 message 兜底（含已被 normalizeCnPhone 拦下的号码格式错误）。
 */
function otpErrorText(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string; code?: string };
  const status = e?.status;
  const msg = (e?.message ?? '').toLowerCase();

  if (e?.code === 'otp_expired' || msg.includes('invalid') || msg.includes('expired')) {
    return '验证码错误或已过期，请重新获取';
  }
  const timedOut =
    status === 504 ||
    status === 408 ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('deadline');
  const networkDown =
    status === 0 ||
    e?.name === 'AuthRetryableFetchError' ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch');
  if (timedOut || networkDown) {
    return '短信服务暂时不可用，请稍后重试，或改用邮箱 / Apple 登录';
  }
  return e?.message ?? String(err);
}

type Mode = 'phone' | 'email';

export function LoginScreen() {
  const palette = usePalette();
  const [mode, setMode] = useState<Mode>(PHONE_OTP_ENABLED ? 'phone' : 'email');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(true);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    isAppleAuthAvailable().then(setAppleAvailable);
  }, []);

  const handleApple = async () => {
    setBusy(true);
    try {
      await signInWithApple();
    } catch (e) {
      setToast((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            {/* 品牌头 */}
            <View style={styles.brand}>
              <Image source={require('@/assets/images/icon.png')} style={styles.logo} contentFit="contain" />
              <Text style={[styles.logoText, { color: palette.textPrimary }]}>家账</Text>
              <Text style={[styles.tagline, { color: palette.textSecondary }]}>和家人一起记账</Text>
              <Text style={[styles.tagline, { color: palette.textSecondary }]}>管理每一笔生活开支</Text>
            </View>

            {/* 表单卡片 */}
            <View style={[styles.card, { backgroundColor: palette.card }]}>
              {mode === 'phone' ? (
                <PhoneForm palette={palette} busy={busy} setBusy={setBusy} onToast={setToast} />
              ) : (
                <EmailForm palette={palette} busy={busy} setBusy={setBusy} onToast={setToast} />
              )}
            </View>

            {/* 其它方式登录 */}
            <View style={styles.others}>
              <View style={styles.dividerRow}>
                <View style={[styles.dividerLine, { backgroundColor: palette.separator }]} />
                <Text style={[styles.dividerText, { color: palette.textTertiary }]}>其它方式登录</Text>
                <View style={[styles.dividerLine, { backgroundColor: palette.separator }]} />
              </View>

              {/* 手机号入口受 PHONE_OTP_ENABLED 控制；关闭时只在邮箱态、不显示「手机号登录」 */}
              {PHONE_OTP_ENABLED && mode === 'phone' ? (
                <SecondaryButton
                  palette={palette}
                  icon="envelope"
                  label="邮箱登录"
                  disabled={busy}
                  onPress={() => setMode('email')}
                />
              ) : null}
              {PHONE_OTP_ENABLED && mode === 'email' ? (
                <SecondaryButton
                  palette={palette}
                  icon="iphone"
                  label="手机号登录"
                  disabled={busy}
                  onPress={() => setMode('phone')}
                />
              ) : null}

              {appleAvailable ? (
                <SecondaryButton
                  palette={palette}
                  icon="apple.logo"
                  label="通过 Apple 登录"
                  disabled={busy}
                  onPress={handleApple}
                />
              ) : null}
            </View>

            {/* 协议（默认勾选、仅告知，不拦截登录） */}
            <Pressable style={styles.agreeRow} hitSlop={6} onPress={() => setAgreed((v) => !v)}>
              <SymbolView
                name={agreed ? 'checkmark.circle.fill' : 'circle'}
                tintColor={agreed ? palette.accent : palette.textTertiary}
                size={16}
              />
              <Text style={[styles.agreeText, { color: palette.textTertiary }]}>
                登录即表示你已阅读并同意
                <Text style={{ color: LINK_BLUE }} onPress={() => setToast('用户协议 · 敬请期待')}>
                  《用户协议》
                </Text>
                与
                <Text style={{ color: LINK_BLUE }} onPress={() => setToast('隐私政策 · 敬请期待')}>
                  《隐私政策》
                </Text>
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <Toast visible={!!toast} text={toast ?? ''} onHide={() => setToast(null)} />
    </View>
  );
}

type FormProps = {
  palette: ReturnType<typeof usePalette>;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onToast: (t: string) => void;
};

// ── 手机号 OTP 表单 ───────────────────────────────────────────────────────────
function PhoneForm({ palette, busy, setBusy, onToast }: FormProps) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);

  const e164 = normalizeCnPhone(phone);
  const canSend = !!e164 && cooldown === 0 && !busy;
  const canLogin = !!e164 && code.length === OTP_LEN && !busy;

  // 倒计时：每秒自减，到 0 停。
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const onSend = async () => {
    if (!canSend) {
      if (!e164) onToast('请输入有效的中国大陆手机号');
      return;
    }
    setBusy(true);
    try {
      await sendPhoneOtp(phone);
      setCooldown(60);
      onToast('验证码已发送');
    } catch (err) {
      onToast(otpErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onLogin = async () => {
    if (!canLogin) return;
    setBusy(true);
    try {
      await verifyPhoneOtp(phone, code);
      // 成功后 session 变化会卸载本页。
    } catch (err) {
      onToast(otpErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Text style={[styles.label, { color: palette.textSecondary }]}>手机号</Text>
      <View style={[styles.field, { backgroundColor: palette.base }]}>
        <Text style={[styles.cc, { color: palette.textPrimary }]}>+86</Text>
        <SymbolView name="chevron.down" tintColor={palette.textTertiary} size={11} />
        <View style={[styles.ccDivider, { backgroundColor: palette.separator }]} />
        <TextInput
          style={[styles.input, { color: palette.textPrimary }]}
          placeholder="请输入手机号"
          placeholderTextColor={palette.textTertiary}
          value={phone}
          onChangeText={setPhone}
          keyboardType="number-pad"
          maxLength={11}
          editable={!busy}
        />
      </View>

      <Text style={[styles.label, { color: palette.textSecondary }]}>短信验证码</Text>
      <View style={[styles.field, { backgroundColor: palette.base }]}>
        <TextInput
          style={[styles.input, { color: palette.textPrimary }]}
          placeholder="请输入验证码"
          placeholderTextColor={palette.textTertiary}
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, ''))}
          keyboardType="number-pad"
          maxLength={OTP_LEN}
          editable={!busy}
          onSubmitEditing={onLogin}
          returnKeyType="go"
        />
        <View style={[styles.ccDivider, { backgroundColor: palette.separator }]} />
        <Pressable hitSlop={6} onPress={onSend} disabled={!canSend}>
          <Text style={[styles.sendText, { color: canSend ? palette.textPrimary : palette.textTertiary }]}>
            {cooldown > 0 ? `${cooldown}s 后重发` : '获取验证码'}
          </Text>
        </Pressable>
      </View>

      <PrimaryButton palette={palette} busy={busy} enabled={canLogin} label="登录" onPress={onLogin} />

      <View style={styles.hintRow}>
        <SymbolView name="checkmark.shield" tintColor={palette.textTertiary} size={13} />
        <Text style={[styles.hint, { color: palette.textTertiary }]}>未注册的手机号验证通过后将自动创建账号并登录</Text>
      </View>
    </>
  );
}

// ── 邮箱密码表单 ──────────────────────────────────────────────────────────────
function EmailForm({ palette, busy, setBusy, onToast }: FormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canLogin = emailValid && password.length >= 6 && !busy;

  const onLogin = async () => {
    if (!canLogin) {
      onToast(emailValid ? '密码至少 6 位' : '请输入有效邮箱');
      return;
    }
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      // 成功后 session 变化会卸载本页。
    } catch (err) {
      onToast((err as Error).message ?? String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={[styles.field, { backgroundColor: palette.base }]}>
        <SymbolView name="envelope" tintColor={palette.textTertiary} size={16} />
        <View style={styles.fieldGap} />
        <TextInput
          style={[styles.input, { color: palette.textPrimary }]}
          placeholder="请输入邮箱地址"
          placeholderTextColor={palette.textTertiary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          textContentType="emailAddress"
          editable={!busy}
        />
        {email.length > 0 ? (
          <Pressable hitSlop={8} onPress={() => setEmail('')}>
            <SymbolView name="xmark.circle.fill" tintColor={palette.textTertiary} size={16} />
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.field, { backgroundColor: palette.base }]}>
        <SymbolView name="lock" tintColor={palette.textTertiary} size={16} />
        <View style={styles.fieldGap} />
        <TextInput
          style={[styles.input, { color: palette.textPrimary }]}
          placeholder="请输入密码"
          placeholderTextColor={palette.textTertiary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect={false}
          textContentType="password"
          editable={!busy}
          onSubmitEditing={onLogin}
          returnKeyType="go"
        />
        <Pressable hitSlop={8} onPress={() => setShowPassword((v) => !v)}>
          <SymbolView name={showPassword ? 'eye.slash' : 'eye'} tintColor={palette.textSecondary} size={18} />
        </Pressable>
      </View>

      <Pressable hitSlop={6} style={styles.forgot} onPress={() => onToast('找回密码 · 敬请期待')}>
        <Text style={[styles.forgotText, { color: palette.textTertiary }]}>忘记密码?</Text>
      </Pressable>

      <PrimaryButton palette={palette} busy={busy} enabled={canLogin} label="登录" onPress={onLogin} />

      <View style={styles.hintRow}>
        <SymbolView name="checkmark.shield" tintColor={palette.textTertiary} size={13} />
        <Text style={[styles.hint, { color: palette.textTertiary }]}>未注册的邮箱将自动创建账号并登录</Text>
      </View>
    </>
  );
}

// ── 复用件 ────────────────────────────────────────────────────────────────────
function PrimaryButton({
  palette,
  busy,
  enabled,
  label,
  onPress,
}: {
  palette: ReturnType<typeof usePalette>;
  busy: boolean;
  enabled: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!enabled}
      style={[styles.primary, { backgroundColor: palette.accent, opacity: enabled ? 1 : 0.35 }]}
    >
      {busy ? (
        <ActivityIndicator color={palette.onAccent} />
      ) : (
        <Text style={[styles.primaryText, { color: palette.onAccent }]}>{label}</Text>
      )}
    </Pressable>
  );
}

function SecondaryButton({
  palette,
  icon,
  label,
  disabled,
  onPress,
}: {
  palette: ReturnType<typeof usePalette>;
  icon: SymbolViewProps['name'];
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.secondary, { backgroundColor: palette.card, opacity: disabled ? 0.6 : 1 }]}
    >
      <SymbolView name={icon} tintColor={palette.textPrimary} size={18} />
      <Text style={[styles.secondaryText, { color: palette.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Space[5],
    paddingVertical: Space[8],
    gap: Space[6],
  },

  // 品牌头
  brand: { gap: Space[2] },
  logo: { width: 64, height: 64, borderRadius: Radius.lg },
  logoText: { fontSize: 40, fontWeight: '700', marginTop: Space[2] },
  tagline: { fontSize: 17, lineHeight: 24 },

  // 卡片
  card: { borderRadius: Radius.lg, padding: Space[5], gap: Space[2] },
  label: { fontSize: 14, marginTop: Space[2], marginBottom: Space[1] },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
  },
  fieldGap: { width: Space[2] },
  cc: { fontSize: 16, fontWeight: '600' },
  ccDivider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: Space[3] },
  input: { flex: 1, fontSize: 16, paddingVertical: 0 },
  sendText: { fontSize: 15, fontWeight: '600' },

  primary: {
    height: 52,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Space[3],
  },
  primaryText: { fontSize: 17, fontWeight: '600' },

  hintRow: { flexDirection: 'row', alignItems: 'center', gap: Space[1], marginTop: Space[2] },
  hint: { flex: 1, fontSize: 12, lineHeight: 16 },

  forgot: { alignSelf: 'flex-end', marginTop: Space[2] },
  forgotText: { fontSize: 13 },

  // 其它方式登录
  others: { gap: Space[3] },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 13 },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[2],
    height: 52,
    borderRadius: Radius.md,
  },
  secondaryText: { fontSize: 16, fontWeight: '600' },

  // 协议
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space[2], paddingHorizontal: Space[1] },
  agreeText: { flex: 1, fontSize: 12, lineHeight: 18 },
});
