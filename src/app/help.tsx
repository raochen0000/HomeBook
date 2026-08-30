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
import { t } from '@/i18n';

export default function HelpScreen() {
  const palette = usePalette();
  const router = useRouter();
  const faq = [
    {
      group: t('help.groups.record'),
      items: [
        { q: t('help.q1'), a: t('help.a1') },
        { q: t('help.q2'), a: t('help.a2') },
        { q: t('help.q3'), a: t('help.a3') },
      ],
    },
    {
      group: t('help.groups.family'),
      items: [
        { q: t('help.q4'), a: t('help.a4') },
        { q: t('help.q5'), a: t('help.a5') },
      ],
    },
    {
      group: t('help.groups.account'),
      items: [
        { q: t('help.q6'), a: t('help.a6') },
        { q: t('help.q7'), a: t('help.a7') },
      ],
    },
    {
      group: t('help.groups.privacy'),
      items: [
        { q: t('help.q8'), a: t('help.a8') },
        { q: t('help.q9'), a: t('help.a9') },
      ],
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: t('help.title') }} />
      <SettingsList>
        {faq.map((section) => (
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
            <Text modifiers={[font({ size: 15 }), foregroundColor(palette.accent)]}>{t('help.goFeedback')}</Text>
            <Image systemName="chevron.right" size={12} color={palette.accent} />
            <Spacer />
          </HStack>
        </Section>
      </SettingsList>
    </View>
  );
}
