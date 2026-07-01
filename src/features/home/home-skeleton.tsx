/**
 * 首页加载骨架：脉搏卡 + 两个按日分组的占位，替代原先的转圈 loading。
 * 纯 RN + reanimated 自绘（呼吸式透明度脉动），不依赖额外骨架库。
 */
import { useEffect } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Radius, Space, usePalette } from '@/constants/design';

/** 单个占位块：圆角灰条，颜色取自 palette.separator，整体由父层做脉动。 */
function Block({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const palette = usePalette();
  return <View style={[{ backgroundColor: palette.separator, borderRadius: Radius.sm }, style]} />;
}

/** 一行流水占位：圆角方图标 + 两行文字条 + 右侧金额条。 */
function RowSkeleton() {
  return (
    <View style={styles.row}>
      <Block style={styles.rowIcon} />
      <View style={styles.rowText}>
        <View style={styles.rowLine}>
          <Block style={{ width: 96, height: 16 }} />
          <Block style={{ width: 72, height: 16 }} />
        </View>
        <View style={styles.rowLine}>
          <Block style={{ width: 40, height: 12 }} />
          <Block style={{ width: 56, height: 12 }} />
        </View>
      </View>
    </View>
  );
}

/** 一个按日分组占位：日期头 + 白卡内三行。 */
function GroupSkeleton() {
  const palette = usePalette();
  return (
    <View style={styles.group}>
      <View style={styles.groupHeader}>
        <Block style={{ width: 48, height: 13 }} />
        <Block style={{ width: 80, height: 13 }} />
      </View>
      <View style={[styles.card, { backgroundColor: palette.card }]}>
        <RowSkeleton />
        <View style={[styles.sep, { backgroundColor: palette.separator }]} />
        <RowSkeleton />
        <View style={[styles.sep, { backgroundColor: palette.separator }]} />
        <RowSkeleton />
      </View>
    </View>
  );
}

export function HomeSkeleton({ topPadding = 0 }: { topPadding?: number }) {
  const palette = usePalette();
  const pulse = useSharedValue(0.5);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View style={[styles.container, { paddingTop: topPadding }, pulseStyle]}>
      {/* 脉搏卡占位 */}
      <View style={[styles.card, styles.pulse, { backgroundColor: palette.card }]}>
        <Block style={{ width: 88, height: 15 }} />
        <Block style={{ width: 160, height: 34, marginTop: Space[3] }} />
        <Block style={{ width: '100%', height: 8, marginTop: Space[3], borderRadius: Radius.full }} />
        <Block style={{ width: 200, height: 12, marginTop: Space[2] }} />
      </View>
      <GroupSkeleton />
      <GroupSkeleton />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: Space[4], gap: Space[5] },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  pulse: { padding: Space[4] },
  group: { gap: Space[2] },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Space[1] },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space[3], padding: Space[4] },
  rowIcon: { width: 44, height: 44, borderRadius: Radius.md },
  rowText: { flex: 1, gap: Space[2] },
  rowLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 70 },
});
