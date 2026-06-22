/**
 * 滑动确认控件（流程 5/6 破坏性操作二次确认的最后一道闸）。
 * 用 RN 原生 PanResponder + Animated 实现，无需 GestureHandlerRootView，可稳定用于 Modal 内。
 *
 * 拖动滑块到轨道右端（≥90%）即触发 onConfirm；未到阈值松手则弹回。
 * 失败重置：父层在出错时通过改 key 强制重挂本组件，内部状态自然归零（见 danger-confirm-sheet）。
 */
import { useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, StyleSheet, Text, View } from 'react-native';

import { Radius, Space, usePalette } from '@/constants/design';

const THUMB = 48;
const PAD = 4;

export function SlideToConfirm({
  label,
  enabled,
  busy = false,
  danger = false,
  onConfirm,
}: {
  /** 轨道上的提示文字，如「滑动以确认移除」。 */
  label: string;
  /** 是否可滑动（如「输入文字未匹配」时为 false）。 */
  enabled: boolean;
  /** 确认动作进行中（显示 loading、禁止再拖）。 */
  busy?: boolean;
  danger?: boolean;
  onConfirm: () => void;
}) {
  const palette = usePalette();
  const [trackW, setTrackW] = useState(0);
  const maxX = Math.max(0, trackW - THUMB - PAD * 2);

  // 滑块位移用 lazy useState 创建一次，跨重渲染稳定。
  const [translateX] = useState(() => new Animated.Value(0));

  // panHandlers 每次渲染重建即可：闭包直接读当前 props（始终最新）；进行中的手势仍沿用授予时的处理器，重建无副作用。
  const pan = PanResponder.create({
    onStartShouldSetPanResponder: () => enabled && !busy,
    onMoveShouldSetPanResponder: () => enabled && !busy,
    onPanResponderMove: (_e, g) => translateX.setValue(Math.min(maxX, Math.max(0, g.dx))),
    onPanResponderRelease: (_e, g) => {
      const x = Math.min(maxX, Math.max(0, g.dx));
      if (maxX > 0 && x >= maxX * 0.9) {
        Animated.timing(translateX, { toValue: maxX, duration: 120, useNativeDriver: true }).start(() => onConfirm());
      } else {
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      }
    },
    onPanResponderTerminate: () => {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
    },
  });

  const thumbColor = danger ? palette.danger : palette.accent;

  return (
    <View
      onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      style={[styles.track, { backgroundColor: palette.card, opacity: enabled || busy ? 1 : 0.5 }]}
    >
      <Text style={[styles.label, { color: palette.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      <Animated.View
        {...pan.panHandlers}
        style={[styles.thumb, { backgroundColor: thumbColor, transform: [{ translateX }] }]}
      >
        {busy ? (
          <ActivityIndicator color={palette.onAccent} />
        ) : (
          <Text style={[styles.thumbArrow, { color: palette.onAccent }]}>›</Text>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: THUMB + PAD * 2,
    borderRadius: Radius.full,
    justifyContent: 'center',
    paddingHorizontal: PAD,
    overflow: 'hidden',
  },
  label: { textAlign: 'center', fontSize: 15, fontWeight: '500', marginHorizontal: THUMB },
  thumb: {
    position: 'absolute',
    left: PAD,
    width: THUMB,
    height: THUMB,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbArrow: { fontSize: 26, fontWeight: '700', marginTop: -2, paddingHorizontal: Space[1] },
});
