/**
 * 家庭设置：户主在一个显式保存的 pageSheet 中统一编辑家庭名称、口号、头像和封面。
 * 图片先上传为版本化草稿 URL，只有点 ✓ 后才与文字资料一起写入 families；账期时区固定只读。
 */
import { Image } from 'expo-image';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  type Family,
  useMyFamily,
  useMyProfile,
  useUpdateFamilySettings,
  useUploadFamilyAvatar,
  useUploadFamilyCover,
} from '@/api';
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
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Body onClose={onClose} /> : null}
    </Modal>
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
      const url = await uploadCoverM.mutateAsync(family.id);
      if (url) setCoverUrl(url);
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
    </View>
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
