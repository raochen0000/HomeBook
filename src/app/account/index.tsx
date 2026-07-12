/**
 * G2 账号与安全（PRD §17 / DESIGN §10.4）。原生 SwiftUI List/Section 实现。
 * 分区：个人资料（头像 / 昵称）→ 登录方式（手机 / 邮箱 / Apple，整行 push 各自管理小页）
 * → 密码（修改密码）→ 危险操作（账号注销）。登录方式安全底线改由标题旁 ⓘ Popover 展示，
 * 注销风险提示以行内小字落在「账号注销」右侧（替代原常驻脚注）。
 * 头像换图、昵称编辑已可用；登录方式 / 改密 push 到管理小页；账号注销走 delete_account RPC
 * （软注销：家庭流水保留、成员消失、登录身份删除），触发前须输入「注销」二字二次确认。
 */
import { HStack, Image, Popover, Section, Spacer, Text } from '@expo/ui/swift-ui';
import {
  aspectRatio,
  clipShape,
  contentShape,
  font,
  foregroundColor,
  frame,
  onTapGesture,
  padding,
  resizable,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { useMyProfile, useUpdateMyAvatar, useUpdateMyNickname } from '@/api';
import { Space, usePalette } from '@/constants/design';
import { DangerConfirmSheet } from '@/features/family/danger-confirm-sheet';
import { useAvatarFiles } from '@/features/home/use-avatar-files';
import { Row, SettingsList } from '@/features/settings/native-list';
import { deleteAccount, useSession } from '@/lib/auth';
import { NICKNAME_MAX_LENGTH, NICKNAME_MIN_LENGTH, validateNickname } from '@/lib/profile';

/** +86 手机号脱敏为 138****5678。 */
function maskPhone(e164?: string | null): string {
  if (!e164) return '未绑定';
  const local = e164.replace(/^\+?86/, '');
  if (local.length !== 11) return '已绑定';
  return `${local.slice(0, 3)}****${local.slice(7)}`;
}
/** 邮箱脱敏为 r***@gmail.com。 */
function maskEmail(email?: string | null): string {
  if (!email) return '未绑定';
  const [name, domain] = email.split('@');
  if (!domain) return '已绑定';
  return `${name.slice(0, 1)}***@${domain}`;
}

export default function AccountScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { session } = useSession();
  const { data: profile } = useMyProfile();
  const updateAvatar = useUpdateMyAvatar();
  const updateNickname = useUpdateMyNickname();
  // 「登录方式」两条安全底线：由分组标题旁的 ⓘ 点开 Popover 展示，替代常驻脚注。
  const [loginInfoOpen, setLoginInfoOpen] = useState(false);
  // 账号注销二次确认：输入「我确认注销」+ 危险红滑块（像滑动关机），替代原 Alert 双按钮。
  const [deleteOpen, setDeleteOpen] = useState(false);

  // 头像预下载到本地 file://，供原生 Image uiImage 同步读（与首页流水头像同一链路）。
  const avatarFiles = useAvatarFiles(profile ? [{ id: profile.id, avatar_url: profile.avatar_url }] : []);
  const avatarUri = profile ? (avatarFiles.get(profile.id) ?? null) : null;

  const user = session?.user;
  const hasApple = user?.identities?.some((i) => i.provider === 'apple') ?? false;

  const onChangeAvatar = () => {
    if (!profile?.id || updateAvatar.isPending) return;
    updateAvatar.mutate(profile.id, {
      onError: (e) => Alert.alert('头像更新失败', (e as Error).message ?? String(e)),
    });
  };

  const onEditNickname = () => {
    Alert.prompt(
      '修改昵称',
      `请输入 ${NICKNAME_MIN_LENGTH}-${NICKNAME_MAX_LENGTH} 个字符`,
      (text) => {
        const v = text?.trim();
        if (!v || v === profile?.nickname) return;
        const invalid = validateNickname(v);
        if (invalid) {
          Alert.alert('昵称不符合要求', invalid);
          return;
        }
        updateNickname.mutate(v, { onError: (e) => Alert.alert('保存失败', (e as Error).message ?? String(e)) });
      },
      'plain-text',
      profile?.nickname ?? '',
    );
  };

  // 二次销毁确认：打开危险确认弹层（输入「我确认注销」解锁滑块）。成功后会话失效，
  // onAuthStateChange 自动把用户导航回登录页，无需手动跳转。
  const onDeleteAccount = () => setDeleteOpen(true);

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: '账号与安全' }} />
      <SettingsList>
        {/* 个人资料 */}
        <Section>
          <HStack
            alignment="center"
            spacing={Space[3]}
            modifiers={[contentShape(shapes.rectangle()), onTapGesture(onChangeAvatar)]}
          >
            <Text modifiers={[font({ size: 16 }), foregroundColor(palette.textPrimary)]}>头像</Text>
            <Spacer />
            {avatarUri ? (
              <Image
                uiImage={avatarUri}
                modifiers={[
                  resizable(),
                  aspectRatio({ contentMode: 'fill' }),
                  frame({ width: 32, height: 32 }),
                  clipShape('circle'),
                ]}
              />
            ) : (
              <Image systemName="person.crop.circle.fill" size={30} color={palette.textTertiary} />
            )}
            <Image systemName="chevron.right" size={13} color={palette.textTertiary} />
          </HStack>
          <HStack
            alignment="center"
            spacing={Space[3]}
            modifiers={[contentShape(shapes.rectangle()), onTapGesture(onEditNickname)]}
          >
            <Text modifiers={[font({ size: 16 }), foregroundColor(palette.textPrimary)]}>昵称</Text>
            <Spacer />
            <Text modifiers={[font({ size: 15 }), foregroundColor(palette.textSecondary)]}>
              {profile?.nickname ?? '—'}
            </Text>
            <Image systemName="chevron.right" size={13} color={palette.textTertiary} />
          </HStack>
        </Section>

        {/* 登录方式：标题旁 ⓘ 点开 Popover 展示两条安全底线（替代原常驻脚注）。 */}
        <Section
          header={
            <HStack alignment="center" spacing={Space[1]}>
              <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>登录方式</Text>
              <Popover isPresented={loginInfoOpen} onIsPresentedChange={setLoginInfoOpen} arrowEdge="top">
                <Popover.Trigger>
                  <Image
                    systemName="info.circle"
                    size={14}
                    color={palette.textTertiary}
                    modifiers={[contentShape(shapes.rectangle()), onTapGesture(() => setLoginInfoOpen(true))]}
                  />
                </Popover.Trigger>
                <Popover.Content>
                  <Text
                    modifiers={[
                      font({ size: 14 }),
                      foregroundColor(palette.textPrimary),
                      padding({ all: Space[4] }),
                      frame({ maxWidth: 260 }),
                    ]}
                  >
                    账号需至少保留一种登录方式；仅剩一种时该方式不可解绑。换绑 / 解绑等敏感操作需先验证身份。
                  </Text>
                </Popover.Content>
              </Popover>
              <Spacer />
            </HStack>
          }
        >
          <Row
            icon="iphone"
            label="手机号"
            value={maskPhone(user?.phone)}
            onPress={() => router.push('/account/phone' as Href)}
          />
          <Row
            icon="envelope.fill"
            label="邮箱"
            value={maskEmail(user?.email)}
            onPress={() => router.push('/account/email' as Href)}
          />
          <Row
            icon="apple.logo"
            label="Apple"
            value={hasApple ? '已连接' : '未连接'}
            onPress={() => router.push('/account/apple' as Href)}
          />
        </Section>

        {/* 密码 */}
        <Section>
          <Row icon="lock.fill" label="修改密码" onPress={() => router.push('/account/password' as Href)} />
        </Section>

        {/* 危险操作：风险提示以行内小字落在「账号注销」右侧（替代原常驻脚注）。 */}
        <Section>
          <Row
            icon="person.crop.circle.badge.xmark"
            label="账号注销"
            danger
            value="注销将永久删除，不可恢复"
            valueSize={12}
            onPress={onDeleteAccount}
          />
        </Section>
      </SettingsList>

      {/* 账号注销二次确认：输入「我确认注销」解锁危险红滑块，滑到底执行（像滑动关机）。 */}
      <DangerConfirmSheet
        visible={deleteOpen}
        title="账号注销"
        message="注销后手机号、邮箱、密码等账号数据将被永久删除、不可恢复；你在家庭中的流水会保留给其他成员查看。"
        matchLabel="请输入「我确认注销」进行确认操作"
        matchValue="我确认注销"
        slideLabel="滑动以确认注销"
        onConfirm={deleteAccount}
        onClose={() => setDeleteOpen(false)}
      />
    </View>
  );
}
