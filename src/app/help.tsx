/**
 * G15 帮助中心（PRD §18.3.6）：原生 SwiftUI List + DisclosureGroup 折叠 FAQ；底部挂「去意见反馈」。
 * 内容为本地静态数据（免部署、可离线）。
 */
import { DisclosureGroup, HStack, Image, Section, Spacer, Text } from '@expo/ui/swift-ui';
import {
  contentShape,
  font,
  foregroundColor,
  listRowBackground,
  listRowSeparator,
  onTapGesture,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { Stack, useRouter, type Href } from 'expo-router';
import { View } from 'react-native';

import { Space, usePalette } from '@/constants/design';
import { SettingsList } from '@/features/settings/native-list';

type QA = { q: string; a: string };
const FAQ: { group: string; items: QA[] }[] = [
  {
    group: '记账',
    items: [
      { q: '怎么快速记一笔？', a: '在任意页点右下角「＋」浮钮，输入金额即可保存，分类 / 时间 / 备注都可留空。' },
      { q: '记错了能改吗？', a: '可以。在首页流水列表点开该条，或左滑选择「编辑 / 删除」。' },
      { q: '收入为什么是红色、支出是绿色？', a: '家账沿用中国大陆「红涨绿跌」的惯例：红=收入、绿=支出。' },
    ],
  },
  {
    group: '家庭',
    items: [
      {
        q: '怎么邀请家人？',
        a: '在「家庭」页点「邀请家人」，把 6 位邀请码或二维码发给对方，对方输入 / 扫码即可加入。',
      },
      { q: '一个人能加入几个家庭？', a: '同时只能属于一个家庭；加入新家庭会自动退出当前家庭。' },
    ],
  },
  {
    group: '账号',
    items: [
      { q: '换手机号了怎么办？', a: '在「我的 → 账号与安全 → 手机号」里换绑：先验证旧号，再验证新号。' },
      { q: '怎么注销账号？', a: '在「账号与安全」页底部「账号注销」，按提示完成；注销后数据永久删除、不可恢复。' },
    ],
  },
  {
    group: '隐私',
    items: [
      { q: '家人能看到我记的账吗？', a: '同一家庭的账本是共享的，家庭成员都能看到；退出家庭后你将看不到原家庭数据。' },
      { q: '我的数据安全吗？', a: '记账数据归属于家庭，权限边界清晰；你可随时导出或注销。详见隐私政策。' },
    ],
  },
];

export default function HelpScreen() {
  const palette = usePalette();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: '帮助中心' }} />
      <SettingsList>
        {FAQ.map((section) => (
          <Section key={section.group} title={section.group}>
            {section.items.map((item, i) => (
              <DisclosureGroup key={`${section.group}-${i}`} label={item.q}>
                <Text modifiers={[font({ size: 14 }), foregroundColor(palette.textSecondary)]}>{item.a}</Text>
              </DisclosureGroup>
            ))}
          </Section>
        ))}
        <Section modifiers={[listRowBackground(palette.base), listRowSeparator('hidden')]}>
          <HStack
            alignment="center"
            spacing={Space[2]}
            modifiers={[contentShape(shapes.rectangle()), onTapGesture(() => router.push('/feedback' as Href))]}
          >
            <Spacer />
            <Image systemName="text.bubble.fill" size={16} color={palette.accent} />
            <Text modifiers={[font({ size: 16 }), foregroundColor(palette.accent)]}>没解决？去意见反馈</Text>
            <Spacer />
          </HStack>
        </Section>
      </SettingsList>
    </View>
  );
}
