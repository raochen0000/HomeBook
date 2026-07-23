/**
 * 全局轻提示（iOS 无原生 toast，这里用贴近系统 HUD 观感的深色胶囊 + 自动消失实现）。
 *
 * 用法：任意位置 `import { toast } from '@/components/toast'` 后 `toast.success('已记一笔')`，
 * 不必在每个页面维护 `useState` 或手挂组件。四态按语义区分图标 + 颜色：
 *   success（成功勾）/ error（叹号圈）/ info（i 圈·蓝）/ warning（三角·琥珀）。
 *
 * 单例队列：新提示**替换**当前提示（按 id 重挂动画），避免同页连续提示互相打断而丢失。
 * `<ToastHost />` 在根布局挂一次（见 app/_layout.tsx），置于所有覆盖层之上。
 *
 * HUD 材质随主题适配（同 iOS 系统 HUD）：浅色=浅磨砂 + 近黑字，深色=深磨砂 + 白字。
 * 文字色直接取 `palette.textPrimary`（本就随主题反相），图标走语义令牌，两个主题都够辨识。
 */
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Space, usePalette } from '@/constants/design';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

type ToastItem = { id: number; kind: ToastKind; text: string; duration: number };
type ToastOptions = { duration?: number };

// ── 单例事件通道 ──────────────────────────────────────────────────────────────
// 模块级 listener 由挂载的 <ToastHost/> 注册，故 toast.* 可在 React 组件外（如 mutation
// 的 onError 回调）直接调用。未挂载 Host 时为 no-op（不会崩，只是不显示）。
let listener: ((item: ToastItem) => void) | null = null;
let seq = 0;

// 触觉反馈（DESIGN §9.10：成功 / 达成给 success haptic）。info 不震（纯说明性，避免噪扰）。
const HAPTIC: Record<ToastKind, Haptics.NotificationFeedbackType | null> = {
  success: Haptics.NotificationFeedbackType.Success,
  error: Haptics.NotificationFeedbackType.Error,
  warning: Haptics.NotificationFeedbackType.Warning,
  info: null,
};

function emit(kind: ToastKind, text: string, opts?: ToastOptions) {
  if (!text || !listener) return;
  const h = HAPTIC[kind];
  if (h) Haptics.notificationAsync(h).catch(() => {});
  listener({ id: ++seq, kind, text, duration: opts?.duration ?? 3000 });
}

export const toast = {
  success: (text: string, opts?: ToastOptions) => emit('success', text, opts),
  error: (text: string, opts?: ToastOptions) => emit('error', text, opts),
  info: (text: string, opts?: ToastOptions) => emit('info', text, opts),
  warning: (text: string, opts?: ToastOptions) => emit('warning', text, opts),
};

/** 便捷 hook：返回同一个单例（供偏好 hook 形态的调用点）。 */
export function useToast() {
  return toast;
}

// ── 各态外观 ─────────────────────────────────────────────────────────────────
const KIND: Record<ToastKind, { symbol: SymbolViewProps['name']; tint: (p: ReturnType<typeof usePalette>) => string }> =
  {
    success: { symbol: 'checkmark.circle.fill', tint: (p) => p.success },
    error: { symbol: 'exclamationmark.circle.fill', tint: (p) => p.danger },
    info: { symbol: 'info.circle.fill', tint: (p) => p.info },
    warning: { symbol: 'exclamationmark.triangle.fill', tint: (p) => p.warning },
  };

/**
 * 根级挂载点：订阅单例通道并渲染当前提示。放在所有覆盖层之上（顶部安全区下方）。
 */
export function ToastHost() {
  const [item, setItem] = useState<ToastItem | null>(null);

  useEffect(() => {
    listener = (next) => setItem(next);
    return () => {
      listener = null;
    };
  }, []);

  if (!item) return null;
  // key=id：同类提示连发时也重挂组件，重放入场动画 + 重置自动消失计时。
  return <ToastView key={item.id} item={item} onHide={() => setItem(null)} />;
}

function ToastView({ item, onHide }: { item: ToastItem; onHide: () => void }) {
  const palette = usePalette();
  const isDark = useColorScheme() === 'dark';
  const insets = useSafeAreaInsets();
  // Animated.Value 只在挂载时建一次（惰性 useState，避免在 render 期读 ref.current）。
  const [translateY] = useState(() => new Animated.Value(-24));
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
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
    }, item.duration);

    return () => clearTimeout(timer);
    // translateY/opacity 惰性建一次即稳定；onHide 每次由 key 重挂重跑，仅随 item 变化调度。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.duration]);

  const { symbol, tint } = KIND[item.kind];

  return (
    <Animated.View
      pointerEvents="none"
      // VoiceOver 播报：错误态 assertive（打断当前播报），其余 polite。
      accessibilityLiveRegion={item.kind === 'error' ? 'assertive' : 'polite'}
      style={[styles.wrap, { top: insets.top + Space[2], opacity, transform: [{ translateY }] }]}
    >
      {/*
       * 阴影层与材质层分开：iOS 上同一视图不能既 overflow:hidden（圆角裁切 BlurView）
       * 又投阴影（masksToBounds 会连阴影一起裁掉）。外层只投阴影，内层 BlurView 负责圆角 + 毛玻璃。
       */}
      <View style={styles.shadow}>
        <BlurView
          tint={isDark ? 'dark' : 'light'}
          // 浅玻璃偏虚，加厚 intensity 才够「实」；深玻璃 50 即够。
          intensity={isDark ? 50 : 75}
          style={[
            styles.pill,
            {
              // 薄底：给磨砂加一层同色调、够白字/黑字对比的身板。
              backgroundColor: isDark ? 'rgba(28,28,30,0.5)' : 'rgba(245,245,247,0.6)',
              // 发丝边：让玻璃在纯白/纯黑页面上有清晰边界。
              borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
            },
          ]}
        >
          <SymbolView name={symbol} tintColor={tint(palette)} size={18} />
          <Text style={[styles.text, { color: palette.textPrimary }]} accessibilityRole="text">
            {item.text}
          </Text>
        </BlurView>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 100 },
  // 阴影层（elevation/1，DESIGN §7 浮层档）——不裁切，故阴影不被 masksToBounds 吃掉。
  shadow: {
    borderRadius: Radius.full,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  // 材质层：毛玻璃 + 薄底 + 发丝边随主题在行内给（见 ToastView）。
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space[2],
    paddingHorizontal: Space[4],
    paddingVertical: Space[3],
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  text: { fontSize: 15, fontWeight: '600' },
});
