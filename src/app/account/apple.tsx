/**
 * G6 Apple 管理小页（绑定 / 解绑）。已登录用户把 Apple 身份挂到当前账号（账号合并，TECH §7.3）。
 * 绑定：原生 Apple 弹窗取 identityToken → linkIdentity 传 token（免浏览器 OAuth），成功后 session 自动刷新。
 * 解绑：unlinkIdentity；GoTrue 拦截「唯一登录方式」的解绑，UI 兜底提示先绑手机号 / 邮箱。
 * 视觉沿用登录页 Apple 说明的好处三条 + Apple 品牌反色按钮（浅色黑底白字 / 深色白底黑字）。
 * 仅 iOS 支持；非 iOS 显示不可用提示。需后端已配置 Apple provider 且开启 Manual Linking。
 */
import { Stack } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Toast } from '@/components/toast';
import { Radius, Space, usePalette } from '@/constants/design';
import { bindApple, unbindApple, useSession } from '@/lib/auth';

/**
 * 绑定 / 解绑错误 → 友好文案：
 * - 唯一登录方式不可解绑（single_identity_not_deletable）→ 引导先绑其它方式；
 * - Apple 已被占用（identity_already_exists）→ 提示换账号；
 * - 未开启账号关联（manual_linking_disabled）→ 稍后再试；
 * - 网络异常 → 稍后重试；其余 → 原始 message 兜底。
 */
function appleErrorText(err: unknown): string {
  const e = err as { status?: number; message?: string; name?: string; code?: string };
  const msg = (e?.message ?? '').toLowerCase();
  if (e?.code === 'single_identity_not_deletable' || msg.includes('single identity')) {
    return 'Apple 是当前唯一登录方式，不可解绑；请先绑定手机号或邮箱';
  }
  if (e?.code === 'identity_already_exists' || msg.includes('already') || msg.includes('linked')) {
    return '该 Apple 账号已绑定到其他账号';
  }
  if (e?.code === 'manual_linking_disabled' || msg.includes('manual linking')) {
    return '账号关联暂不可用，请稍后再试';
  }
  const down =
    e?.status === 0 ||
    e?.name === 'AuthRetryableFetchError' ||
    msg.includes('network request failed') ||
    msg.includes('failed to fetch');
  if (down) return '网络异常，请稍后重试';
  return e?.message ?? String(err);
}

export default function AppleScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const { session } = useSession();

  const appleIdentity = session?.user.identities?.find((i) => i.provider === 'apple');
  const hasApple = !!appleIdentity;
  const appleEmail = (appleIdentity?.identity_data?.email as string | undefined) ?? null;
  const supported = Platform.OS === 'ios';

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const onBind = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await bindApple();
      if (ok) setToast('Apple 绑定成功');
    } catch (err) {
      setToast(appleErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const onUnbind = () => {
    Alert.alert('解绑 Apple', '解绑后将无法再用 Apple 登录家账。确定要解绑吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '解绑',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await unbindApple();
            setToast('已解绑 Apple');
          } catch (err) {
            setToast(appleErrorText(err));
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <Stack.Screen options={{ headerShown: true, title: 'Apple' }} />
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Space[6] }]}
      >
        {/* 品牌头 + 状态 */}
        <View style={styles.brand}>
          <SymbolView name="apple.logo" tintColor={palette.textPrimary} size={44} />
          <Text style={[styles.title, { color: palette.textPrimary }]}>通过 Apple 登录</Text>
          <View style={[styles.statusPill, { backgroundColor: palette.cardPill }]}>
            <SymbolView
              name={hasApple ? 'checkmark.circle.fill' : 'circle'}
              tintColor={hasApple ? palette.expense : palette.textTertiary}
              size={14}
            />
            <Text style={[styles.statusText, { color: hasApple ? palette.textPrimary : palette.textSecondary }]}>
              {hasApple ? (appleEmail ? `已连接 · ${appleEmail}` : '已连接') : '未连接'}
            </Text>
          </View>
        </View>

        {/* 好处说明 */}
        <View style={[styles.card, { backgroundColor: palette.card }]}>
          <AppleBenefit
            palette={palette}
            icon="checkmark.shield"
            title="快速、安全、保护隐私"
            text="使用你已有的 Apple 账号登录，无需创建新账号，App 不会获取你的密码。"
          />
          <View style={[styles.divider, { backgroundColor: palette.separator }]} />
          <AppleBenefit
            palette={palette}
            icon="person"
            title="仅分享必要信息"
            text="你可选择分享姓名和电子邮件，App 将严格保护你的隐私。"
          />
          <View style={[styles.divider, { backgroundColor: palette.separator }]} />
          <AppleBenefit
            palette={palette}
            icon="key"
            title="在设备间轻松登录"
            text="使用 iCloud 钥匙串，帮你在所有 Apple 设备上自动登录。"
          />
        </View>

        {/* 主操作 */}
        {!supported ? (
          <Text style={[styles.hint, { color: palette.textTertiary, textAlign: 'center' }]}>
            Apple 登录仅在 iOS 设备上可用。
          </Text>
        ) : hasApple ? (
          <>
            <Pressable
              onPress={onUnbind}
              disabled={busy}
              style={[styles.unbind, { borderColor: palette.separator, opacity: busy ? 0.6 : 1 }]}
            >
              {busy ? (
                <ActivityIndicator color={palette.danger} />
              ) : (
                <Text style={[styles.unbindText, { color: palette.danger }]}>解绑 Apple</Text>
              )}
            </Pressable>
            <Text style={[styles.hint, { color: palette.textTertiary }]}>
              解绑前请确保已绑定手机号或邮箱，账号需至少保留一种登录方式。
            </Text>
          </>
        ) : (
          <>
            {/* Apple 品牌反色按钮：浅色黑底白字 / 深色白底黑字 */}
            <Pressable
              onPress={onBind}
              disabled={busy}
              style={[styles.appleBtn, { backgroundColor: palette.textPrimary, opacity: busy ? 0.6 : 1 }]}
            >
              {busy ? (
                <ActivityIndicator color={palette.base} />
              ) : (
                <>
                  <SymbolView name="apple.logo" tintColor={palette.base} size={18} />
                  <Text style={[styles.appleBtnText, { color: palette.base }]}>通过 Apple 绑定</Text>
                </>
              )}
            </Pressable>
            <Text style={[styles.hint, { color: palette.textTertiary }]}>
              绑定后可用 Apple 一键登录家账；App 不会获取你的密码。
            </Text>
          </>
        )}
      </ScrollView>
      <Toast visible={!!toast} text={toast ?? ''} onHide={() => setToast(null)} />
    </View>
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
        <SymbolView name={icon} tintColor={palette.textSecondary} size={22} />
      </View>
      <View style={styles.benefitText}>
        <Text style={[styles.benefitTitle, { color: palette.textPrimary }]}>{title}</Text>
        <Text style={[styles.benefitBody, { color: palette.textSecondary }]}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: Space[4], gap: Space[4] },

  brand: { alignItems: 'center', gap: Space[2], paddingTop: Space[4] },
  title: { fontSize: 22, fontWeight: '600' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[1],
    paddingHorizontal: Space[3],
    paddingVertical: Space[1],
    borderRadius: Radius.full,
    marginTop: Space[1],
  },
  statusText: { fontSize: 13, fontWeight: '500' },

  card: {
    borderRadius: Radius.lg,
    paddingHorizontal: Space[4],
    paddingVertical: Space[2],
  },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 40 + Space[4] },
  benefitRow: { flexDirection: 'row', gap: Space[4], alignItems: 'center', paddingVertical: Space[3] },
  benefitIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  benefitText: { flex: 1, gap: Space[1] },
  benefitTitle: { fontSize: 14, fontWeight: '500' },
  benefitBody: { fontSize: 12, lineHeight: 17 },

  appleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[2],
    height: 52,
    borderRadius: Radius.full,
    marginTop: Space[2],
  },
  appleBtnText: { fontSize: 17, fontWeight: '600' },

  unbind: {
    height: 52,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Space[2],
  },
  unbindText: { fontSize: 17, fontWeight: '600' },

  hint: { fontSize: 12, lineHeight: 16, textAlign: 'center', paddingHorizontal: Space[2] },
});
