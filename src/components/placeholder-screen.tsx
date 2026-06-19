import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Space, usePalette } from '@/constants/design';

/** 占位页：统一的标题栏 + 居中提示，供尚未实现的 Tab 复用。 */
export function PlaceholderScreen({
  title,
  symbol,
  note = '开发中',
}: {
  title: string;
  symbol: SymbolViewProps['name'];
  note?: string;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.root, { backgroundColor: palette.base }]}>
      <SafeAreaView edges={['top']} style={styles.flex}>
        <View style={styles.header}>
          <ThemedText style={[styles.title, { color: palette.textPrimary }]}>{title}</ThemedText>
        </View>
        <View style={styles.center}>
          <SymbolView name={symbol} tintColor={palette.textTertiary} size={48} />
          <ThemedText style={{ color: palette.textSecondary }}>{note}</ThemedText>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Space[3] },
  header: { paddingHorizontal: Space[4], paddingTop: Space[2], paddingBottom: Space[3] },
  title: { fontSize: 34, fontWeight: '700' },
});
