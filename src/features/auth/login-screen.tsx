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
 * 设计取舍（2026-06-26 与用户确认）：纯品牌头无插画；协议页 / 忘记密码先占位（toast）；
 * 走设计令牌、适配 Light/Night。
 *
 * 协议勾选（2026-07-17 改）：默认不勾选，且是硬闸门——未勾选时全部登录入口（手机验证码 /
 * 邮箱 / Apple / 获取验证码）均被 ensureAgreed 拦下并 toast 提示。原为默认勾选且仅告知，
 * 不符合《个人信息保护法》明示同意与工信部对「默认勾选隐私政策」的认定。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { toast } from '@/components/toast';
import { Radius, Space, usePalette } from '@/constants/design';
import { singleLineTextInputStyle } from '@/constants/text-input';
import {
  isAppleAuthAvailable,
  normalizeCnPhone,
  sendPhoneOtp,
  signInWithApple,
  signInWithEmail,
  verifyPhoneOtp,
} from '@/lib/auth';

import { ForgotPasswordSheet } from './forgot-password-sheet';

/** OTP 位数（与 Studio Phone provider 配置一致）。 */
const OTP_LEN = 6;
/** 切换手机号 / 邮箱登录时，底部内容区保持同一视觉高度。 */
const LOGIN_PANEL_MIN_HEIGHT = 382;

/**
 * 插画区高度的回退值：仅用于卡片高度测出来之前的首帧（见 artHeight）。
 * 实际高度是按卡片顶边算的，不要指望改这里能挪动插画。
 */
const ART_HEIGHT_FALLBACK = 360;
/** 插画底边压进卡片的重叠量，保证渐隐收尾被卡片圆角盖住、不留缝。 */
const ART_CARD_OVERLAP = 10;
/**
 * 插画底部渐隐带高度（仅深色模式）。login-background.png 是索引色、无 alpha，
 * 是一块实心矩形，底边会硬切在插画区底部；这里用纯 alpha 蒙版
 * background-fade.png（smoothstep 0→1）染成 palette.base 盖住底部，让插画溶进页面。
 * 蒙版在插画区底部恰好完全不透明，故那条实心底边被彻底盖掉。
 *
 * 渐隐带底部永远贴着插画区底部（否则硬边会重新露出来），所以只有「长度」可调：
 * 调小 → 化得更晚、更贴卡片；调大 → 提前化完、和卡片之间空出一段纯黑。
 */
const ART_FADE_HEIGHT = 95;
/**
 * 插画整幅亮度只落在 215–254（29 色索引图，26 色挤在 234–254），本质是「一张纸」，
 * 形体全靠极细微的明暗差撑起来——放在浅色页面上才读得出来。
 *
 * 浅色：插画底色 ≈#F4F3F6 与 light base #F2F1F5 几乎同色，0.72 叠上去毫无痕迹，
 *       底边那 1.4 级色差看不见，故浅色不需要渐隐带（挂上反而会把房子下半身一起化掉）。
 * 深色：base 是纯黑，同样的 0.72 会算出 155–183 的亮板 —— 割裂感的来源。
 *       但压暗只能减眩光、消不掉「平板感」（任何 opacity 都只是等比缩放这 215–254），
 *       真正解决靠渐隐带。0.3 是平衡点：再低房子就糊没了。
 */
const ART_OPACITY_LIGHT = 0.72;
const ART_OPACITY_DARK = 0.3;

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
type RememberedLogin = { rememberMe: boolean; mode?: Mode; phone?: string; email?: string };

const REMEMBER_LOGIN_KEY = '@homebook/auth/remember-login-v1';

function parseRememberedLogin(raw: string | null): RememberedLogin | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<RememberedLogin>;
    return {
      rememberMe: data.rememberMe !== false,
      mode: data.mode === 'phone' || data.mode === 'email' ? data.mode : undefined,
      phone: typeof data.phone === 'string' ? data.phone : undefined,
      email: typeof data.email === 'string' ? data.email : undefined,
    };
  } catch {
    return null;
  }
}

export function LoginScreen() {
  const palette = usePalette();
  const isDark = useColorScheme() === 'dark';
  const { height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>(PHONE_OTP_ENABLED ? 'phone' : 'email');
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [appleSheetOpen, setAppleSheetOpen] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);

  useEffect(() => {
    isAppleAuthAvailable().then(setAppleAvailable);
  }, []);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(REMEMBER_LOGIN_KEY).then((raw) => {
      if (!alive) return;
      const remembered = parseRememberedLogin(raw);
      if (!remembered) return;
      setRememberMe(remembered.rememberMe);
      if (!remembered.rememberMe) return;
      if (remembered.phone) setPhoneInput(remembered.phone);
      if (remembered.email) setEmailInput(remembered.email);
      if (remembered.mode === 'email' || (remembered.mode === 'phone' && PHONE_OTP_ENABLED)) {
        setMode(remembered.mode);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const persistRememberChoice = useCallback(
    async (nextRememberMe: boolean, payload?: Omit<RememberedLogin, 'rememberMe'>) => {
      const next: RememberedLogin = { rememberMe: nextRememberMe };
      if (nextRememberMe && payload?.mode) {
        next.mode = payload.mode;
        if (payload.mode === 'phone' && payload.phone) next.phone = payload.phone.replace(/\D/g, '').slice(0, 11);
        if (payload.mode === 'email' && payload.email) next.email = payload.email.trim().toLowerCase();
      }
      await AsyncStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify(next)).catch(() => {});
    },
    [],
  );

  const handleRememberChange = useCallback(
    (next: boolean) => {
      setRememberMe(next);
      void persistRememberChoice(next);
    },
    [persistRememberChoice],
  );

  // 协议闸门：未勾选时拦截所有登录入口并提示。返回 false 表示调用方应中止。
  const ensureAgreed = useCallback(() => {
    if (agreed) return true;
    toast.warning('请先阅读并同意《用户协议》与《隐私政策》');
    return false;
  }, [agreed]);

  /**
   * 插画区高度跟着登录卡片走，而不是钉死一个「距屏顶」的常数。
   *
   * 卡片是 flex-end 贴底的，所以它静止时的顶边只由屏高、底部安全区、卡片自身高度决定：
   * 卡片顶边 = screenHeight - insets.bottom - panelHeight。而插画/渐隐是绝对定位、从屏顶起算，
   * 两套坐标系会随屏高线性漂移——6.7" 机型上标题正好掉进渐隐带里。让插画底边跟到卡片上即可对齐。
   *
   * 只测卡片「高度」、不测它的 y：键盘弹出时 KeyboardAvoidingView 会改变 y，
   * 那样插画会跟着键盘缩放抖动；高度不受键盘影响，故取到的始终是静止位置。
   */
  const artHeight =
    panelHeight == null ? ART_HEIGHT_FALLBACK : screenHeight - insets.bottom - panelHeight + ART_CARD_OVERLAP;

  const handleApple = async () => {
    setBusy(true);
    try {
      await signInWithApple();
    } catch (e) {
      toast.error((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <Image
        source={require('@/assets/images/login/login-background.png')}
        style={[styles.backgroundArt, { height: artHeight, opacity: isDark ? ART_OPACITY_DARK : ART_OPACITY_LIGHT }]}
        contentFit="cover"
        pointerEvents="none"
      />
      {/* 渐隐带盖在插画之上、内容之下：只化开底边，不会连带压暗品牌文字。 */}
      {isDark ? (
        <Image
          source={require('@/assets/images/login/background-fade.png')}
          style={[styles.backgroundFade, { top: artHeight - ART_FADE_HEIGHT }]}
          tintColor={palette.base}
          contentFit="fill"
          pointerEvents="none"
        />
      ) : null}
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.content}>
            {/* 品牌头 */}
            <View style={styles.brand}>
              <Image
                source={require('@/assets/expo.icon/Assets/homebook-Icon-appstore-1024.png')}
                style={styles.logo}
                contentFit="contain"
              />
              <Text style={[styles.logoText, { color: palette.textPrimary }]}>家账</Text>
              <Text style={[styles.tagline, { color: palette.textSecondary }]}>和家人一起记账</Text>
              <Text style={[styles.tagline, { color: palette.textSecondary }]}>管理每一笔生活开支</Text>
            </View>

            <View
              onLayout={(e) => setPanelHeight(e.nativeEvent.layout.height)}
              style={[
                styles.loginPanel,
                {
                  backgroundColor: palette.card,
                  shadowColor: palette.shadow,
                },
              ]}
            >
              <View style={styles.formArea}>
                {mode === 'phone' ? (
                  <PhoneForm
                    palette={palette}
                    busy={busy}
                    rememberMe={rememberMe}
                    setRememberMe={handleRememberChange}
                    phone={phoneInput}
                    setPhone={setPhoneInput}
                    setBusy={setBusy}
                    ensureAgreed={ensureAgreed}
                    onRememberLogin={(payload) => void persistRememberChoice(rememberMe, payload)}
                  />
                ) : (
                  <EmailForm
                    palette={palette}
                    busy={busy}
                    rememberMe={rememberMe}
                    setRememberMe={handleRememberChange}
                    email={emailInput}
                    setEmail={setEmailInput}
                    setBusy={setBusy}
                    ensureAgreed={ensureAgreed}
                    onRememberLogin={(payload) => void persistRememberChoice(rememberMe, payload)}
                    onForgot={() => setForgotOpen(true)}
                  />
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
                    onPress={() => {
                      if (!ensureAgreed()) return;
                      setAppleSheetOpen(true);
                    }}
                  />
                ) : null}
              </View>

              {/* 协议：未勾选时拦截全部登录入口（含获取验证码），点击时 toast 提示 */}
              <Pressable style={styles.agreeRow} hitSlop={6} onPress={() => setAgreed((v) => !v)}>
                <SymbolView
                  name={agreed ? 'checkmark.circle.fill' : 'circle'}
                  tintColor={agreed ? palette.ink : palette.textTertiary}
                  size={16}
                />
                <Text style={[styles.agreeText, { color: palette.textTertiary }]}>
                  登录即表示你已阅读并同意
                  <Text style={{ color: palette.accent }} onPress={() => toast.info('用户协议 · 敬请期待')}>
                    《用户协议》
                  </Text>
                  与
                  <Text style={{ color: palette.accent }} onPress={() => toast.info('隐私政策 · 敬请期待')}>
                    《隐私政策》
                  </Text>
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
      <AppleLoginSheet
        visible={appleSheetOpen}
        palette={palette}
        busy={busy}
        onClose={() => setAppleSheetOpen(false)}
        onContinue={async () => {
          await handleApple();
          setAppleSheetOpen(false);
        }}
      />
      <ForgotPasswordSheet visible={forgotOpen} initialEmail={emailInput} onClose={() => setForgotOpen(false)} />
    </View>
  );
}

type FormProps = {
  palette: ReturnType<typeof usePalette>;
  busy: boolean;
  rememberMe: boolean;
  setRememberMe: (b: boolean) => void;
  setBusy: (b: boolean) => void;
  /** 协议未勾选时返回 false（并已提示），调用方须中止。 */
  ensureAgreed: () => boolean;
  onRememberLogin: (payload: Omit<RememberedLogin, 'rememberMe'>) => void;
};

// ── 手机号 OTP 表单 ───────────────────────────────────────────────────────────
function PhoneForm({
  palette,
  busy,
  rememberMe,
  setRememberMe,
  setBusy,
  ensureAgreed,
  onRememberLogin,
  phone,
  setPhone,
}: FormProps & { phone: string; setPhone: (value: string) => void }) {
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
    if (!ensureAgreed()) return;
    if (!canSend) {
      if (!e164) toast.error('请输入有效的中国大陆手机号');
      return;
    }
    setBusy(true);
    try {
      await sendPhoneOtp(phone);
      setCooldown(60);
      toast.success('验证码已发送');
    } catch (err) {
      toast.error(otpErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onLogin = async () => {
    if (!ensureAgreed()) return;
    if (!canLogin) return;
    setBusy(true);
    try {
      await verifyPhoneOtp(phone, code);
      onRememberLogin({ mode: 'phone', phone });
      // 成功后 session 变化会卸载本页。
    } catch (err) {
      toast.error(otpErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={[styles.field, { backgroundColor: palette.base }]}>
        <Text style={[styles.cc, { color: palette.textPrimary }]}>+86</Text>
        <SymbolView name="chevron.down" tintColor={palette.textTertiary} size={11} />
        <View style={[styles.ccDivider, { backgroundColor: palette.separator }]} />
        <TextInput
          style={[styles.input, { color: palette.textPrimary }]}
          placeholder="请输入手机号"
          placeholderTextColor={palette.textTertiary}
          value={phone}
          onChangeText={(t) => setPhone(t.replace(/\D/g, '').slice(0, 11))}
          keyboardType="number-pad"
          maxLength={11}
          editable={!busy}
        />
      </View>

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
        />
        <View style={[styles.ccDivider, { backgroundColor: palette.separator }]} />
        <Pressable hitSlop={6} onPress={onSend} disabled={!canSend}>
          <Text style={[styles.sendText, { color: canSend ? palette.textPrimary : palette.textTertiary }]}>
            {cooldown > 0 ? `${cooldown}s 后重发` : '获取验证码'}
          </Text>
        </Pressable>
      </View>

      <LoginOptionsRow palette={palette} rememberMe={rememberMe} setRememberMe={setRememberMe} />

      <PrimaryButton palette={palette} busy={busy} enabled={canLogin} label="登录" onPress={onLogin} />

      <View style={styles.hintRow}>
        <SymbolView name="checkmark.shield" tintColor={palette.textTertiary} size={13} />
        <Text style={[styles.hint, { color: palette.textTertiary }]}>未注册的手机号验证通过后将自动创建账号并登录</Text>
      </View>
    </>
  );
}

// ── 邮箱密码表单 ──────────────────────────────────────────────────────────────
function EmailForm({
  palette,
  busy,
  rememberMe,
  setRememberMe,
  setBusy,
  ensureAgreed,
  onRememberLogin,
  email,
  setEmail,
  onForgot,
}: FormProps & { email: string; setEmail: (value: string) => void; onForgot: () => void }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canLogin = emailValid && password.length >= 6 && !busy;

  const onLogin = async () => {
    if (!ensureAgreed()) return;
    if (!canLogin) {
      toast.error(emailValid ? '密码至少 6 位' : '请输入有效邮箱');
      return;
    }
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      onRememberLogin({ mode: 'email', email });
      // 成功后 session 变化会卸载本页。
    } catch (err) {
      toast.error((err as Error).message ?? String(err));
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

      <LoginOptionsRow palette={palette} rememberMe={rememberMe} setRememberMe={setRememberMe} onForgot={onForgot} />

      <PrimaryButton palette={palette} busy={busy} enabled={canLogin} label="登录" onPress={onLogin} />

      <View style={styles.hintRow}>
        <SymbolView name="checkmark.shield" tintColor={palette.textTertiary} size={13} />
        <Text style={[styles.hint, { color: palette.textTertiary }]}>未注册的邮箱号验证通过后将自动创建账号并登录</Text>
      </View>
    </>
  );
}

// ── 复用件 ────────────────────────────────────────────────────────────────────
function LoginOptionsRow({
  palette,
  rememberMe,
  setRememberMe,
  onForgot,
}: {
  palette: ReturnType<typeof usePalette>;
  rememberMe: boolean;
  setRememberMe: (b: boolean) => void;
  onForgot?: () => void;
}) {
  return (
    <View style={styles.optionsRow}>
      <Pressable style={styles.remember} hitSlop={6} onPress={() => setRememberMe(!rememberMe)}>
        <SymbolView
          name={rememberMe ? 'checkmark.square.fill' : 'square'}
          tintColor={rememberMe ? palette.ink : palette.textTertiary}
          size={15}
        />
        <Text style={[styles.rememberText, { color: palette.textTertiary }]}>记住我</Text>
      </Pressable>
      {onForgot ? (
        <Pressable hitSlop={6} onPress={onForgot}>
          <Text style={[styles.forgotText, { color: palette.textTertiary }]}>忘记密码?</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function AppleLoginSheet({
  visible,
  palette,
  busy,
  onClose,
  onContinue,
}: {
  visible: boolean;
  palette: ReturnType<typeof usePalette>;
  busy: boolean;
  onClose: () => void;
  onContinue: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const [translateY] = useState(() => new Animated.Value(0));
  const busyRef = useRef(busy);
  const dragStartY = useRef(0);
  const currentDragY = useRef(0);

  useEffect(() => {
    if (visible) translateY.setValue(0);
  }, [translateY, visible]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const closeWithDrag = useCallback(() => {
    Animated.timing(translateY, {
      toValue: 420,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      translateY.setValue(0);
      onClose();
    });
  }, [onClose, translateY]);

  const resetSheetPosition = () => {
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
  };

  const finishDrag = () => {
    if (busyRef.current) {
      resetSheetPosition();
      return;
    }
    if (currentDragY.current > 80) {
      closeWithDrag();
      return;
    }
    resetSheetPosition();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.appleModalRoot}>
        <Animated.View
          style={[
            styles.appleSheet,
            {
              backgroundColor: palette.card,
              paddingBottom: Math.max(insets.bottom + Space[2], Space[5]),
              transform: [{ translateY }],
            },
          ]}
        >
          <View
            style={styles.sheetGrabberHitArea}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(event) => {
              dragStartY.current = event.nativeEvent.pageY;
              currentDragY.current = 0;
            }}
            onResponderMove={(event) => {
              const dy = Math.max(0, event.nativeEvent.pageY - dragStartY.current);
              currentDragY.current = dy;
              translateY.setValue(dy);
            }}
            onResponderRelease={finishDrag}
            onResponderTerminate={finishDrag}
          >
            <View style={[styles.sheetGrabber, { backgroundColor: palette.separator }]} />
          </View>
          <Pressable style={styles.sheetCancel} hitSlop={8} onPress={onClose} disabled={busy}>
            <Text style={[styles.sheetCancelText, { color: palette.textSecondary }]}>取消</Text>
          </Pressable>

          <SymbolView name="apple.logo" tintColor={palette.textPrimary} size={38} />
          <Text style={[styles.sheetTitle, { color: palette.textPrimary }]}>通过 Apple 登录</Text>

          <View style={styles.sheetBenefits}>
            <AppleBenefit
              palette={palette}
              icon="checkmark.shield"
              title="快速、安全、保护隐私"
              text="使用你已有的 Apple 账号登录，无需创建新账号，App 不会获取你的密码。"
            />
            <AppleBenefit
              palette={palette}
              icon="person"
              title="仅分享必要信息"
              text="你可选择分享姓名和电子邮件，App 将严格保护你的隐私。"
            />
            <AppleBenefit
              palette={palette}
              icon="key"
              title="在设备间轻松登录"
              text="使用 iCloud 钥匙串，帮你在所有 Apple 设备上自动登录。"
            />
          </View>

          <View style={[styles.sheetRule, { backgroundColor: palette.separator }]} />
          <PrimaryButton palette={palette} busy={busy} enabled={!busy} label="通过 Apple 继续" onPress={onContinue} />
          <Text style={[styles.sheetBottomNote, { color: palette.textTertiary }]}>
            Apple 账号只用于登录家账，不会用于 Apple 服务以外的其他用途。
          </Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

function AppleBenefit({
  palette,
  icon,
  title,
  text,
}: {
  palette: ReturnType<typeof usePalette>;
  icon: SymbolViewProps['name'];
  title: string;
  text: string;
}) {
  return (
    <View style={styles.benefitRow}>
      <View style={[styles.benefitIcon, { backgroundColor: palette.base }]}>
        <SymbolView name={icon} tintColor={palette.textSecondary} size={24} />
      </View>
      <View style={styles.benefitText}>
        <Text style={[styles.benefitTitle, { color: palette.textPrimary }]}>{title}</Text>
        <Text style={[styles.benefitBody, { color: palette.textSecondary }]}>{text}</Text>
      </View>
    </View>
  );
}

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
      style={[styles.primary, { backgroundColor: palette.ink, opacity: enabled ? 1 : 0.35 }]}
    >
      {busy ? (
        <ActivityIndicator color={palette.onInk} />
      ) : (
        <Text style={[styles.primaryText, { color: palette.onInk }]}>{label}</Text>
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
      style={[
        styles.secondary,
        {
          backgroundColor: palette.card,
          borderColor: palette.separator,
          shadowColor: '#000000',
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <SymbolView name={icon} tintColor={palette.textPrimary} size={18} />
      <Text style={[styles.secondaryText, { color: palette.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  flex: { flex: 1 },
  // height 由 artHeight 动态给（跟随卡片顶边）。
  backgroundArt: {
    position: 'absolute',
    top: 0,
    left: -70,
    right: 0,
  },
  // top 同样动态给；只覆盖屏宽即可：插画左溢出的 70pt 在屏外，不需要化开。
  backgroundFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ART_FADE_HEIGHT,
  },
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: Space[4],
    paddingTop: Space[8],
    gap: Space[4],
  },

  // 品牌头
  brand: { minHeight: 245, justifyContent: 'flex-end', gap: Space[2], paddingBottom: Space[2] },
  logo: { width: 64, height: 64, borderRadius: Radius.lg, marginBottom: Space[2] },
  logoText: { fontSize: 40, fontWeight: '700' },
  tagline: { fontSize: 17, lineHeight: 24 },

  // 底部登录区域
  loginPanel: {
    minHeight: LOGIN_PANEL_MIN_HEIGHT,
    borderRadius: Radius.lgPlus,
    borderTopLeftRadius: Radius.lgPlus,
    borderTopRightRadius: Radius.lgPlus,
    borderBottomLeftRadius: Radius.lgPlus,
    borderBottomRightRadius: Radius.lgPlus,
    overflow: 'hidden',
    padding: Space[4],
    gap: Space[4],
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 1,
    shadowRadius: 28,
    elevation: 3,
  },
  formArea: { minHeight: 188, gap: Space[3] },
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
  },
  hint: { flexShrink: 1, fontSize: 12, lineHeight: 16, textAlign: 'center' },

  optionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 },
  remember: { flexDirection: 'row', alignItems: 'center', gap: Space[1] },
  rememberText: { fontSize: 13 },
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
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 1,
    elevation: 1,
  },
  secondaryText: { fontSize: 16, fontWeight: '600' },

  // 协议
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Space[2], paddingHorizontal: Space[1] },
  agreeText: { flex: 1, fontSize: 12, lineHeight: 18 },

  // Apple 登录说明 Sheet：不拉伸，靠内容自然决定高度。
  appleModalRoot: { flex: 1, justifyContent: 'flex-end' },
  appleSheet: {
    minHeight: 526,
    borderTopLeftRadius: Radius.lgPlus,
    borderTopRightRadius: Radius.lgPlus,
    paddingTop: Space[2],
    paddingHorizontal: Space[5],
    paddingBottom: Space[5],
    alignItems: 'center',
    gap: Space[2],
  },
  sheetGrabberHitArea: {
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingTop: Space[1],
    paddingBottom: Space[2],
  },
  sheetGrabber: { width: 38, height: 5, borderRadius: Radius.full },
  sheetCancel: { position: 'absolute', top: Space[4], left: Space[5] },
  sheetCancelText: { fontSize: 16 },
  sheetTitle: { fontSize: 22, lineHeight: 28, marginBottom: Space[1] },
  sheetBenefits: { width: '100%', gap: Space[6], marginVertical: Space[6] },
  benefitRow: { flexDirection: 'row', gap: Space[4], alignItems: 'flex-start' },
  benefitIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flex: 1, gap: Space[1] },
  benefitTitle: { fontSize: 13, lineHeight: 20, fontWeight: '500' },
  benefitBody: { fontSize: 12, lineHeight: 17 },
  sheetRule: { alignSelf: 'stretch', height: StyleSheet.hairlineWidth, marginTop: Space[6] },
  sheetBottomNote: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
