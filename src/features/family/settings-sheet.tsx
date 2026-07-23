/**
 * 家庭设置（流程 1 §3.5）：户主可改家庭名 + 家庭头像（avatar_url，方块小图）+
 * 家庭封面（cover_url，hero 背景 / 加入预览卡大图）；普通成员只读。
 * 头像 / 封面走「即时上传」；家庭名经顶栏「保存」提交。
 * 入口：家庭页 → 家庭管理 → 家庭设置。
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

import { useMyFamily, useMyProfile, useUpdateFamilyAvatar, useUpdateFamilyCover, useUpdateFamilyName } from '@/api';
import { SHEET_HEADER_HEIGHT, SheetHeader } from '@/components/sheet-header';
import { Radius, Space, usePalette } from '@/constants/design';

/** 家庭名长度上限（与创建家庭保持宽松一致）。 */
const NAME_MAX = 20;

export function FamilySettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <Body onClose={onClose} /> : null}
    </Modal>
  );
}

function Body({ onClose }: { onClose: () => void }) {
  const palette = usePalette();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const updateNameM = useUpdateFamilyName();
  const updateAvatarM = useUpdateFamilyAvatar();
  const updateCoverM = useUpdateFamilyCover();

  const family = familyQ.data;
  const isOwner = !!family && family.owner_user_id === profileQ.data?.id;

  // family 已在父页加载（缓存命中），Body 每次打开重新挂载即取到当前名。
  const [name, setName] = useState(family?.name ?? '');

  const trimmed = name.trim();
  const dirty = !!family && trimmed !== family.name;
  const canSave = isOwner && dirty && trimmed.length > 0 && !updateNameM.isPending;

  // 户主点头像：方形裁 → 压缩 → 上传 → 写回 avatar_url（取消则静默）。
  const onChangeAvatar = () => {
    if (!family || !isOwner || updateAvatarM.isPending) return;
    updateAvatarM.mutate(family.id, {
      onError: (e) => Alert.alert('头像更新失败', (e as Error).message ?? String(e)),
    });
  };

  // 户主点封面：宽幅原图 → 压缩 → 上传 → 写回 cover_url（取消则静默）。
  const onChangeCover = () => {
    if (!family || !isOwner || updateCoverM.isPending) return;
    updateCoverM.mutate(family.id, {
      onError: (e) => Alert.alert('封面更新失败', (e as Error).message ?? String(e)),
    });
  };

  const onSave = async () => {
    if (!family || !canSave) return;
    try {
      await updateNameM.mutateAsync({ familyId: family.id, name: trimmed });
      onClose();
    } catch (e) {
      Alert.alert('保存失败', (e as Error).message ?? String(e));
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView style={styles.flex}>
        {/* 显式保存型：✕ 放弃并关闭 + ✓ 保存（DESIGN §9.9）；非户主无 ✓ */}
        <SheetHeader
          title="家庭设置"
          onClose={onClose}
          onConfirm={isOwner ? onSave : undefined}
          confirmDisabled={!canSave}
        />

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* 家庭头像（avatar_url，方块小图；即时上传，不经「保存」） */}
          <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>家庭头像</Text>
          <Pressable onPress={onChangeAvatar} disabled={!isOwner || updateAvatarM.isPending} style={styles.avatarWrap}>
            {family?.avatar_url ? (
              <Image source={family.avatar_url} style={styles.avatar} contentFit="cover" transition={150} />
            ) : (
              <View style={[styles.avatar, styles.coverFallback, { backgroundColor: palette.accent }]}>
                <Text style={[styles.avatarFallbackText, { color: palette.onAccent }]}>家</Text>
              </View>
            )}
            {updateAvatarM.isPending ? (
              <View style={[styles.avatar, styles.coverOverlay]}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : isOwner ? (
              <View style={[styles.coverEdit, styles.avatarEdit]}>
                <SymbolView name="camera.fill" tintColor="#fff" size={11} />
              </View>
            ) : null}
          </Pressable>

          {/* 家庭封面（cover_url，家庭页 hero 背景 / 加入预览卡大图；即时上传） */}
          <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>家庭封面</Text>
          <Pressable onPress={onChangeCover} disabled={!isOwner || updateCoverM.isPending} style={styles.coverWrap}>
            {family?.cover_url ? (
              <Image source={family.cover_url} style={styles.cover} contentFit="cover" transition={150} />
            ) : (
              // 未设置：预览与家庭页 hero 兜底一致的品牌蓝渐变
              <View style={[styles.cover, styles.coverFallback, styles.coverGradient]}>
                <Text style={styles.coverHintText}>未设置 · 默认蓝色渐变</Text>
              </View>
            )}
            {updateCoverM.isPending ? (
              <View style={[styles.cover, styles.coverOverlay]}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : isOwner ? (
              <View style={styles.coverEdit}>
                <SymbolView name="camera.fill" tintColor="#fff" size={13} />
                <Text style={styles.coverEditText}>更换封面</Text>
              </View>
            ) : null}
          </Pressable>

          {/* 家庭名称 */}
          <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>家庭名称</Text>
          {isOwner ? (
            <View style={[styles.inputWrap, { backgroundColor: palette.card }]}>
              <TextInput
                style={[styles.input, { color: palette.textPrimary }]}
                value={name}
                onChangeText={setName}
                placeholder="给这个家起个名字"
                placeholderTextColor={palette.textTertiary}
                maxLength={NAME_MAX}
                returnKeyType="done"
              />
              <Text style={[styles.counter, { color: palette.textTertiary }]}>
                {trimmed.length}/{NAME_MAX}
              </Text>
            </View>
          ) : (
            <View style={[styles.inputWrap, { backgroundColor: palette.card }]}>
              <Text style={{ color: palette.textPrimary, fontSize: 16 }}>{family?.name ?? '—'}</Text>
            </View>
          )}

          {!isOwner ? (
            <Text style={[styles.hint, { color: palette.textTertiary }]}>仅户主可修改家庭名称、头像与封面</Text>
          ) : null}
        </ScrollView>
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
  action: { fontSize: 16, minWidth: 36 },
  actionGap: { minWidth: 36 },
  content: {
    paddingTop: SHEET_HEADER_HEIGHT,
    paddingHorizontal: Space[6],
    paddingBottom: Space[12],
    gap: Space[2],
  },
  groupTitle: { fontSize: 13, paddingHorizontal: Space[1], marginTop: Space[3] },

  // 封面
  coverWrap: { width: '100%', aspectRatio: 16 / 9, borderRadius: Radius.lg, overflow: 'hidden' },
  cover: { width: '100%', height: '100%' },
  coverFallback: { alignItems: 'center', justifyContent: 'center' },
  coverFallbackText: { fontSize: 48, fontWeight: '700' },
  coverOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverEdit: {
    position: 'absolute',
    right: Space[3],
    bottom: Space[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[1],
    paddingHorizontal: Space[3],
    paddingVertical: Space[1],
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  coverEditText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  // 封面未设置时的兜底预览：与家庭页 hero 相同的品牌蓝渐变
  coverGradient: { experimental_backgroundImage: 'linear-gradient(145deg, #3C9FFE, #0169D4)' },
  coverHintText: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '500' },

  // 家庭头像（方块小图）
  avatarWrap: { width: 88, height: 88, borderRadius: Radius.lg, overflow: 'hidden' },
  avatar: { width: '100%', height: '100%' },
  avatarFallbackText: { fontSize: 36, fontWeight: '700' },
  avatarEdit: { right: Space[1], bottom: Space[1], paddingHorizontal: Space[2] },

  // 家庭名
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    minHeight: 52,
    paddingHorizontal: Space[4],
    paddingVertical: Space[2],
    borderRadius: Radius.md,
  },
  input: { flex: 1, fontSize: 16 },
  counter: { fontSize: 13, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 13, paddingHorizontal: Space[1], marginTop: Space[1] },
});
