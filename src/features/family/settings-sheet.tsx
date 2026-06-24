/**
 * 家庭设置（流程 1 §3.5）：户主可改家庭名 + 封面；普通成员只读。
 * 封面走「即时上传」（同 Hero 头像，复用 useUpdateFamilyCover）；家庭名经顶栏「保存」提交。
 * 入口：家庭页 → 家庭管理 → 家庭设置。后续可在此追加「卡片背景图」等设置项。
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

import { useMyFamily, useMyProfile, useUpdateFamilyCover, useUpdateFamilyName } from '@/api';
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
  const updateCoverM = useUpdateFamilyCover();

  const family = familyQ.data;
  const isOwner = !!family && family.owner_user_id === profileQ.data?.id;

  // family 已在父页加载（缓存命中），Body 每次打开重新挂载即取到当前名。
  const [name, setName] = useState(family?.name ?? '');

  const trimmed = name.trim();
  const dirty = !!family && trimmed !== family.name;
  const canSave = isOwner && dirty && trimmed.length > 0 && !updateNameM.isPending;

  // 户主点封面：选图 → 压缩 → 上传 → 写回 cover_url（取消则静默）。
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
        <View style={styles.topBar}>
          <Pressable hitSlop={8} onPress={onClose}>
            <Text style={[styles.action, { color: palette.textSecondary }]}>取消</Text>
          </Pressable>
          <Text style={[styles.title, { color: palette.textPrimary }]}>家庭设置</Text>
          {isOwner ? (
            <Pressable hitSlop={8} onPress={onSave} disabled={!canSave}>
              <Text style={[styles.action, { color: canSave ? palette.accent : palette.textTertiary }]}>保存</Text>
            </Pressable>
          ) : (
            <View style={styles.actionGap} />
          )}
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {/* 家庭封面（即时上传，不经「保存」） */}
          <Text style={[styles.groupTitle, { color: palette.textSecondary }]}>家庭封面</Text>
          <Pressable onPress={onChangeCover} disabled={!isOwner || updateCoverM.isPending} style={styles.coverWrap}>
            {family?.cover_url ? (
              <Image source={family.cover_url} style={styles.cover} contentFit="cover" transition={150} />
            ) : (
              <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.accent }]}>
                <Text style={[styles.coverFallbackText, { color: palette.onAccent }]}>家</Text>
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
            <Text style={[styles.hint, { color: palette.textTertiary }]}>仅户主可修改家庭名称与封面</Text>
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
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
  },
  title: { fontSize: 17, fontWeight: '700' },
  action: { fontSize: 16, minWidth: 36 },
  actionGap: { minWidth: 36 },
  content: { paddingHorizontal: Space[4], paddingBottom: Space[12], gap: Space[2] },
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
