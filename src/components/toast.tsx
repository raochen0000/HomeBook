/**
 * 顶部轻提示（iOS 无原生 toast 组件，这里用贴近系统观感的深色胶囊 + 自动消失实现）。
 * 放在页面顶部安全区下方，淡入下滑出现，约 1.6s 后自动淡出上滑收起。
 */
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Space } from '@/constants/design';

export type ToastProps = {
  visible: boolean;
  text: string;
  /** 提示消失后回调，父级据此把 visible 置回 false。 */
  onHide: () => void;
  /** 停留时长（ms），默认 1600。 */
  duration?: number;
};

export function Toast({ visible, text, onHide, duration = 1600 }: ToastProps) {
  const insets = useSafeAreaInsets();
  // Animated.Value 只在挂载时建一次（惰性 useState，避免在 render 期读 ref.current）。
  const [translateY] = useState(() => new Animated.Value(-24));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!visible) return;
    translateY.setValue(-24);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8, tension: 80 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -24, duration: 180, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) onHide();
      });
    }, duration);

    return () => clearTimeout(timer);
    // onHide 在父级用 useCallback 稳定；仅在 visible 变化时重新调度。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, duration]);

  if (!visible) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + Space[2], opacity, transform: [{ translateY }] }]}
    >
      <Animated.View style={styles.pill}>
        <SymbolView name="checkmark.circle.fill" tintColor="#34C759" size={18} />
        <Text style={styles.text}>{text}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
    borderRadius: Radius.full,
    backgroundColor: 'rgba(0,0,0,0.82)',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});
