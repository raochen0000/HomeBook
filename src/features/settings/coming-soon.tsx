/**
 * 子页占位（本轮先搭导航壳、内容下一轮补）。
 * 每个占位路由渲染它，使「我的」及账号页的每一行都能真实 push 到一个带原生返回头的页面，
 * 导航链路先跑通；具体表单/交互随后替换本组件。
 */
import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Space, usePalette } from '@/constants/design';

export function ComingSoon({ title, note }: { title: string; note?: string }) {
  const palette = usePalette();
  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <Stack.Screen options={{ headerShown: true, title }} />
      <SymbolView name="hammer.fill" tintColor={palette.textTertiary} size={40} />
      <ThemedText style={[styles.text, { color: palette.textSecondary }]}>
        {note ?? '该功能正在开发中，敬请期待'}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[3], padding: Space[6] },
  text: { fontSize: 15, textAlign: 'center' },
});
