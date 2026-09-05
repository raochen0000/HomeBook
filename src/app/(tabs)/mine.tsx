/**
 * 我的（Tab 4，G1）：账号信息 + 设置入口（PRD §18 / IA §6 G1 / DESIGN §10.5）。
 * 原生 SwiftUI List(insetGrouped) + Section 实现（2026-07-02 按用户要求由 RN 卡片改原生 Form/List）。
 * 入口收敛（PRD §18.1）：原列表「个人信息 / 账号与安全」已并入顶部用户块 → 账号页（G2）。
 * - 顶部用户块整块点击 → push /account（换头像在账号页「头像」行）。
 * - 记账设置 / 导出数据 / 通知设置 / 帮助 / 反馈 / 关于 → push 各子页。
 * - 深色模式 / 语言 → 行内原生菜单式 Picker 下拉；当前值与箭头使用主题次级文字色（语言仅简体中文）。
 * - 退出登录 → 二次确认后登出（真实操作）。
 * 折叠头与首页同款：useManualCollapsibleHeader + 原生 List 的 scrollGeometry 修饰符驱动，
 * 头部只作背景与安全区让位（不渲染标题 / 搜索）。
 */
import { HStack, Image, RNHostView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { contentShape, font, foregroundColor, listRowInsets, onTapGesture, shapes } from '@expo/ui/swift-ui/modifiers';
import { useRouter, type Href } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { useEffect, useState } from 'react';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useMyProfile } from '@/api';
import { alertOk, t, useLocalePreference } from '@/i18n';
import { registerPushDevice } from '@/features/notifications/use-push-registration';
import { UserAvatar } from '@/components/user-avatar';
import { Space, usePalette } from '@/constants/design';
import { useAvatarFiles } from '@/features/home/use-avatar-files';
import { MenuRow, Row, SettingsList } from '@/features/settings/native-list';
import { useManualCollapsibleHeader } from '@/features/shared/use-collapsible-header';
import { useThemePreference, type ThemePreference } from '@/features/settings/theme-preference';
import { signOut, useSession } from '@/lib/auth';

const APP_VERSION = 'v1.0.0';

/** 邮箱脱敏为 r***@gmail.com；无邮箱时显示绑定状态。 */
function maskEmail(email?: string | null): string {
  if (!email) return t('common.notBound');
  const [name, domain] = email.split('@');
  if (!domain) return t('common.bound');
  return `${name.slice(0, 1)}***@${domain}`;
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
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference();
  const { locale, setLocale } = useLocalePreference();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

  const avatarFiles = useAvatarFiles(profile ? [{ id: profile.id, avatar_url: profile.avatar_url }] : []);
  const avatarUri = profile ? (avatarFiles.get(profile.id) ?? null) : null;

  useEffect(() => {
    if (!signOutConfirmOpen || signingOut) return;
    Alert.alert(
      t('settings.signOutTitle'),
      t('settings.signOutConfirm'),
      [
        {
          text: t('common.cancel'),
          style: 'cancel',
          onPress: () => {
            setSignOutConfirmOpen(false);
          },
        },
        {
          text: t('settings.signOut'),
          style: 'destructive',
          onPress: () => {
            setSignOutConfirmOpen(false);
            setSigningOut(true);
            void signOut().catch((e: unknown) => {
              setSigningOut(false);
              Alert.alert(t('settings.signOutFailed'), e instanceof Error ? e.message : String(e), alertOk());
            });
          },
        },
      ],
      {
        onDismiss: () => {
          setSignOutConfirmOpen(false);
        },
      },
    );
  }, [signOutConfirmOpen, signingOut]);

  const onSignOut = () => {
    if (signingOut) return;
    setSignOutConfirmOpen(true);
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
            <RNHostView matchContents>
              <UserAvatar
                avatarUrl={avatarUri ?? profile?.avatar_url}
                nickname={profile?.nickname ?? t('common.user')}
                size={60}
              />
            </RNHostView>
            <VStack alignment="leading" spacing={Space[1]}>
              <Text modifiers={[font({ size: 22, weight: 'semibold' }), foregroundColor(palette.textPrimary)]}>
                {profile?.nickname ?? t('common.user')}
              </Text>
              <Text modifiers={[font({ size: 14 }), foregroundColor(palette.textSecondary)]}>
                {t('settings.emailLine', { email: maskEmail(session?.user.email) })}
              </Text>
            </VStack>
            <Spacer />
            <Image systemName="chevron.right" size={14} color={palette.textTertiary} />
          </HStack>
        </Section>

        {/* 卡一 记账与数据 */}
        <Section>
          <Row
            icon="slider.horizontal.3"
            label={t('settings.recordSettings')}
            onPress={() => router.push('/settings/record' as Href)}
          />
          <Row
            icon="square.and.arrow.down"
            label={t('settings.export')}
            onPress={() => router.push('/export' as Href)}
          />
        </Section>

        {/* 卡二 通用 */}
        <Section>
          <Row
            icon="bell.fill"
            label={t('settings.notifications')}
            onPress={() => router.push('/settings/notifications' as Href)}
          />
          <MenuRow
            icon="moon.fill"
            label={t('settings.appearance')}
            selection={themePreference}
            tintColor={palette.textSecondary}
            onSelectionChange={(value) => setThemePreference(value as ThemePreference)}
            options={[
              { value: 'system', label: t('settings.appearanceSystem') },
              { value: 'light', label: t('settings.appearanceLight') },
              { value: 'dark', label: t('settings.appearanceDark') },
            ]}
          />
          <MenuRow
            icon="globe"
            label={t('settings.language')}
            selection={locale}
            tintColor={palette.textSecondary}
            onSelectionChange={(v) => {
              if (v !== 'zh' && v !== 'en') return;
              setLocale(v);
              void registerPushDevice().catch(() => {});
            }}
            options={[
              { value: 'zh', label: t('settings.languageZh') },
              { value: 'en', label: t('settings.languageEn') },
            ]}
          />
        </Section>

        {/* 卡三 帮助与关于 */}
        <Section>
          <Row icon="questionmark.circle.fill" label={t('help.title')} onPress={() => router.push('/help' as Href)} />
          <Row
            icon="text.bubble.fill"
            label={t('settings.feedback')}
            onPress={() => router.push('/feedback' as Href)}
          />
          <Row
            icon="info.circle.fill"
            label={t('settings.about')}
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
                {t(signingOut ? 'settings.signingOut' : 'settings.signOut')}
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
