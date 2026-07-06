/**
 * G17 关于家账（PRD §18.3.8 / DESIGN §10.5）。原生 SwiftUI List/Section 实现。
 * Logo + 版本 + 检查更新；用户协议 / 隐私政策 = 内置页 + 底部 Sheet（右上角 X 关闭，复用 B2 · RN Modal）；
 * 给我们评分 / 分享给朋友 / 版权。评分依赖 expo-store-review（未安装）→ 暂以提示兜底。
 */
import { HStack, RNHostView, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundColor, listRowBackground, listRowSeparator } from '@expo/ui/swift-ui/modifiers';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Share, View } from 'react-native';

import { Space, usePalette } from '@/constants/design';
import { LegalSheet, type LegalKind } from '@/features/settings/legal-sheet';
import { Row, SettingsList } from '@/features/settings/native-list';

const APP_VERSION = 'v1.0.0';

export default function AboutScreen() {
  const palette = usePalette();
  const [legal, setLegal] = useState<LegalKind | null>(null);

  const onShare = () => {
    Share.share({ message: '家账 · 一家人一起记账，账目清清楚楚。' }).catch(() => {});
  };
  const onRate = () => Alert.alert('给我们评分', '应用上架后即可在 App Store 评分，敬请期待。');
  const onCheckUpdate = () => Alert.alert('检查更新', '当前已是最新版本。');

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: '关于家账' }} />
      <SettingsList>
        {/* 品牌头 */}
        <Section modifiers={[listRowBackground(palette.base), listRowSeparator('hidden')]}>
          <HStack alignment="center">
            <Spacer />
            <VStack spacing={Space[2]}>
              <RNHostView matchContents>
                <Image
                  source={require('@/assets/expo.icon/Assets/homebook-Icon-appstore-1024.png')}
                  style={{ width: 84, height: 84, borderRadius: 18 }}
                  contentFit="contain"
                />
              </RNHostView>
              <Text modifiers={[font({ size: 24, weight: 'bold' }), foregroundColor(palette.textPrimary)]}>家账</Text>
              <Text modifiers={[font({ size: 14 }), foregroundColor(palette.textSecondary)]}>{APP_VERSION}</Text>
            </VStack>
            <Spacer />
          </HStack>
        </Section>

        <Section>
          <Row icon="arrow.triangle.2.circlepath" label="检查更新" value={APP_VERSION} onPress={onCheckUpdate} />
        </Section>

        <Section>
          <Row icon="doc.text.fill" label="用户协议" onPress={() => setLegal('terms')} />
          <Row icon="hand.raised.fill" label="隐私政策" onPress={() => setLegal('privacy')} />
        </Section>

        <Section>
          <Row icon="star.fill" label="给我们评分" onPress={onRate} />
          <Row icon="square.and.arrow.up" label="分享给朋友" onPress={onShare} />
        </Section>

        <Section modifiers={[listRowBackground(palette.base), listRowSeparator('hidden')]}>
          <HStack alignment="center">
            <Spacer />
            <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textTertiary)]}>
              © 2026 家账 · 用心记录每一笔
            </Text>
            <Spacer />
          </HStack>
        </Section>
      </SettingsList>

      <LegalSheet kind={legal} onClose={() => setLegal(null)} />
    </View>
  );
}
