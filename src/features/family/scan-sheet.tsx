/**
 * 加入家庭（流程 4）：扫码 / 手输邀请码 → 先拉「家庭预览卡 + 加入影响」，确认后才真正加入。
 *（模拟器无相机时用手动输入；二维码内容即邀请码原文，见 invite-sheet。）
 *
 * 两阶段：
 *   input   ── 扫码 / 手输 → previewFamilyByCode → ok 则进 preview，异常态就地提示
 *   preview ── 渲染封面/家庭名/户主/成员堆叠/X·5 人 + 影响提示；按 impact 决定加入按钮行为
 *
 * 加入影响（PRD §6.3，由 RPC 的 impact 决定）：
 *   none          直接加入
 *   delete_origin 点加入 → 二次确认（原家庭+数据将删除）→ 加入
 *   auto_leave    点加入 → 直接加入（卡内已提示将自动退出当前家庭）
 *   blocked_owner 加入按钮禁用，引导先转让 / 解散
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type FamilyPreview, type JoinImpact, useJoinFamily, usePreviewFamily } from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { Radius, Space, useAvatarTints, usePalette, useSheetPalette } from '@/constants/design';
import { MAX_FAMILY_MEMBERS } from '@/constants/family';
import { t, useLocalePreference } from '@/i18n';

/** 邀请码异常态 → 人话提示（status=ok 不在此列）。 */
function statusMessage(status: Exclude<FamilyPreview['status'], 'ok'>): string {
  switch (status) {
    case 'invalid':
      return t('invite.invalid');
    case 'expired':
      return t('invite.expired');
    case 'full':
      return t('invite.full', { max: MAX_FAMILY_MEMBERS });
    case 'already_member':
      return t('invite.already');
    default:
      return t('invite.cannotJoin');
  }
}

export function ScanSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <PageSheet visible={visible} onClose={onClose}>
      <ScanBody onClose={onClose} />
    </PageSheet>
  );
}

function ScanBody({ onClose }: { onClose: () => void }) {
  const palette = useSheetPalette();
  useLocalePreference();
  const [permission, requestPermission] = useCameraPermissions();
  const previewM = usePreviewFamily();
  const joinM = useJoinFamily();

  const [manual, setManual] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  // 预览成功后驻留的家庭信息 + 对应邀请码（加入时复用同一码）
  const [preview, setPreview] = useState<FamilyPreview | null>(null);
  const [previewCode, setPreviewCode] = useState('');
  const handledRef = useRef(false);

  const busy = previewM.isPending || joinM.isPending;

  /** 扫码 / 手输 → 拉预览。ok 进预览卡，异常态就地提示。 */
  const runPreview = async (raw: string) => {
    const c = raw.trim().toUpperCase();
    if (!c) return;
    setError(null);
    try {
      const result = await previewM.mutateAsync(c);
      if (result.status === 'ok' && result.family) {
        setPreviewCode(c);
        setPreview(result);
      } else {
        setError(
          result.status === 'ok'
            ? t('invite.cannotJoin')
            : statusMessage(result.status as Exclude<FamilyPreview['status'], 'ok'>),
        );
        handledRef.current = false; // 允许重扫 / 重提交
      }
    } catch (e) {
      setError((e as Error).message ?? String(e));
      handledRef.current = false;
    }
  };

  const onScan = (data: string) => {
    if (handledRef.current || busy || preview) return;
    handledRef.current = true;
    void runPreview(data);
  };

  /** 真正执行加入；delete_origin 先二次确认。 */
  const doJoin = async () => {
    try {
      await joinM.mutateAsync(previewCode);
      onClose();
    } catch (e) {
      setError((e as Error).message ?? String(e));
    }
  };

  const confirmJoin = (impact: JoinImpact | undefined) => {
    if (impact === 'blocked_owner') return; // 按钮本应禁用，双保险
    if (impact === 'delete_origin') {
      Alert.alert(t('invite.soloWipeTitle'), t('invite.soloWipeBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('invite.confirmJoin'), style: 'destructive', onPress: () => void doJoin() },
      ]);
      return;
    }
    void doJoin(); // none / auto_leave 直接加入
  };

  /** 从预览卡返回输入态，清掉上次结果（PRD：改动即清除旧预览）。 */
  const backToInput = () => {
    setPreview(null);
    setPreviewCode('');
    setError(null);
    handledRef.current = false;
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        {/* 悬浮磨砂标题区（DESIGN §9.9）：预览子状态显示返回；关闭靠下滑手势 */}
        <SheetHeader title={t('family.join')} onBack={preview ? backToInput : undefined} />
        {/* 内容非滚动，用占位撑开标题区高度 */}
        <View style={styles.headerSpacer} />

        {preview?.family ? (
          <PreviewCard
            preview={preview}
            joining={joinM.isPending}
            error={error}
            onJoin={() => confirmJoin(preview.impact)}
          />
        ) : manual ? (
          <View style={styles.manualWrap}>
            <Text style={[styles.label, { color: palette.textSecondary }]}>{t('invite.enterCode')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: palette.card, color: palette.textPrimary }]}
              placeholder={t('invite.codePlaceholder')}
              placeholderTextColor={palette.textTertiary}
              value={code}
              onChangeText={(txn) => {
                setCode(txn);
                setError(null);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={8}
              returnKeyType="go"
              editable={!busy}
              onSubmitEditing={() => void runPreview(code)}
            />
            {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
            <Pressable
              onPress={() => void runPreview(code)}
              disabled={code.trim().length === 0 || busy}
              style={[
                styles.primary,
                { backgroundColor: palette.ink, opacity: code.trim().length === 0 || busy ? 0.35 : 1 },
              ]}
            >
              {previewM.isPending ? (
                <ActivityIndicator color={palette.onInk} />
              ) : (
                <Text style={[styles.primaryText, { color: palette.onInk }]}>{t('invite.next')}</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setManual(false)} hitSlop={8} style={styles.switchBtn} disabled={busy}>
              <Text style={{ color: palette.info, fontSize: 15 }}>{t('invite.useScan')}</Text>
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
                {previewM.isPending ? (
                  <View style={styles.scanOverlay}>
                    <ActivityIndicator color="#FFFFFF" />
                  </View>
                ) : null}
              </View>
            ) : (
              <View style={styles.permWrap}>
                <Text style={[styles.label, { color: palette.textSecondary }]}>{t('invite.cameraPermission')}</Text>
                <Pressable onPress={requestPermission} style={[styles.primary, { backgroundColor: palette.ink }]}>
                  <Text style={[styles.primaryText, { color: palette.onInk }]}>{t('invite.enableCamera')}</Text>
                </Pressable>
              </View>
            )}
            {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
            <Pressable onPress={() => setManual(true)} hitSlop={8} style={styles.switchBtn}>
              <Text style={{ color: palette.info, fontSize: 15 }}>{t('invite.enterManually')}</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

/** 加入影响 → 卡内提示文案 + 语义色。none 无提示。 */
function impactBanner(impact: JoinImpact | undefined): { text: string; danger?: boolean } | null {
  switch (impact) {
    case 'delete_origin':
      return { text: t('invite.wipeWarn') };
    case 'auto_leave':
      return { text: t('invite.leaveWarn') };
    case 'blocked_owner':
      return { text: t('invite.ownerBlock'), danger: true };
    default:
      return null;
  }
}

function PreviewCard({
  preview,
  joining,
  error,
  onJoin,
}: {
  preview: FamilyPreview;
  joining: boolean;
  error: string | null;
  onJoin: () => void;
}) {
  const palette = useSheetPalette();
  useLocalePreference();
  const avatarTints = useAvatarTints();
  const family = preview.family!;
  const banner = impactBanner(preview.impact);
  const blocked = preview.impact === 'blocked_owner';

  return (
    <ScrollView contentContainerStyle={styles.previewWrap} keyboardShouldPersistTaps="handled">
      {/* 封面 */}
      <View style={[styles.cover, { backgroundColor: palette.card }]}>
        {family.cover_url ? (
          <Image source={family.cover_url} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} />
        ) : (
          <Text style={[styles.coverPlaceholder, { color: palette.textTertiary }]}>{family.name.slice(0, 1)}</Text>
        )}
        {family.avatar_url ? (
          <Image source={family.avatar_url} style={styles.familyAvatar} contentFit="cover" transition={120} />
        ) : (
          <View style={[styles.familyAvatar, styles.avatarFallback, { backgroundColor: palette.accent }]}>
            <Text style={[styles.familyAvatarText, { color: palette.onAccent }]}>{family.name.slice(0, 1)}</Text>
          </View>
        )}
      </View>

      <Text style={[styles.familyName, { color: palette.textPrimary }]}>{family.name}</Text>
      <Text style={[styles.familySlogan, { color: palette.textSecondary }]}>{family.slogan}</Text>

      {/* 户主 */}
      <View style={styles.ownerRow}>
        <Avatar
          url={family.owner.avatar_url}
          label={family.owner.nickname.slice(0, 1)}
          tint={avatarTints[0]}
          size={28}
        />
        <Text style={[styles.ownerText, { color: palette.textSecondary }]}>
          {t('invite.ownerMe', { name: family.owner.nickname })}
        </Text>
      </View>

      {/* 成员头像堆叠 + 人数 */}
      <View style={styles.memberRow}>
        <View style={styles.stack}>
          {family.member_avatars.slice(0, MAX_FAMILY_MEMBERS).map((url, i) => (
            <View key={i} style={[styles.stackItem, { marginLeft: i === 0 ? 0 : -10, borderColor: palette.base }]}>
              <Avatar url={url} label="" tint={avatarTints[i % avatarTints.length]} size={32} />
            </View>
          ))}
        </View>
        <Text style={[styles.memberCount, { color: palette.textSecondary }]}>
          {t('invite.peopleCount', { count: family.member_count, max: family.max_members })}
        </Text>
      </View>

      {/* 加入影响 */}
      {banner ? (
        <View style={[styles.banner, { backgroundColor: palette.card }]}>
          <Text style={[styles.bannerText, { color: banner.danger ? palette.danger : palette.warning }]}>
            {banner.text}
          </Text>
        </View>
      ) : null}

      {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

      <Pressable
        onPress={onJoin}
        disabled={blocked || joining}
        style={[
          styles.primary,
          styles.joinBtn,
          { backgroundColor: palette.ink, opacity: blocked || joining ? 0.35 : 1 },
        ]}
      >
        {joining ? (
          <ActivityIndicator color={palette.onInk} />
        ) : (
          <Text style={[styles.primaryText, { color: palette.onInk }]}>
            {blocked ? t('invite.cannotJoinBtn') : t('invite.joinNamed', { name: family.name })}
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

function Avatar({ url, label, tint, size }: { url: string | null; label: string; tint: string; size: number }) {
  const palette = usePalette();
  const dim = { width: size, height: size, borderRadius: Radius.full };
  if (url) return <Image source={url} style={dim} contentFit="cover" transition={120} />;
  return (
    <View style={[dim, styles.avatarFallback, { backgroundColor: tint }]}>
      {label ? <Text style={{ color: palette.onAccent, fontSize: size * 0.4, fontWeight: '600' }}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  headerSpacer: { height: SHEET_CONTENT_TOP_PADDING },
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

  // 预览卡
  previewWrap: {
    paddingHorizontal: Space[6],
    paddingTop: Space[4],
    paddingBottom: Space[10],
    gap: Space[4],
    alignItems: 'center',
  },
  cover: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverPlaceholder: { fontSize: 48, fontWeight: '300' },
  familyAvatar: {
    position: 'absolute',
    top: Space[3],
    left: Space[3],
    width: 50,
    height: 50,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  familyAvatarText: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  familyName: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  familySlogan: { fontSize: 14, lineHeight: 20, marginTop: -Space[3], textAlign: 'center' },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: Space[2] },
  ownerText: { fontSize: 15 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: Space[3] },
  stack: { flexDirection: 'row' },
  stackItem: { borderRadius: Radius.full, borderWidth: 2 },
  memberCount: { fontSize: 14 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  banner: { width: '100%', borderRadius: Radius.md, padding: Space[3] },
  bannerText: { fontSize: 13, lineHeight: 19 },
  joinBtn: { width: '100%', marginTop: Space[2] },
});
