/**
 * 家庭设置：户主在一个显式保存的 pageSheet 中统一编辑家庭名称、口号、头像和封面。
 * 图片先上传为版本化草稿 URL，只有点 ✓ 后才与文字资料一起写入 families；账期时区固定只读。
 */
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import {
  defaultFamilyCoverCrop,
  type Family,
  type FamilyCoverCrop,
  type PickedFamilyCover,
  pickFamilyCoverImage,
  useMyFamily,
  useMyProfile,
  useUpdateFamilySettings,
  useUploadFamilyAvatar,
  useUploadFamilyCover,
} from '@/api';
import { PageSheet } from '@/components/page-sheet';
import { SHEET_CONTENT_TOP_PADDING, SheetHeader } from '@/components/sheet-header';
import { Radius, Space, useSheetPalette } from '@/constants/design';

const NAME_MIN = 2;
const NAME_MAX = 12;
const SLOGAN_MIN = 2;
const SLOGAN_MAX = 24;

function compactTimezone(timezone: string | null | undefined): string {
  return timezone === 'Asia/Shanghai' || !timezone ? '中国标准时间 · UTC+8' : timezone;
}

export function FamilySettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <PageSheet visible={visible} onClose={onClose}>
      <Body onClose={onClose} />
    </PageSheet>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const palette = useSheetPalette();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const family = familyQ.data;
  const isOwner = !!family && family.owner_user_id === profileQ.data?.id;

  if (!family) {
    return (
      <View style={[styles.loadingRoot, { backgroundColor: palette.base }]}>
        <ActivityIndicator />
      </View>
    );
  }

  return <SettingsForm key={family.id} family={family} isOwner={isOwner} onClose={onClose} />;
}

function SettingsForm({ family, isOwner, onClose }: { family: Family; isOwner: boolean; onClose: () => void }) {
  const palette = useSheetPalette();
  const saveSettingsM = useUpdateFamilySettings();
  const uploadAvatarM = useUploadFamilyAvatar();
  const uploadCoverM = useUploadFamilyCover();
  const [name, setName] = useState(family.name);
  const [slogan, setSlogan] = useState(family.slogan);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(family.avatar_url);
  const [coverUrl, setCoverUrl] = useState<string | null>(family.cover_url);
  const [coverDraft, setCoverDraft] = useState<PickedFamilyCover | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [sloganTouched, setSloganTouched] = useState(false);

  const nextName = name.trim();
  const nextSlogan = slogan.trim();
  const nameValid = nextName.length >= NAME_MIN && nextName.length <= NAME_MAX;
  const sloganValid = nextSlogan.length >= SLOGAN_MIN && nextSlogan.length <= SLOGAN_MAX;
  const uploading = uploadAvatarM.isPending || uploadCoverM.isPending;
  const dirty =
    nextName !== family.name ||
    nextSlogan !== family.slogan ||
    avatarUrl !== family.avatar_url ||
    coverUrl !== family.cover_url;
  const canSave = isOwner && dirty && nameValid && sloganValid && !uploading && !saveSettingsM.isPending;

  const changeAvatar = async () => {
    if (!isOwner || uploading) return;
    try {
      const url = await uploadAvatarM.mutateAsync(family.id);
      if (url) setAvatarUrl(url);
    } catch (error) {
      Alert.alert('头像上传失败', (error as Error).message ?? String(error));
    }
  };

  const changeCover = async () => {
    if (!isOwner || uploading) return;
    try {
      const image = await pickFamilyCoverImage();
      if (image) setCoverDraft(image);
    } catch {
      Alert.alert('该图片资源不可用');
    }
  };

  const confirmCoverCrop = async (image: PickedFamilyCover, crop: FamilyCoverCrop) => {
    if (!isOwner || uploading) return;
    try {
      const url = await uploadCoverM.mutateAsync({ familyId: family.id, image, crop });
      if (url) setCoverUrl(url);
      setCoverDraft(null);
    } catch (error) {
      Alert.alert('封面上传失败', (error as Error).message ?? String(error));
    }
  };

  const save = async () => {
    if (!canSave) return;
    try {
      await saveSettingsM.mutateAsync({
        familyId: family.id,
        input: { name: nextName, slogan: nextSlogan, avatarUrl, coverUrl },
      });
      onClose();
    } catch (error) {
      Alert.alert('保存失败', (error as Error).message ?? String(error));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
        >
          <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>家庭资料</Text>

          <View style={styles.identityPreview}>
            {coverUrl ? (
              <Image source={coverUrl} style={styles.cover} contentFit="cover" transition={150} />
            ) : (
              <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.accent }]}>
                <SymbolView name="house.fill" tintColor={palette.onAccent} size={42} />
              </View>
            )}

            {isOwner ? (
              <Pressable
                onPress={() => void changeCover()}
                disabled={uploading}
                style={({ pressed }) => [styles.coverAction, pressed ? styles.pressed : null]}
                accessibilityRole="button"
                accessibilityLabel="更换家庭封面"
                accessibilityHint="从相册选择家庭封面图片"
              >
                {uploadCoverM.isPending ? (
                  <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                  <>
                    <SymbolView name="camera.fill" tintColor="#FFFFFF" size={14} />
                    <Text style={styles.coverActionText}>更换封面</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            <Pressable
              onPress={() => void changeAvatar()}
              disabled={!isOwner || uploading}
              style={({ pressed }) => [styles.avatarButton, pressed ? styles.pressed : null]}
              accessibilityRole="button"
              accessibilityLabel="更换家庭头像"
              accessibilityHint="从相册选择方形家庭头像"
            >
              {avatarUrl ? (
                <Image source={avatarUrl} style={styles.avatar} contentFit="cover" transition={150} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: palette.accent }]}>
                  <Text style={[styles.avatarFallbackText, { color: palette.onAccent }]}>家</Text>
                </View>
              )}
              {uploadAvatarM.isPending ? (
                <View style={styles.avatarLoading}>
                  <ActivityIndicator color="#FFFFFF" size="small" />
                </View>
              ) : isOwner ? (
                <View style={styles.avatarCamera}>
                  <SymbolView name="camera.fill" tintColor="#FFFFFF" size={10} />
                </View>
              ) : null}
            </Pressable>
          </View>

          <View style={[styles.formCard, { backgroundColor: palette.card }]}>
            <EditableRow
              label="家庭名称"
              value={name}
              onChangeText={setName}
              onBlur={() => setNameTouched(true)}
              editable={isOwner && !uploading}
              maxLength={NAME_MAX}
              count={nextName.length}
              max={NAME_MAX}
              accessibilityLabel="家庭名称"
              placeholder="给这个家起个名字"
              palette={palette}
              invalid={nameTouched && !nameValid}
            />
            <View style={[styles.formDivider, { backgroundColor: palette.separator }]} />
            <EditableRow
              label="家庭口号"
              value={slogan}
              onChangeText={setSlogan}
              onBlur={() => setSloganTouched(true)}
              editable={isOwner && !uploading}
              maxLength={SLOGAN_MAX}
              count={nextSlogan.length}
              max={SLOGAN_MAX}
              accessibilityLabel="家庭口号"
              placeholder="写一句属于你们的话"
              palette={palette}
              invalid={sloganTouched && !sloganValid}
            />
          </View>

          {nameTouched && !nameValid ? (
            <Text style={[styles.validation, { color: palette.danger }]}>
              家庭名称需为 {NAME_MIN}–{NAME_MAX} 个字符
            </Text>
          ) : null}
          {sloganTouched && !sloganValid ? (
            <Text style={[styles.validation, { color: palette.danger }]}>
              家庭口号需为 {SLOGAN_MIN}–{SLOGAN_MAX} 个字符
            </Text>
          ) : null}

          <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>账本规则</Text>
          <View style={[styles.ruleCard, { backgroundColor: palette.card }]}>
            <SymbolView name="calendar" tintColor={palette.textPrimary} size={22} />
            <Text style={[styles.ruleLabel, { color: palette.textPrimary }]}>家庭账期时区</Text>
            <Text style={[styles.ruleValue, { color: palette.textSecondary }]} numberOfLines={1}>
              {compactTimezone(family?.timezone)}
            </Text>
          </View>
          <View
            style={styles.ruleHint}
            accessible
            accessibilityLabel="月度预算、报表与目标均按此时区归属，创建后不可修改"
          >
            <SymbolView name="info.circle" tintColor={palette.textTertiary} size={15} />
            <Text style={[styles.ruleHintText, { color: palette.textTertiary }]} numberOfLines={1}>
              月度预算、报表与目标均按此时区归属 · 创建后不可修改
            </Text>
          </View>

          {!isOwner ? (
            <Text style={[styles.readOnlyHint, { color: palette.textTertiary }]}>仅户主可修改家庭资料</Text>
          ) : null}
        </ScrollView>
        <SheetHeader
          title="家庭设置"
          onClose={onClose}
          onConfirm={isOwner ? save : undefined}
          confirmDisabled={!canSave}
        />
      </SafeAreaView>
      <CoverCropSheet
        key={coverDraft?.uri}
        image={coverDraft}
        saving={uploadCoverM.isPending}
        onClose={() => setCoverDraft(null)}
        onConfirm={(crop) => {
          if (coverDraft) void confirmCoverCrop(coverDraft, crop);
        }}
      />
    </View>
  );
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(value, upper));
}

function touchDistance(touches: readonly { pageX: number; pageY: number }[]): number {
  if (touches.length < 2) return 0;
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}

/**
 * iOS 系统裁切只支持正方形，家庭封面改为应用内固定 3:1 取景。
 * 裁切是连续画布手势，必须全屏承载，避免与 pageSheet 的上下拖拽关闭手势竞争。
 */
function CoverCropSheet({
  image,
  saving,
  onClose,
  onConfirm,
}: {
  image: PickedFamilyCover | null;
  saving: boolean;
  onClose: () => void;
  onConfirm: (crop: FamilyCoverCrop) => void;
}) {
  const { width: viewportWidth } = useWindowDimensions();
  const cropWidth = Math.min(Math.max(viewportWidth - Space[12], 240), 520);
  const cropHeight = cropWidth / 3;
  const initialCrop = image ? defaultFamilyCoverCrop(image) : null;
  const [zoom, setZoom] = useState(1);
  const imageScale = image ? Math.max(cropWidth / image.width, cropHeight / image.height) * zoom : 1;
  const renderedWidth = image ? image.width * imageScale : 0;
  const renderedHeight = image ? image.height * imageScale : 0;
  const maxOffsetX = Math.max(0, renderedWidth - cropWidth);
  const maxOffsetY = Math.max(0, renderedHeight - cropHeight);
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });
  const [dragStart, setDragStart] = useState<{ x: number; y: number; positionX: number; positionY: number } | null>(
    null,
  );
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null);

  if (!image || !initialCrop) return null;

  const crop: FamilyCoverCrop = {
    width: initialCrop.width / zoom,
    height: initialCrop.height / zoom,
    originX: (image.width - initialCrop.width / zoom) * position.x,
    originY: (image.height - initialCrop.height / zoom) * position.y,
  };
  const direction =
    maxOffsetX > 1 ? '拖动调整取景，双指缩放' : maxOffsetY > 1 ? '拖动调整取景，双指缩放' : '双指缩放后可拖动调整取景';
  const resetCrop = () => {
    setZoom(1);
    setPosition({ x: 0.5, y: 0.5 });
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      {/* Modal 会创建独立的原生容器；需在其根节点重新测量安全区，不能复用页面的 provider。 */}
      <SafeAreaProvider>
        <View style={styles.cropRoot}>
          <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.flex}>
            <View style={styles.cropHeader}>
              <CropHeaderButton icon="xmark" label="取消裁切" onPress={onClose} />
              <Text style={styles.cropTitle}>裁切封面</Text>
              <CropHeaderButton icon="checkmark" label="完成裁切" disabled={saving} onPress={() => onConfirm(crop)} />
            </View>
            <View style={styles.cropContent}>
              <Text style={styles.cropEyebrow}>家庭封面 · 固定 3:1 比例</Text>
              <View
                onStartShouldSetResponder={() => true}
                onResponderGrant={(event) => {
                  pinchStart.current = null;
                  setDragStart({
                    x: event.nativeEvent.locationX,
                    y: event.nativeEvent.locationY,
                    positionX: position.x,
                    positionY: position.y,
                  });
                }}
                onResponderMove={(event) => {
                  const touches = event.nativeEvent.touches;
                  if (touches.length >= 2) {
                    const distance = touchDistance(touches);
                    if (!pinchStart.current) pinchStart.current = { distance, zoom };
                    if (pinchStart.current.distance > 0) {
                      setZoom(clamp((pinchStart.current.zoom * distance) / pinchStart.current.distance, 1, 3));
                    }
                    return;
                  }
                  if (pinchStart.current) {
                    pinchStart.current = null;
                    setDragStart({
                      x: event.nativeEvent.locationX,
                      y: event.nativeEvent.locationY,
                      positionX: position.x,
                      positionY: position.y,
                    });
                    return;
                  }
                  if (!dragStart) return;
                  const deltaX = event.nativeEvent.locationX - dragStart.x;
                  const deltaY = event.nativeEvent.locationY - dragStart.y;
                  setPosition({
                    x: maxOffsetX ? clamp(dragStart.positionX - deltaX / maxOffsetX, 0, 1) : 0.5,
                    y: maxOffsetY ? clamp(dragStart.positionY - deltaY / maxOffsetY, 0, 1) : 0.5,
                  });
                }}
                onResponderRelease={() => {
                  pinchStart.current = null;
                  setDragStart(null);
                }}
                onResponderTerminate={() => {
                  pinchStart.current = null;
                  setDragStart(null);
                }}
                style={[styles.cropViewport, { width: cropWidth, height: cropHeight }]}
                accessibilityRole="adjustable"
                accessibilityLabel="家庭封面取景区域"
                accessibilityHint={direction}
              >
                <Image
                  source={image.uri}
                  style={[
                    styles.cropImage,
                    {
                      width: renderedWidth,
                      height: renderedHeight,
                      left: -position.x * maxOffsetX,
                      top: -position.y * maxOffsetY,
                    },
                  ]}
                  contentFit="fill"
                />
              </View>
              <Text style={styles.cropHint}>{direction}</Text>
              <Pressable
                onPress={resetCrop}
                accessibilityRole="button"
                accessibilityLabel="还原封面取景"
                style={({ pressed }) => [styles.cropReset, pressed ? styles.cropButtonPressed : null]}
              >
                <SymbolView name="arrow.counterclockwise" tintColor="#FFFFFF" size={15} />
                <Text style={styles.cropResetText}>还原</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}

function CropHeaderButton({
  icon,
  label,
  disabled,
  onPress,
}: {
  icon: 'xmark' | 'checkmark';
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.cropHeaderButton,
        pressed ? styles.cropButtonPressed : null,
        disabled ? styles.cropDisabled : null,
      ]}
    >
      {disabled && icon === 'checkmark' ? (
        <ActivityIndicator color="#FFFFFF" size="small" />
      ) : (
        <SymbolView name={icon} tintColor="#FFFFFF" size={18} weight="semibold" />
      )}
    </Pressable>
  );
}

function EditableRow({
  label,
  value,
  onChangeText,
  onBlur,
  editable,
  maxLength,
  count,
  max,
  accessibilityLabel,
  placeholder,
  palette,
  invalid,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  onBlur: () => void;
  editable: boolean;
  maxLength: number;
  count: number;
  max: number;
  accessibilityLabel: string;
  placeholder: string;
  palette: ReturnType<typeof useSheetPalette>;
  invalid: boolean;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: palette.textPrimary }]}>{label}</Text>
      <View style={styles.fieldValue}>
        {editable ? (
          <TextInput
            value={value}
            onChangeText={onChangeText}
            onBlur={onBlur}
            editable={editable}
            maxLength={maxLength}
            placeholder={placeholder}
            placeholderTextColor={palette.textTertiary}
            style={[styles.fieldInput, { color: palette.textPrimary }]}
            textAlign="right"
            returnKeyType="done"
            accessibilityLabel={accessibilityLabel}
          />
        ) : (
          <Text style={[styles.fieldReadOnly, { color: palette.textPrimary }]} numberOfLines={1}>
            {value || '—'}
          </Text>
        )}
        <Text
          style={[styles.counter, { color: invalid ? palette.danger : palette.textTertiary }]}
        >{`${count}/${max}`}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  cropRoot: { flex: 1, backgroundColor: '#000000' },
  cropHeader: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Space[4],
  },
  cropTitle: { color: '#FFFFFF', fontSize: 17, lineHeight: 22, fontWeight: '600' },
  cropHeaderButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  cropDisabled: { opacity: 0.52 },
  cropButtonPressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  cropContent: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[4], paddingHorizontal: Space[6] },
  cropEyebrow: { color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 20, fontWeight: '500' },
  cropViewport: { overflow: 'hidden', borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.52)' },
  cropImage: { position: 'absolute' },
  cropHint: { color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 20 },
  cropReset: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    paddingHorizontal: Space[3],
    borderRadius: Radius.full,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  cropResetText: { color: '#FFFFFF', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  loadingRoot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingTop: SHEET_CONTENT_TOP_PADDING,
    paddingHorizontal: Space[6],
    paddingBottom: Space[12],
    gap: Space[2],
  },
  groupTitle: { fontSize: 13, lineHeight: 18, marginTop: Space[3], paddingHorizontal: Space[1] },
  identityPreview: { width: '100%', aspectRatio: 3, borderRadius: Radius.lg, overflow: 'hidden' },
  cover: { width: '100%', height: '100%' },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverAction: {
    position: 'absolute',
    right: Space[3],
    bottom: Space[3],
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[1],
    paddingHorizontal: Space[3],
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.48)',
  },
  coverActionText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '600' },
  avatarButton: { position: 'absolute', top: Space[3], left: Space[3], width: 50, height: 50, borderRadius: Radius.md },
  avatar: { width: 50, height: 50, borderRadius: Radius.md },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarFallbackText: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  avatarCamera: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.64)',
  },
  avatarLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  formCard: { borderRadius: Radius.lg, overflow: 'hidden' },
  fieldRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: Space[3], paddingHorizontal: Space[4] },
  fieldLabel: { flexShrink: 0, fontSize: 16, lineHeight: 22, fontWeight: '500' },
  fieldValue: { flex: 1, minWidth: 0, alignItems: 'stretch', gap: 1 },
  fieldInput: { minHeight: 24, padding: 0, fontSize: 16, lineHeight: 22 },
  fieldReadOnly: { minHeight: 22, fontSize: 16, lineHeight: 22, textAlign: 'right' },
  counter: { fontSize: 13, lineHeight: 17, textAlign: 'right', fontVariant: ['tabular-nums'] },
  formDivider: { height: StyleSheet.hairlineWidth, marginLeft: Space[4] },
  validation: { fontSize: 13, lineHeight: 18, paddingHorizontal: Space[1] },
  ruleCard: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    borderRadius: Radius.lg,
    paddingHorizontal: Space[4],
  },
  ruleLabel: { flexShrink: 0, fontSize: 16, lineHeight: 22, fontWeight: '500' },
  ruleValue: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 21, textAlign: 'right' },
  ruleHint: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: Space[2], paddingHorizontal: Space[2] },
  ruleHintText: { flex: 1, fontSize: 13, lineHeight: 18 },
  readOnlyHint: { fontSize: 13, lineHeight: 18, paddingHorizontal: Space[1], marginTop: Space[2] },
});
