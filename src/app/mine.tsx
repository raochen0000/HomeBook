/**
 * 我的（Tab 4）：账号信息 + 设置入口。
 * 视觉对齐参考图（灰底 + 白分组卡 + 灰色圆角图标底片）。
 * 多数入口为占位（尚无对应功能）：点击弹「敬请期待」轻提示；仅「退出登录」为真实操作。
 * 手机号为参考图占位假数据（profiles 表暂无手机号字段，登录用邮箱/Apple）。
 *
 * 滚动机制与其它 Tab（首页/报表/家庭）一致：内容贴边滚动、可滑入状态栏下方，
 * 沿用 useCollapsibleHeader 的「绝对头部覆盖层」方案——只是头部不渲染大标题/搜索，
 * 仅作顶部背景与安全区让位。
 */
import { Image } from 'expo-image';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyProfile, useUpdateMyAvatar } from '@/api';
import { ThemedText } from '@/components/themed-text';
import { Toast } from '@/components/toast';
import { Radius, Space, TabBarInset, usePalette } from '@/constants/design';
import { useCollapsibleHeader } from '@/features/shared/use-collapsible-header';
import { signOut, useSession } from '@/lib/auth';

/** 参考图占位手机号（脱敏样式）；接入真实手机号绑定后替换。 */
const PLACEHOLDER_PHONE = '138 **** 5678';
const APP_VERSION = 'v1.0.0';
/** 灰色圆角图标底片 / 头像兜底底色（iOS secondarySystemFill 观感，明暗通用）。 */
const CHIP_FILL = 'rgba(120,120,128,0.16)';

type Row = {
  icon: SymbolViewProps['name'];
  label: string;
  /** 行尾灰色值文本（如「简体中文」「v1.0.0」）。 */
  value?: string;
};

const GROUPS: Row[][] = [
  [
    { icon: 'person.fill', label: '个人信息' },
    { icon: 'lock.fill', label: '账号与安全' },
    { icon: 'iphone', label: '绑定手机号', value: PLACEHOLDER_PHONE },
    { icon: 'bell.fill', label: '通知设置' },
  ],
  [
    { icon: 'moon.fill', label: '深色模式', value: '跟随系统' },
    { icon: 'globe', label: '语言设置', value: '简体中文' },
    { icon: 'ruler.fill', label: '记账设置' },
    { icon: 'square.and.arrow.down', label: '导出数据' },
  ],
  [
    { icon: 'questionmark.circle.fill', label: '帮助中心' },
    { icon: 'text.bubble.fill', label: '意见反馈' },
    { icon: 'info.circle.fill', label: '关于家账', value: APP_VERSION },
  ],
];

export default function MineScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  // 与其它 Tab 同款滚动折叠脚手架；本页无大标题，估计高度只含安全区。
  const { scrollRef, headerHeight, headerStyle, onHeaderLayout } = useCollapsibleHeader(insets.top);
  const { session } = useSession();
  const { data: profile } = useMyProfile();
  const updateAvatar = useUpdateMyAvatar();
  const [toast, setToast] = useState(false);

  // 占位入口：尚无对应功能，统一轻提示。
  const onPlaceholder = () => setToast(true);

  // 点击头像换图：选图 → 压缩 → 上传 → 写回 avatar_url（取消则静默）。
  const onChangeAvatar = () => {
    if (!profile?.id || updateAvatar.isPending) return;
    updateAvatar.mutate(profile.id, {
      onError: (e) => Alert.alert('头像更新失败', (e as Error).message ?? String(e)),
    });
  };

  const onSignOut = () => {
    Alert.alert('退出登录', '确定要退出当前账号吗？', [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          try {
            await signOut();
          } catch (e) {
            Alert.alert('退出失败', (e as Error).message ?? String(e));
          }
        },
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <Animated.ScrollView
        ref={scrollRef}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: headerHeight + Space[2] }]}
        scrollIndicatorInsets={{ top: headerHeight, bottom: TabBarInset }}
      >
        {/* 账号信息（头像可点换图；文字区点击占位） */}
        <View style={styles.profile}>
          <Pressable onPress={onChangeAvatar} disabled={updateAvatar.isPending}>
            <Avatar url={profile?.avatar_url ?? null} uploading={updateAvatar.isPending} palette={palette} />
          </Pressable>
          <Pressable style={styles.profileText} onPress={onPlaceholder}>
            <ThemedText style={[styles.name, { color: palette.textPrimary }]} numberOfLines={1}>
              {profile?.nickname ?? '小满'}
            </ThemedText>
            <View style={styles.phoneRow}>
              <ThemedText style={[styles.phone, { color: palette.textSecondary }]} numberOfLines={1}>
                手机号：{PLACEHOLDER_PHONE}
              </ThemedText>
              <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
            </View>
          </Pressable>
        </View>

        {/* 设置分组 */}
        {GROUPS.map((rows, gi) => (
          <View key={gi} style={[styles.group, { backgroundColor: palette.card }]}>
            {rows.map((row, ri) => (
              <View key={row.label}>
                {ri > 0 ? <View style={[styles.divider, { backgroundColor: palette.separator }]} /> : null}
                <SettingRow row={row} palette={palette} onPress={onPlaceholder} />
              </View>
            ))}
          </View>
        ))}

        {/* 退出登录（真实操作） */}
        {session ? (
          <Pressable
            onPress={onSignOut}
            style={({ pressed }) => [styles.signOut, { backgroundColor: palette.card, opacity: pressed ? 0.6 : 1 }]}
          >
            <ThemedText style={[styles.signOutText, { color: palette.danger }]}>退出登录</ThemedText>
          </Pressable>
        ) : null}
      </Animated.ScrollView>

      {/* 顶部覆盖层：与其它 Tab 同款机制，但不渲染大标题/搜索，仅作背景与安全区让位。 */}
      <View style={[styles.headerClip, { height: headerHeight }]} pointerEvents="none">
        <Animated.View
          style={[styles.header, { backgroundColor: palette.base, paddingTop: insets.top }, headerStyle]}
          onLayout={onHeaderLayout}
        />
      </View>

      <Toast visible={toast} text="敬请期待" onHide={() => setToast(false)} />
    </View>
  );
}

function Avatar({
  url,
  uploading,
  palette,
}: {
  url: string | null;
  uploading: boolean;
  palette: ReturnType<typeof usePalette>;
}) {
  return (
    <View style={styles.avatarWrap}>
      {url ? (
        <Image source={url} style={styles.avatar} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <SymbolView name="person.fill" tintColor={palette.textTertiary} size={44} />
        </View>
      )}
      {uploading ? (
        <View style={[styles.avatar, styles.avatarOverlay]}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
      {/* 相机角标：提示头像可点更换 */}
      <View style={[styles.avatarBadge, { backgroundColor: palette.accent, borderColor: palette.base }]}>
        <SymbolView name="camera.fill" tintColor={palette.onAccent} size={13} />
      </View>
    </View>
  );
}

function SettingRow({
  row,
  palette,
  onPress,
}: {
  row: Row;
  palette: ReturnType<typeof usePalette>;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { backgroundColor: CHIP_FILL }]}>
      <View style={styles.chip}>
        <SymbolView name={row.icon} tintColor={palette.textPrimary} size={19} />
      </View>
      <ThemedText style={[styles.rowLabel, { color: palette.textPrimary }]}>{row.label}</ThemedText>
      <View style={styles.flex} />
      {row.value ? (
        <ThemedText style={[styles.rowValue, { color: palette.textSecondary }]} numberOfLines={1}>
          {row.value}
        </ThemedText>
      ) : null}
      <SymbolView name="chevron.right" tintColor={palette.textTertiary} size={13} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  // paddingTop 由 headerHeight 在运行时注入（让内容贴边滚动、可滑入状态栏下）。
  content: { paddingHorizontal: Space[4], paddingBottom: TabBarInset, gap: Space[5] },
  headerClip: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden', zIndex: 10 },
  header: { width: '100%' },

  profile: { flexDirection: 'row', alignItems: 'center', gap: Space[4], paddingVertical: Space[2] },
  avatarWrap: { width: 88, height: 88 },
  avatar: { width: 88, height: 88, borderRadius: Radius.full },
  avatarFallback: { backgroundColor: CHIP_FILL, alignItems: 'center', justifyContent: 'center' },
  avatarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadge: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: { flex: 1, gap: Space[2] },
  // 须显式给 lineHeight：ThemedText 默认 type 带 lineHeight:24，会裁掉更大字号的顶部。
  name: { fontSize: 26, lineHeight: 34, fontWeight: '700' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: Space[1] },
  phone: { fontSize: 15 },

  group: { borderRadius: Radius.lg, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[3],
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
    minHeight: 60,
  },
  chip: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: CHIP_FILL,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: 17, fontWeight: '500' },
  rowValue: { fontSize: 15 },
  // chip(40) + paddingLeft(16) + gap(12) = 68，分割线在标签下方对齐起。
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 68 },

  signOut: { borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', paddingVertical: Space[4] },
  signOutText: { fontSize: 17, fontWeight: '600' },
});
