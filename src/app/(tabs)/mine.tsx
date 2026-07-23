/**
 * 我的（Tab 4，G1）：账号信息 + 设置入口（PRD §18 / IA §6 G1 / DESIGN §10.5）。
 * 原生 SwiftUI List(insetGrouped) + Section 实现（2026-07-02 按用户要求由 RN 卡片改原生 Form/List）。
 * 入口收敛（PRD §18.1）：原列表「个人信息 / 账号与安全 / 绑定手机号」已并入顶部用户块 → 账号页（G2）。
 * - 顶部用户块整块点击 → push /account（换头像在账号页「头像」行）。
 * - 记账设置 / 导出数据 / 通知设置 / 帮助 / 反馈 / 关于 → push 各子页。
 * - 深色模式 / 语言 → 行内原生菜单式 Picker 下拉（当前项打勾、无「取消」项；深色仍跟随系统，语言仅简体中文）。
 * - 退出登录 → 二次确认后登出（真实操作）。
 * 折叠头与首页同款：useManualCollapsibleHeader + 原生 List 的 scrollGeometry 修饰符驱动，
 * 头部只作背景与安全区让位（不渲染标题 / 搜索）。
 */
import { HStack, Image, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  aspectRatio,
  clipShape,
  contentShape,
  font,
  foregroundColor,
  frame,
  listRowInsets,
  onTapGesture,
  resizable,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { useRouter, type Href } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyProfile } from '@/api';
import { toast } from '@/components/toast';
import { Space, usePalette } from '@/constants/design';
import { useAvatarFiles } from '@/features/home/use-avatar-files';
import { MenuRow, Row, SettingsList } from '@/features/settings/native-list';
import { useManualCollapsibleHeader } from '@/features/shared/use-collapsible-header';
import { signOut, useSession } from '@/lib/auth';

const APP_VERSION = 'v1.0.0';

/** +86 手机号脱敏为「138 **** 5678」；无号时占位。 */
function maskPhone(e164?: string | null): string {
  if (!e164) return '未绑定';
  const local = e164.replace(/^\+?86/, '');
  if (local.length !== 11) return '已绑定';
  return `${local.slice(0, 3)} **** ${local.slice(7)}`;
}

export default function MineScreen() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { scrollGeometry, headerHeight, headerStyle, onHeaderLayout } = useManualCollapsibleHeader(
    insets.top + Space[2],
    insets.top,
  );
  const { session } = useSession();
  const { data: profile } = useMyProfile();

  const avatarFiles = useAvatarFiles(profile ? [{ id: profile.id, avatar_url: profile.avatar_url }] : []);
  const avatarUri = profile ? (avatarFiles.get(profile.id) ?? null) : null;

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
      <SettingsList extraModifiers={scrollGeometry ? [scrollGeometry] : []}>
        {/* 用户信息块：iOS「设置」应用顶部账户卡观感——独立白卡、大头像、整块点击 → 账号页（G2）。 */}
        <Section>
          <HStack
            alignment="center"
            spacing={Space[4]}
            modifiers={[
              listRowInsets({ top: Space[3], bottom: Space[3], leading: Space[4], trailing: Space[4] }),
              contentShape(shapes.rectangle()),
              onTapGesture(() => router.push('/account' as Href)),
            ]}
          >
            {avatarUri ? (
              <Image
                uiImage={avatarUri}
                modifiers={[
                  resizable(),
                  aspectRatio({ contentMode: 'fill' }),
                  frame({ width: 60, height: 60 }),
                  clipShape('circle'),
                ]}
              />
            ) : (
              <Image systemName="person.crop.circle.fill" size={60} color={palette.textTertiary} />
            )}
            <VStack alignment="leading" spacing={Space[1]}>
              <Text modifiers={[font({ size: 22, weight: 'semibold' }), foregroundColor(palette.textPrimary)]}>
                {profile?.nickname ?? '小满'}
              </Text>
              <Text modifiers={[font({ size: 14 }), foregroundColor(palette.textSecondary)]}>
                手机号：{maskPhone(session?.user.phone)}
              </Text>
            </VStack>
            <Spacer />
            <Image systemName="chevron.right" size={14} color={palette.textTertiary} />
          </HStack>
        </Section>

        {/* 卡一 记账与数据 */}
        <Section>
          <Row icon="ruler.fill" label="记账设置" onPress={() => router.push('/settings/record' as Href)} />
          <Row icon="square.and.arrow.down" label="导出数据" onPress={() => router.push('/export' as Href)} />
        </Section>

        {/* 卡二 通用 */}
        <Section>
          <Row icon="bell.fill" label="通知设置" onPress={() => router.push('/settings/notifications' as Href)} />
          {/* 深色模式（本轮占位）：selection 固定「跟随系统」，选浅色/深色不改状态、仅提示即将上线。 */}
          <MenuRow
            icon="moon.fill"
            label="深色模式"
            selection="system"
            onSelectionChange={(v) => {
              if (v !== 'system') toast.info('深色模式即将上线，当前跟随系统');
            }}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
          />
          {/* 语言（本轮占位）：selection 固定「简体中文」，选 English 仅提示暂不支持。 */}
          <MenuRow
            icon="globe"
            label="语言"
            selection="zh"
            onSelectionChange={(v) => {
              if (v !== 'zh') toast.info('暂仅支持简体中文');
            }}
            options={[
              { value: 'zh', label: '简体中文' },
              { value: 'en', label: 'English' },
            ]}
          />
        </Section>

        {/* 卡三 帮助与关于 */}
        <Section>
          <Row icon="questionmark.circle.fill" label="帮助中心" onPress={() => router.push('/help' as Href)} />
          <Row icon="text.bubble.fill" label="意见反馈" onPress={() => router.push('/feedback' as Href)} />
          <Row
            icon="info.circle.fill"
            label="关于家账"
            value={APP_VERSION}
            onPress={() => router.push('/about' as Href)}
          />
        </Section>

        {/* 退出登录 */}
        {session ? (
          <Section>
            <HStack alignment="center" modifiers={[contentShape(shapes.rectangle()), onTapGesture(onSignOut)]}>
              <Spacer />
              <Text modifiers={[font({ size: 17, weight: 'semibold' }), foregroundColor(palette.danger)]}>
                退出登录
              </Text>
              <Spacer />
            </HStack>
          </Section>
        ) : null}
      </SettingsList>

      {/* 折叠头覆盖层：不渲染大标题/搜索，仅作背景与安全区让位。 */}
      <View style={[styles.headerClip, { height: headerHeight }]} pointerEvents="none">
        <Animated.View
          style={[styles.header, { backgroundColor: palette.base, paddingTop: insets.top }, headerStyle]}
          onLayout={onHeaderLayout}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  headerClip: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden', zIndex: 10 },
  header: { width: '100%' },
});
