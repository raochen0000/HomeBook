/**
 * 滚动折叠头部（位置驱动 + 绝对定位覆盖层）。
 *
 * 设计要点：头部用「绝对定位覆盖层」而非参与布局的元素——这样头部的位移/淡出
 * 不会改变滚动容器的 frame，避免「头部高度 ↔ 滚动偏移」的布局反馈环（否则会出现
 * 滚回顶部标题不复现的问题）。内容用 paddingTop 让位，头部在 [0, 头高] 行程内
 * 随偏移上移并淡出；越接近顶部越显现。
 *
 * 头部背景应与页面底色一致（palette.base），淡出时露出的是同色页面底，视觉无缝。
 *
 * 两个入口：
 * - useCollapsibleHeader：RN 滚动页（报表/家庭），内部用 useScrollViewOffset 取偏移。
 * - useManualCollapsibleHeader：@expo/ui 原生 ScrollView（首页），偏移由调用方用
 *   useScrollGeometryChange 的 worklet 写入返回的 offset 共享值。
 */
import { useScrollGeometryChange } from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useScrollViewOffset,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';

/**
 * 透明度在收起到 45% 行程时归零，使标题在行程前半段就淡净。
 * 比例越小，淡出越靠前，「停在半透明中间态」的可视时间越短——避免连续淡出在
 * 滚动停顿时露出「半透明卡住、像没做完」的中间状态。
 */
const FADE_RATIO = 0.45;

function useHeaderStyle(offset: SharedValue<number>, estimatedHeight: number, topInset = 0) {
  // headerHeight（state）既供内容 paddingTop / 裁切容器高度，也被 useAnimatedStyle 闭包捕获，
  // 量到真实高度后（仅一次）触发 worklet 重建；per-frame 由 offset 驱动。
  const [measuredHeight, setMeasuredHeight] = useState(0);
  const headerHeight = Math.max(measuredHeight, estimatedHeight);

  const headerStyle = useAnimatedStyle(() => {
    const h = headerHeight || estimatedHeight;
    // SwiftUI List/ScrollView 在不同内容态下顶部 offset 可能是 -topInset，也可能是 0。
    // 只在负 offset 时加回安全区，保证「停靠顶部」稳定归一化为 0，避免首帧把标题推到状态栏下。
    const progress = Math.max(0, offset.value < 0 ? offset.value + topInset : offset.value);
    return {
      transform: [{ translateY: interpolate(progress, [0, h], [0, -h], Extrapolation.CLAMP) }],
      opacity: interpolate(progress, [0, h * FADE_RATIO], [1, 0], Extrapolation.CLAMP),
    };
  });

  const onHeaderLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && Math.abs(h - measuredHeight) > 0.5) setMeasuredHeight(h);
  };

  return { headerHeight, headerStyle, onHeaderLayout };
}

export function useCollapsibleHeader(estimatedHeight = 84) {
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const offset = useScrollViewOffset(scrollRef);
  return { scrollRef, ...useHeaderStyle(offset, estimatedHeight) };
}

export function useManualCollapsibleHeader(estimatedHeight = 84, topInset = 0) {
  const offset = useSharedValue(0);
  // iOS 18+ 原生滚动几何回调（worklet 跑在 UI 线程，直接写入 offset 驱动头部折叠）。
  // iOS 18 以下返回 null（修饰符 no-op），头部保持常驻、不折叠。
  // 写入原始 contentOffsetY；安全区偏移的归一化（+ topInset）在 useHeaderStyle 内完成。
  const scrollGeometry = useScrollGeometryChange((g) => {
    'worklet';
    offset.value = g.contentOffsetY;
  });
  return { scrollGeometry, ...useHeaderStyle(offset, estimatedHeight, topInset) };
}
