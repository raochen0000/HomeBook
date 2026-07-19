/**
 * 分类占比环形图（DESIGN §5.7）。用已安装的 react-native-svg 自绘，避免再引入 Skia/Victory
 * 触发又一次原生重编。每段用 strokeDasharray 画弧，旋转 -90° 让起点在 12 点方向。
 */
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

export type DonutSlice = { value: number; color: string };

export function Donut({
  slices,
  size = 184,
  strokeWidth = 28,
  trackColor,
  children,
  onSlicePress,
  accessibilityLabel,
}: {
  slices: DonutSlice[];
  size?: number;
  strokeWidth?: number;
  /** 无数据时的底环颜色。 */
  trackColor: string;
  /** 圆心内容（总额等）。 */
  children?: ReactNode;
  /** 点击某个扇区，用于报表显示精确值。 */
  onSlicePress?: (index: number) => void;
  accessibilityLabel?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const total = slices.reduce((s, x) => s + x.value, 0);
  const cx = size / 2;

  let acc = 0;
  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
    >
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${cx}, ${cx}`}>
          {total <= 0 ? (
            <Circle cx={cx} cy={cx} r={r} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
          ) : (
            slices.map((s, i) => {
              const len = (s.value / total) * circ;
              const el = (
                <Circle
                  key={i}
                  cx={cx}
                  cy={cx}
                  r={r}
                  stroke={s.color}
                  strokeWidth={strokeWidth}
                  fill="none"
                  strokeDasharray={[len, circ - len]}
                  strokeDashoffset={-acc}
                  strokeLinecap="butt"
                  onPress={onSlicePress ? () => onSlicePress(i) : undefined}
                />
              );
              acc += len;
              return el;
            })
          )}
        </G>
      </Svg>
      <View style={styles.center} pointerEvents="none">
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
