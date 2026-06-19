/**
 * 扫码加入（流程 4）：相机扫邀请二维码加入家庭，并提供「手动输入邀请码」兜底
 *（模拟器无相机时用手动输入；二维码内容即邀请码原文，见 invite-sheet）。
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useJoinFamily } from '@/api';
import { Radius, Space, usePalette } from '@/constants/design';

export function ScanSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <ScanBody onClose={onClose} /> : null}
    </Modal>
  );
}

function ScanBody({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const [permission, requestPermission] = useCameraPermissions();
  const joinM = useJoinFamily();
  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const handledRef = useRef(false);

  const join = async (raw: string) => {
    const c = raw.trim().toUpperCase();
    if (!c) return;
    setError(null);
    try {
      await joinM.mutateAsync(c);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? String(e));
      handledRef.current = false; // 允许再次扫描/提交
    }
  };

  const onScan = (data: string) => {
    if (handledRef.current || joinM.isPending) return;
    handledRef.current = true;
    join(data);
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.topBar}>
          <Text style={[styles.title, { color: palette.textPrimary }]}>加入家庭</Text>
          <Pressable hitSlop={8} onPress={onClose}>
            <Text style={[styles.action, { color: palette.textSecondary }]}>取消</Text>
          </Pressable>
        </View>

        {manual ? (
          <View style={styles.manualWrap}>
            <Text style={[styles.label, { color: palette.textSecondary }]}>输入家人给你的邀请码</Text>
            <TextInput
              style={[styles.input, { backgroundColor: palette.card, color: palette.textPrimary }]}
              placeholder="如 A1B2C3D4"
              placeholderTextColor={palette.textTertiary}
              value={code}
              onChangeText={(t) => {
                setCode(t);
                setError(null);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              returnKeyType="go"
              onSubmitEditing={() => join(code)}
            />
            {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
            <Pressable
              onPress={() => join(code)}
              disabled={code.trim().length === 0 || joinM.isPending}
              style={[
                styles.primary,
                { backgroundColor: palette.accent, opacity: code.trim().length === 0 || joinM.isPending ? 0.35 : 1 },
              ]}
            >
              {joinM.isPending ? (
                <ActivityIndicator color={palette.onAccent} />
              ) : (
                <Text style={[styles.primaryText, { color: palette.onAccent }]}>加入</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setManual(false)} hitSlop={8} style={styles.switchBtn}>
              <Text style={{ color: palette.info, fontSize: 15 }}>改用扫码</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.scanWrap}>
            {permission?.granted ? (
              <View style={styles.cameraBox}>
                <CameraView
                  style={StyleSheet.absoluteFill}
                  facing="back"
                  barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                  onBarcodeScanned={(r) => onScan(r.data)}
                />
                {joinM.isPending ? (
                  <View style={styles.scanOverlay}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.permWrap}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>扫码需要相机权限</Text>
                <Pressable onPress={requestPermission} style={[styles.primary, { backgroundColor: palette.accent }]}>
                  <Text style={[styles.primaryText, { color: palette.onAccent }]}>开启相机</Text>
                </Pressable>
              </View>
            )}
            {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
            <Pressable onPress={() => setManual(true)} hitSlop={8} style={styles.switchBtn}>
              <Text style={{ color: palette.info, fontSize: 15 }}>手动输入邀请码</Text>
            </Pressable>
          </View>
        )}
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
  scanWrap: { flex: 1, alignItems: 'center', gap: Space[4], paddingHorizontal: Space[6], paddingTop: Space[4] },
  cameraBox: { width: '100%', aspectRatio: 1, borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: '#000' },
  scanOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permWrap: { alignItems: 'center', gap: Space[4], paddingTop: Space[10] },
  manualWrap: { paddingHorizontal: Space[6], paddingTop: Space[6], gap: Space[3] },
  label: { fontSize: 14, textAlign: 'center' },
  input: {
    height: 50,
    borderRadius: Radius.md,
    paddingHorizontal: Space[4],
    fontSize: 18,
    letterSpacing: 2,
    textAlign: 'center',
  },
  error: { fontSize: 13, textAlign: 'center' },
  primary: {
    height: 50,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Space[8],
  },
  primaryText: { fontSize: 17, fontWeight: '600' },
  switchBtn: { alignSelf: 'center', paddingVertical: Space[2] },
});
