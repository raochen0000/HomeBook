/**
 * 邀请家人（流程 3）：户主生成邀请码 → 展示二维码 + 文字码，可刷新换新码。
 * 二维码内容 = 邀请码原文，与「扫码加入」「手动输入」三者同源（scan-sheet）。
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createInvitation, type Invitation } from '@/api';
import { Radius, Space, usePalette } from '@/constants/design';

export function InviteSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <InviteBody onClose={onClose} /> : null}
    </Modal>
  );
}

function InviteBody({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const [inv, setInv] = useState<Invitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const refresh = () => {
    setLoading(true);
    setError(null);
    createInvitation(true)
      .then(setInv)
      .catch((e) => setError((e as Error).message ?? String(e)))
      .finally(() => setLoading(false));
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
              <Text style={[styles.hint, { color: palette.textSecondary }]}>让家人扫码，或输入下方邀请码加入</Text>
              <View style={[styles.qrCard, { backgroundColor: '#FFFFFF' }]}>
                <QRCode value={inv.code} size={208} color="#1C1C1E" backgroundColor="#FFFFFF" />
              </View>
              <Text style={[styles.code, { color: palette.textPrimary }]}>{inv.code}</Text>
              <Text style={[styles.expiry, { color: palette.textTertiary }]}>邀请码 24 小时内有效</Text>
              <Pressable onPress={refresh} style={[styles.refresh, { borderColor: palette.separator }]}>
                <Text style={{ color: palette.textPrimary, fontSize: 15 }}>刷新邀请码</Text>
              </Pressable>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[4], paddingHorizontal: Space[6] },
  hint: { fontSize: 14, textAlign: 'center' },
  qrCard: { padding: Space[4], borderRadius: Radius.lg },
  code: { fontSize: 30, fontWeight: '700', letterSpacing: 4, fontVariant: ['tabular-nums'] },
  expiry: { fontSize: 12 },
  error: { fontSize: 14, textAlign: 'center' },
  refresh: {
    marginTop: Space[2],
    paddingVertical: Space[3],
    paddingHorizontal: Space[6],
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
