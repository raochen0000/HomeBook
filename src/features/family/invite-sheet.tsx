/**
 * 邀请家人（流程 3）：户主生成 6 位邀请码 → 展示家庭信息 + 二维码 + 3+3 分段文字码 + 有效期倒计时。
 * 支持：一键复制（已复制反馈态）、保存二维码到相册、刷新换新码。
 * 二维码内容 = 邀请码原文，与「扫码加入」「手动输入」三者同源（scan-sheet）。
 */
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createInvitation, type Invitation, useMyFamily, useMyProfile } from '@/api';
import { Radius, Space, usePalette } from '@/constants/design';

/** react-native-qrcode-svg 的 ref 暴露 toDataURL（回调返回 base64 PNG，无 data: 前缀）。 */
type QRRef = { toDataURL: (cb: (data: string) => void) => void };

export function InviteSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <InviteBody onClose={onClose} /> : null}
    </Modal>
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

function InviteBody({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
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
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
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
        const perm = await MediaLibrary.requestPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('需要相册权限', '请在系统设置中允许「家账」保存照片后重试。');
          return;
        }
        const base64 = data.replace(/\s/g, '');
        const uri = `${FileSystem.cacheDirectory}invite-${inv.code}.png`;
        await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
        await MediaLibrary.saveToLibraryAsync(uri);
        Alert.alert('已保存', '邀请二维码已保存到相册。');
      } catch (e) {
        Alert.alert('保存失败', (e as Error).message ?? String(e));
      } finally {
        setSaving(false);
      }
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>邀请家人</Text>
          <Pressable hitSlop={8} onPress={onClose}>
            <Text style={[styles.action, { color: palette.textSecondary }]}>完成</Text>
          </Pressable>
        </View>

        <View style={styles.center}>
          {loading ? (
            <ActivityIndicator />
          ) : error ? (
            <Text style={[styles.error, { color: palette.danger }]}>{error}</Text>
          ) : inv ? (
            <>
              {/* 家庭信息 */}
              <Text style={[styles.familyName, { color: palette.textPrimary }]}>{familyQ.data?.name ?? '我的家'}</Text>
              <Text style={[styles.owner, { color: palette.textSecondary }]}>
                户主 · {profileQ.data?.nickname ?? '我'}
              </Text>

              <Text style={[styles.hint, { color: palette.textSecondary }]}>让家人扫码，或输入下方邀请码加入</Text>

              <View style={[styles.qrCard, { backgroundColor: '#FFFFFF' }]}>
                <QRCode
                  value={inv.code}
                  size={208}
                  color="#1C1C1E"
                  backgroundColor="#FFFFFF"
                  getRef={(c) => {
                    qrRef.current = c as unknown as QRRef;
                  }}
                />
              </View>

              {/* 3+3 分段文字码 */}
              <Text style={[styles.code, { color: palette.textPrimary }]}>{splitCode(inv.code)}</Text>

              {/* 有效期倒计时 */}
              <Text style={[styles.expiry, { color: expired ? palette.danger : palette.textTertiary }]}>
                {expired ? '邀请码已过期，请刷新' : `${fmtRemain(remainMs)} 后失效`}
              </Text>

              {/* 一键复制 */}
              <Pressable
                onPress={onCopy}
                disabled={expired}
                style={[styles.copyBtn, { backgroundColor: palette.accent, opacity: expired ? 0.35 : 1 }]}
              >
                <Text style={[styles.copyText, { color: palette.onAccent }]}>{copied ? '已复制 ✓' : '复制邀请码'}</Text>
              </Pressable>

              {/* 存图 + 刷新 */}
              <View style={styles.secondaryRow}>
                <Pressable
                  onPress={onSave}
                  disabled={expired || saving}
                  style={[styles.ghostBtn, { borderColor: palette.separator, opacity: expired ? 0.35 : 1 }]}
                >
                  {saving ? (
                    <ActivityIndicator />
                  ) : (
                    <Text style={{ color: palette.textPrimary, fontSize: 15 }}>保存二维码</Text>
                  )}
                </Pressable>
                <Pressable onPress={refresh} style={[styles.ghostBtn, { borderColor: palette.separator }]}>
                  <Text style={{ color: palette.textPrimary, fontSize: 15 }}>刷新邀请码</Text>
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
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
  },
  title: { fontSize: 20, fontWeight: '700' },
  action: { fontSize: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[3], paddingHorizontal: Space[6] },
  familyName: { fontSize: 22, fontWeight: '700', textAlign: 'center' },
  owner: { fontSize: 14, marginTop: -Space[1] },
  hint: { fontSize: 14, textAlign: 'center', marginTop: Space[2] },
  qrCard: { padding: Space[4], borderRadius: Radius.lg },
  code: { fontSize: 32, fontWeight: '700', letterSpacing: 6, fontVariant: ['tabular-nums'] },
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
  secondaryRow: { flexDirection: 'row', gap: Space[3], alignSelf: 'stretch' },
  ghostBtn: {
    flex: 1,
    height: 46,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
