/**
 * G12 通知设置（PRD §18.3.3 / 流程 13 §15 / DESIGN §10.5）。原生 SwiftUI List/Section 实现。
 *
 * 顶部权限引导条：读真实系统授权态（usePushPermission）——未授权且可弹框 → 点按弹系统授权框；
 *   已拒（不可再弹）→ 点按跳系统设置；已授权 → 展示「已开启」并可点按去系统设置管理。
 *   远程推送投递（APNs token + 服务端发送）属层级二，另行接入（PRD §18.3.3）。
 * 分类开关：家庭动态 / 预算超支预警 / 储蓄目标进展 / 月度总结提醒 / 成员与邀请变动 / 账号安全，
 *   六类服务端持久化（notification_preferences，见 DATAMODEL §5.6）——直读 + upsert，乐观更新。
 *   本页只做开关面板，触达规则以流程 13（§15）为准；关掉某类仅停系统推送，App 内通知中心仍可见。
 */
import { HStack, Image, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { contentShape, font, foregroundColor, onTapGesture, shapes } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { Linking, View } from 'react-native';

import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_CATEGORY_KEYS,
  useNotificationPrefs,
  useSaveNotificationPrefs,
  type NotificationCategoryKey,
} from '@/api';
import { Space, usePalette } from '@/constants/design';
import { usePushPermission } from '@/features/notifications/use-push-permission';
import { Caption, SettingsList, ToggleRow } from '@/features/settings/native-list';

type IconName = ComponentProps<typeof Image>['systemName'];

/** 分类展示元数据（图标 + 文案）；键序由 NOTIFICATION_CATEGORY_KEYS 决定。 */
const CATEGORY_META: Record<NotificationCategoryKey, { icon: IconName; label: string }> = {
  family_activity: { icon: 'house.fill', label: '家庭动态' },
  budget_alert: { icon: 'exclamationmark.triangle.fill', label: '预算超支预警' },
  savings_progress: { icon: 'target', label: '储蓄目标进展' },
  monthly_summary: { icon: 'doc.text.fill', label: '月度总结提醒' },
  member_change: { icon: 'person.2.fill', label: '成员与邀请变动' },
  account_security: { icon: 'lock.shield.fill', label: '账号安全' },
};

export default function NotificationSettingsScreen() {
  const palette = usePalette();
  const { data } = useNotificationPrefs();
  const save = useSaveNotificationPrefs();
  const { granted, canAskAgain, request } = usePushPermission();

  // 加载中 / 行不存在时回落全开默认；乐观更新让开关即时响应。
  const prefs = data ?? DEFAULT_NOTIFICATION_PREFS;

  // 引导条点按：从未问过 → 弹系统授权框（弹后若被拒则转跳系统设置）；
  // 已拒 / 已授权 → 直接跳系统设置（去开启或管理）。
  const onPressPermission = async () => {
    if (!granted && canAskAgain) {
      const res = await request();
      if (res && !res.granted && !res.canAskAgain) Linking.openSettings();
      return;
    }
    Linking.openSettings();
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: '通知设置' }} />
      <SettingsList>
        {/* 系统推送权限引导条：据真实授权态显隐「去开启」/「已开启」。 */}
        <Section>
          <HStack
            alignment="center"
            spacing={Space[3]}
            modifiers={[contentShape(shapes.rectangle()), onTapGesture(onPressPermission)]}
          >
            <Image systemName={granted ? 'checkmark.circle.fill' : 'app.badge'} size={19} color={palette.info} />
            <VStack alignment="leading" spacing={Space[1]}>
              <Text modifiers={[font({ size: 16 }), foregroundColor(palette.textPrimary)]}>系统推送</Text>
              <Text modifiers={[font({ size: 12 }), foregroundColor(palette.textSecondary)]}>
                {granted ? '已开启，可在系统设置中管理' : '尚未开启，点此开启系统推送'}
              </Text>
            </VStack>
            <Spacer />
            {granted ? null : (
              <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundColor(palette.info)]}>去开启</Text>
            )}
            <Image systemName="chevron.right" size={13} color={palette.textTertiary} />
          </HStack>
        </Section>

        {/* 分类开关（六类，服务端持久化）。 */}
        <Section title="接收以下通知">
          {NOTIFICATION_CATEGORY_KEYS.map((key) => {
            const meta = CATEGORY_META[key];
            return (
              <ToggleRow
                key={key}
                icon={meta.icon}
                label={meta.label}
                value={prefs[key]}
                onValueChange={(v) => save.mutate({ ...prefs, [key]: v })}
              />
            );
          })}
        </Section>

        <Caption text="关闭后仍可在 App 内的通知中心查看该类消息，仅不再收到系统推送提醒。" />
      </SettingsList>
    </View>
  );
}
