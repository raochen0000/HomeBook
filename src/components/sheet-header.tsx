/**
 * pageSheet 统一标题区（DESIGN §9.9）：悬浮于内容之上、渐进式透明模糊底、标题居中。
 * 内容上滑时从标题区下方穿过，透出渐隐模糊（参考 iOS 提醒事项「详细信息」的 scroll-edge 观感）。
 *
 * 三形态（按数据提交方式选择）：
 * - 纯标题（默认，不传任何回调）：自动保存型 / 纯预览型——无按钮，关闭靠下滑手势；
 * - 返回态（onBack）：单壳内子视图（编辑器 / 详情）左侧圆形返回按钮，语义为退回上一视图；
 * - 确认态（onConfirm）：显式保存型——左 ✕（onClose，放弃并关闭）或返回（onBack）+ 右 ✓（提交）。
 *
 * 按钮为原生 SwiftUI 圆形玻璃按钮（buttonStyle glass / glassProminent）；✓ 用主题 `ink` 色
 * （非 iOS 蓝），禁用时由系统置灰。左右各占 44pt 定宽槽位，标题保持严格居中。
 *
 * 使用：置于 sheet 根视图的**最后一个子元素**（浮层最后渲染）；滚动内容区需自行加
 * `paddingTop: SHEET_HEADER_HEIGHT`，否则首屏内容会被标题区压住。
 */
import { Button, Host, Image } from '@expo/ui/swift-ui';
import { buttonStyle, disabled as disabledModifier, tint } from '@expo/ui/swift-ui/modifiers';
import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, Rect, Stop, LinearGradient as SvgLinearGradient } from 'react-native-svg';

import { Space, usePalette } from '@/constants/design';

/** 标题区总高：sheet 滚动内容应以此作顶部内边距。 */
export const SHEET_HEADER_HEIGHT = 64;
/** 圆形按钮 / 左右槽位边长（等宽保证标题严格居中）。 */
const SLOT_SIZE = 44;
/** 模糊背景总高：越过标题区底边，让模糊在内容区上方渐隐收尾（无硬边界）。 */
const BACKDROP_HEIGHT = SHEET_HEADER_HEIGHT + 28;

/**
 * 渐进式透明模糊（iOS 26 scroll-edge 观感，参考提醒事项）：
 * 无材质底色，模糊顶部最强、往下渐隐到无——用 SVG 竖向 alpha 渐变作遮罩裁切 BlurView。
 */
function ProgressiveBlur() {
  return (
    <MaskedView
      pointerEvents="none"
      style={styles.backdrop}
      maskElement={
        <Svg width="100%" height="100%">
          <Defs>
            <SvgLinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#000" stopOpacity="1" />
              <Stop offset="0.55" stopColor="#000" stopOpacity="1" />
              <Stop offset="0.8" stopColor="#000" stopOpacity="0.4" />
              <Stop offset="1" stopColor="#000" stopOpacity="0" />
            </SvgLinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#fade)" />
        </Svg>
      }
    >
      <BlurView tint="default" intensity={30} style={StyleSheet.absoluteFill} />
    </MaskedView>
  );
}

export function SheetHeader({
  title,
  onClose,
  onBack,
  onConfirm,
  confirmDisabled,
}: {
  title: string;
  /** 显式保存型的左侧 ✕：放弃修改并关闭 sheet。与 onBack 二选一。 */
  onClose?: () => void;
  /** 子视图左侧返回（chevron）：退回上一视图（不关闭 sheet）。与 onClose 二选一。 */
  onBack?: () => void;
  /** 显式保存型的右侧 ✓：提交修改。不传则不显示（自动保存 / 纯预览）。 */
  onConfirm?: () => void;
  /** ✓ 禁用态（表单校验不过时置灰）。 */
  confirmDisabled?: boolean;
}) {
  const palette = usePalette();
  const onLeft = onBack ?? onClose;
  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <ProgressiveBlur />
      <View style={styles.bar}>
        <View style={styles.slot}>
          {onLeft ? (
            <Host style={styles.btn}>
              {/* 注意：Button.systemImage 仅在带 label 时生效，纯图标须用子元素 Image */}
              <Button onPress={onLeft} modifiers={[buttonStyle('glass')]}>
                <Image systemName={onBack ? 'chevron.left' : 'xmark'} size={15} color={palette.textPrimary} />
              </Button>
            </Host>
          ) : null}
        </View>
        <Text numberOfLines={1} style={[styles.title, { color: palette.textPrimary }]}>
          {title}
        </Text>
        <View style={styles.slot}>
          {onConfirm ? (
            <Host style={styles.btn}>
              <Button
                onPress={onConfirm}
                modifiers={[buttonStyle('glassProminent'), tint(palette.ink), disabledModifier(!!confirmDisabled)]}
              >
                <Image systemName="checkmark" size={15} color={palette.onInk} />
              </Button>
            </Host>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: SHEET_HEADER_HEIGHT,
    zIndex: 10,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: BACKDROP_HEIGHT,
  },
  bar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Space[4],
    gap: Space[2],
  },
  slot: { width: SLOT_SIZE, height: SLOT_SIZE, alignItems: 'center', justifyContent: 'center' },
  btn: { width: SLOT_SIZE, height: SLOT_SIZE },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
});
