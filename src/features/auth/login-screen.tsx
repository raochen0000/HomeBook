/**
 * 登录页（流程 1，MVP：邮箱 + Apple ID；未注册自动注册）。
 *
 * 以全屏覆盖层形式渲染于 Tab 之上（无 session 时显示），登录成功后随 session 变化自动卸载。
 * 作为根布局的兄弟节点挂载（与启动动画同模式），不改动现有路由结构。
 */
import * as AppleAuthentication from 'expo-apple-authentication';
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

import { Radius, Space, usePalette } from '@/constants/design';
import { isAppleAuthAvailable, signInWithApple, signInWithEmail } from '@/lib/auth';

export function LoginScreen() {
  const palette = usePalette();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    isAppleAuthAvailable().then(setAppleAvailable);
  }, []);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = emailValid && password.length >= 6 && !busy;

  const handleEmail = async () => {
    if (!canSubmit) {
      setError(emailValid ? '密码至少 6 位' : '请输入有效邮箱');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      // 成功后 session 变化会卸载本页，无需手动跳转。
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleApple = async () => {
    setError(null);
    setBusy(true);
    try {
      await signInWithApple();
    } catch (e) {
      setError((e as Error).message ?? String(e));
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
              <Text style={[styles.logo, { color: palette.textPrimary }]}>家账</Text>
              <Text style={[styles.tagline, { color: palette.textSecondary }]}>一家人，一本账</Text>
            </View>

            {/* 邮箱 + 密码 */}
            <View style={styles.form}>
              <TextInput
                style={[styles.input, { backgroundColor: palette.card, color: palette.textPrimary }]}
                placeholder="邮箱"
                placeholderTextColor={palette.textTertiary}
                value={email}
                onChangeText={(t) => {
                  setEmail(t);
                  setError(null);
                }}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                textContentType="emailAddress"
                editable={!busy}
              />
              {/* 密码框 + 明文显示切换 */}
              <View style={[styles.passwordRow, { backgroundColor: palette.card }]}>
                <TextInput
                  style={[styles.passwordInput, { color: palette.textPrimary }]}
                  placeholder="密码（至少 6 位）"
                  placeholderTextColor={palette.textTertiary}
                  value={password}
                  onChangeText={(t) => {
                    setPassword(t);
                    setError(null);
                  }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect={false}
                  textContentType="password"
                  editable={!busy}
                  onSubmitEditing={handleEmail}
                  returnKeyType="go"
                />
                <Pressable
                  hitSlop={10}
                  onPress={() => setShowPassword((v) => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? '隐藏密码' : '显示密码'}
                  style={styles.eyeBtn}
                >
                  <SymbolView name={showPassword ? 'eye.slash' : 'eye'} tintColor={palette.textSecondary} size={20} />
                </Pressable>
              </View>

              {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

              <Pressable
                onPress={handleEmail}
                disabled={!canSubmit}
                style={[styles.primary, { backgroundColor: palette.accent, opacity: canSubmit ? 1 : 0.35 }]}
              >
                {busy ? (
                  <ActivityIndicator color={palette.onAccent} />
                ) : (
                  <Text style={[styles.primaryText, { color: palette.onAccent }]}>登录 / 注册</Text>
                )}
              </Pressable>

              <Text style={[styles.hint, { color: palette.textTertiary }]}>未注册的邮箱将自动创建账号</Text>
            </View>

            {/* Apple 登录（iOS 且设备支持） */}
            {appleAvailable ? (
              <View style={styles.appleWrap}>
                <View style={styles.dividerRow}>
                  <View style={[styles.dividerLine, { backgroundColor: palette.separator }]} />
                  <Text style={[styles.dividerText, { color: palette.textTertiary }]}>或</Text>
                  <View style={[styles.dividerLine, { backgroundColor: palette.separator }]} />
                </View>
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={
                    palette.base === '#000000'
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={Radius.md}
                  style={styles.appleButton}
                  onPress={handleApple}
                />
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 },
  flex: { flex: 1 },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: Space[6], gap: Space[10] },
  brand: { alignItems: 'center', gap: Space[2] },
  logo: { fontSize: 40, fontWeight: '700' },
  tagline: { fontSize: 15 },
  form: { gap: Space[3] },
  input: { height: 50, borderRadius: Radius.md, paddingHorizontal: Space[4], fontSize: 16 },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
  },
  passwordInput: { flex: 1, fontSize: 16, paddingVertical: 0 },
  eyeBtn: { paddingLeft: Space[2], height: '100%', justifyContent: 'center' },
  error: { fontSize: 13, paddingHorizontal: Space[1] },
  primary: { height: 50, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center', marginTop: Space[1] },
  primaryText: { fontSize: 17, fontWeight: '600' },
  hint: { fontSize: 12, textAlign: 'center' },
  appleWrap: { gap: Space[5] },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 13 },
  appleButton: { height: 50, width: '100%' },
});
