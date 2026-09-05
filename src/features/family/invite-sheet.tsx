/**
 * 邀请家人（流程 3）：户主生成 6 位邀请码 → 展示家庭信息 + 二维码 + 3+3 分段文字码 + 有效期倒计时。
 * 支持：一键复制（已复制反馈态）、保存二维码到相册、刷新换新码。
 * 二维码内容 = 邀请码原文，与「扫码加入」「手动输入」三者同源（scan-sheet）。
 */
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { createInvitation, type Invitation, useMyFamily, useMyProfile } from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { SheetHeader } from '@/components/sheet-header';
import { Radius, Space, useSheetPalette } from '@/constants/design';
import { alertOk, t, useLocalePreference } from '@/i18n';

import { InvitationQrCode } from './invitation-qr-code';

/** SVG ref 暴露 toDataURL（回调返回 base64 PNG，无 data: 前缀）。 */
type QRRef = { toDataURL: (cb: (data: string) => void) => void };

export function InviteSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <PageSheet visible={visible} onClose={onClose}>
      <InviteBody />
    </PageSheet>
  );
}

/** 邀请码 3+3 分段展示（6 位 → 「ABC DEF」；兼容历史长度，按中点二分）。 */
function splitCode(code: string): string {
  const mid = Math.ceil(code.length / 2);
  return `${code.slice(0, mid)} ${code.slice(mid)}`;
}

/** 毫秒 → HH:MM:SS。 */
function fmtRemain(ms: number): string {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(hh)}:${p(mm)}:${p(ss)}`;
}

function InviteBody() {
  const palette = useSheetPalette();
  useLocalePreference();
  const familyQ = useMyFamily();
  const profileQ = useMyProfile();
  const [inv, setInv] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const qrRef = useRef<QRRef | null>(null);

  // 打开即复用当前有效码（force=false）。本体随每次打开重新挂载。
  useEffect(() => {
    let alive = true;
    createInvitation(false)
      .then((i) => alive && setInv(i))
      .catch((e) => alive && setError((e as Error).message ?? String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  // 每秒推进，用于有效期倒计时。
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refresh = () => {
    setLoading(true);
    setError(null);
    setCopied(false);
    createInvitation(true)
      .then(setInv)
      .catch((e) => setError((e as Error).message ?? String(e)))
      .finally(() => setLoading(false));
  };

  const remainMs = inv ? Math.max(0, new Date(inv.expires_at).getTime() - nowMs) : 0;
  const expired = inv != null && remainMs <= 0;

  // 复制纯 6 位码（不含分段空格）。
  const onCopy = async () => {
    if (!inv) return;
    await Clipboard.setStringAsync(inv.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // 导出二维码 PNG → 写临时文件 → 存相册。
  const onSave = () => {
    if (!inv || !qrRef.current || saving) return;
    setSaving(true);
    qrRef.current.toDataURL(async (data) => {
      try {
        // 仅保存新生成的图片，不读取用户现有相册内容。
        const perm = await MediaLibrary.requestPermissionsAsync(true);
        if (!perm.granted) {
          Alert.alert(t('invite.albumPermission'), t('invite.albumPermissionBody'), alertOk());
          return;
        }
        const base64 = data.replace(/\s/g, '');
        const uri = `${FileSystem.cacheDirectory}HomeBook-邀请二维码-${inv.code}.png`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        await MediaLibrary.Asset.create(uri);
        Alert.alert(t('invite.saved'), t('invite.qrSaved'), alertOk());
      } catch (e) {
        Alert.alert(t('account.saveFailed'), (e as Error).message ?? String(e), alertOk());
      } finally {
        setSaving(false);
      }
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        {/* 悬浮磨砂标题区（纯预览型：纯标题，DESIGN §9.9）；关闭靠下滑手势 */}
        <SheetHeader title={t('family.invite')} />

        <View style={styles.center}>
          {loading ? (
            <ActivityIndicator />
          ) : error ? (
            <Text style={[styles.error, { color: palette.danger }]}>{error}</Text>
          ) : inv ? (
            <>
              {/* 家庭信息 */}
              <Text style={[styles.familyName, { color: palette.textPrimary }]}>
                {familyQ.data?.name ?? t('home.myHome')}
              </Text>
              <Text style={[styles.owner, { color: palette.textSecondary }]}>
                {t('invite.ownerMe', { name: profileQ.data?.nickname ?? t('common.me') })}
              </Text>

              <Text style={[styles.hint, { color: palette.textSecondary }]}>{t('invite.scanHint')}</Text>

              <View style={[styles.qrCard, { backgroundColor: '#FFFFFF' }]}>
                <InvitationQrCode
                  value={inv.code}
                  size={176}
                  logo={require('@/assets/images/app-symbol.png')}
                  logoSize={30}
                  logoMargin={4}
                  logoBorderRadius={8}
                  getRef={(c) => {
                    qrRef.current = c;
                  }}
                />
              </View>

              {/* 3+3 分段文字码 */}
              <Text selectable style={[styles.code, { color: palette.textPrimary }]}>
                {splitCode(inv.code)}
              </Text>

              {/* 有效期倒计时 */}
              <Text style={[styles.expiry, { color: expired ? palette.danger : palette.textTertiary }]}>
                {expired ? t('invite.expiredRefresh') : t('invite.expiresIn', { time: fmtRemain(remainMs) })}
              </Text>

              {/* 一键复制 */}
              <Pressable
                onPress={onCopy}
                disabled={expired}
                style={[styles.copyBtn, { backgroundColor: palette.ink, opacity: expired ? 0.35 : 1 }]}
              >
                <Text style={[styles.copyText, { color: palette.onInk }]}>
                  {copied ? t('invite.copied') : t('invite.copyCode')}
                </Text>
              </Pressable>

              {/* 存图 + 刷新 */}
              <View style={styles.secondaryRow}>
                <Pressable
                  accessibilityLabel={t('invite.saveQr')}
                  accessibilityRole="button"
                  onPress={onSave}
                  disabled={expired || saving}
                  style={({ pressed }) => [styles.secondaryAction, { opacity: expired ? 0.35 : pressed ? 0.7 : 1 }]}
                >
                  <View style={[styles.secondaryIcon, { backgroundColor: palette.cardPill }]}>
                    {saving ? (
                      <ActivityIndicator />
                    ) : (
                      <SymbolView name="square.and.arrow.down" tintColor={palette.textPrimary} size={21} />
                    )}
                  </View>
                  <Text style={[styles.secondaryLabel, { color: palette.textPrimary }]}>{t('invite.saveQr')}</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel={t('invite.refresh')}
                  accessibilityRole="button"
                  onPress={refresh}
                  style={({ pressed }) => [styles.secondaryAction, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <View style={[styles.secondaryIcon, { backgroundColor: palette.cardPill }]}>
                    <SymbolView name="arrow.clockwise" tintColor={palette.textPrimary} size={21} />
                  </View>
                  <Text style={[styles.secondaryLabel, { color: palette.textPrimary }]}>{t('invite.refresh')}</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[6],
    paddingTop: Space[5],
    paddingBottom: Space[4],
  },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  action: { fontSize: 16 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[3],
    paddingHorizontal: Space[6],
  },
  familyName: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  owner: { fontSize: 14, marginTop: -Space[1] },
  hint: { fontSize: 14, textAlign: 'center', marginTop: Space[2] },
  qrCard: { padding: Space[2], borderRadius: Radius.lg, overflow: 'hidden' },
  code: { fontSize: 30, fontWeight: '700', letterSpacing: 7, fontVariant: ['tabular-nums'] },
  expiry: { fontSize: 13, fontVariant: ['tabular-nums'] },
  error: { fontSize: 14, textAlign: 'center' },
  copyBtn: {
    marginTop: Space[2],
    height: 48,
    alignSelf: 'stretch',
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyText: { fontSize: 16, fontWeight: '600' },
  secondaryRow: { flexDirection: 'row', justifyContent: 'center', gap: Space[10], alignSelf: 'stretch' },
  secondaryAction: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Space[2],
  },
  secondaryIcon: { width: 46, height: 46, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  secondaryLabel: { fontSize: 14, fontWeight: '500' },
});
