/**
 * 首页 UI 组件（@expo/ui/swift-ui 原生 SwiftUI 渲染）。
 * 视觉对齐参考图 + DESIGN.md：浅灰底 + 白卡、分类圆底图标、两段式金额、收支语义色。
 */
import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  background,
  clipShape,
  contentShape,
  cornerRadius,
  font,
  foregroundColor,
  frame,
  onTapGesture,
  padding,
  shadow,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps } from 'react';

import { Radius, Space, usePalette } from '@/constants/design';
import { amountParts, formatAmount, formatPercent, signForNet } from '@/lib/format';

// ── 两段式金额：整数主字号 + 小数降一档（DESIGN §8）────────────────────────────
export function AmountText({
  cents,
  sign = '',
  color,
  integerSize,
  decimalSize,
  weight = 'bold',
}: {
  cents: number;
  sign?: '+' | '-' | '';
  color: string;
  integerSize: number;
  decimalSize: number;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
}) {
  const p = amountParts(cents, sign);
  return (
    <HStack spacing={0} alignment="firstTextBaseline">
      <Text modifiers={[font({ size: integerSize, weight }), foregroundColor(color)]}>
        {`${p.sign}${p.currency}${p.integer}`}
      </Text>
      <Text modifiers={[font({ size: decimalSize, weight: 'regular' }), foregroundColor(color)]}>
        {`.${p.decimal}`}
      </Text>
    </HStack>
  );
}

// ── 分类圆底图标 ──────────────────────────────────────────────────────────────
export function CategoryAvatar({ symbol, color, size = 44 }: { symbol: string; color: string; size?: number }) {
  return (
    <Image
      systemName={symbol as ComponentProps<typeof Image>['systemName']}
      size={Math.round(size * 0.42)}
      color="#FFFFFF"
      modifiers={[frame({ width: size, height: size }), background(color), clipShape('circle')]}
    />
  );
}

// ── 单条流水的数据 ────────────────────────────────────────────────────────────
export type RowData = {
  id: string;
  title: string;
  subtitle: string | null;
  symbol: string;
  iconColor: string;
  amountCents: number;
  sign: '+' | '-';
  amountColor: string;
};

function Divider({ color }: { color: string }) {
  return (
    <HStack modifiers={[padding({ leading: 70 })]}>
      <HStack modifiers={[frame({ height: 0.5, maxWidth: 9999 }), background(color)]}>
        <Spacer />
      </HStack>
    </HStack>
  );
}

function TransactionRow({ row, onPress }: { row: RowData; onPress?: (id: string) => void }) {
  const palette = usePalette();
  return (
    <HStack
      spacing={Space[3]}
      alignment="center"
      modifiers={[
        padding({ vertical: Space[3], horizontal: Space[4] }),
        // 整行（含 Spacer 空隙）都可点：SwiftUI 默认只命中 Text/Image，缺此则标题与金额间的留白点不动
        ...(onPress ? [contentShape(shapes.rectangle()), onTapGesture(() => onPress(row.id))] : []),
      ]}
    >
      <CategoryAvatar symbol={row.symbol} color={row.iconColor} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ size: 17, weight: 'medium' }), foregroundColor(palette.textPrimary)]}>
          {row.title}
        </Text>
        {row.subtitle ? (
          <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>{row.subtitle}</Text>
        ) : null}
      </VStack>
      <Spacer />
      <AmountText
        cents={row.amountCents}
        sign={row.sign}
        color={row.amountColor}
        integerSize={17}
        decimalSize={13}
        weight="semibold"
      />
    </HStack>
  );
}

// ── 按日分组：灰色日期头（含当日净额）+ 白卡内多行 ─────────────────────────────
export function DayGroup({
  label,
  totalCents,
  rows,
  onRowPress,
}: {
  label: string;
  totalCents: number;
  rows: RowData[];
  onRowPress?: (id: string) => void;
}) {
  const palette = usePalette();
  return (
    <VStack alignment="leading" spacing={Space[2]}>
      <HStack modifiers={[padding({ horizontal: Space[1] })]}>
        <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>{label}</Text>
        <Spacer />
        <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>
          {formatAmount(totalCents, signForNet(totalCents))}
        </Text>
      </HStack>
      <VStack
        spacing={0}
        modifiers={[
          background(palette.card),
          cornerRadius(Radius.lg),
          shadow({ radius: 8, x: 0, y: 1, color: palette.shadow }),
        ]}
      >
        {rows.map((row, i) => (
          <VStack key={row.id} spacing={0}>
            {i > 0 ? <Divider color={palette.separator} /> : null}
            <TransactionRow row={row} onPress={onRowPress} />
          </VStack>
        ))}
      </VStack>
    </VStack>
  );
}

// ── 本月概览卡（中性实色卡 + 眼睛显隐 + 较上月趋势，DESIGN v0.5.0）─────────────
/** 环比趋势：null 表示上月无可比基数，UI 显示「—」。 */
export type Trend = { pct: number; up: boolean } | null;

/**
 * 金额：隐藏态用圆点遮罩，可见态走两段式金额。
 * 圆点「•」与数字字形的行高/基线不一致（圆点会触发更高的行盒），
 * 直接切换会让金额行高变化、卡片跳动。这里给两态统一套一个按主字号
 * 计算的固定高度 frame（垂直居中），从而无论显/隐占位高度都一致。
 */
function MaskOrAmount({
  cents,
  sign,
  color,
  integerSize,
  decimalSize,
  weight = 'bold',
  hidden,
}: {
  cents: number;
  sign?: '+' | '-' | '';
  color: string;
  integerSize: number;
  decimalSize: number;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  hidden: boolean;
}) {
  // SF Pro 正文行高约为字号的 1.2 倍，按主字号锁定金额行盒高度。
  const boxHeight = Math.round(integerSize * 1.2);
  const inner = hidden ? (
    <HStack spacing={0} alignment="firstTextBaseline">
      <Text modifiers={[font({ size: integerSize, weight }), foregroundColor(color)]}>¥••••</Text>
      <Text modifiers={[font({ size: decimalSize, weight: 'regular' }), foregroundColor(color)]}>••</Text>
    </HStack>
  ) : (
    <AmountText
      cents={cents}
      sign={sign}
      color={color}
      integerSize={integerSize}
      decimalSize={decimalSize}
      weight={weight}
    />
  );
  return <HStack modifiers={[frame({ height: boxHeight })]}>{inner}</HStack>;
}

/** 较上月趋势：中性灰文案 + 方向箭头（不靠颜色表意，DESIGN §13）。 */
function TrendRow({ trend }: { trend: Trend }) {
  const palette = usePalette();
  if (!trend) {
    return <Text modifiers={[font({ size: 12 }), foregroundColor(palette.textSecondary)]}>较上月 —</Text>;
  }
  return (
    <HStack spacing={2} alignment="center">
      <Text modifiers={[font({ size: 12 }), foregroundColor(palette.textSecondary)]}>
        {`较上月 ${formatPercent(trend.pct)}`}
      </Text>
      <Image systemName={trend.up ? 'arrow.up' : 'arrow.down'} size={9} color={palette.textSecondary} />
    </HStack>
  );
}

/**
 * 概览卡固定高度：内容（标题行 + 结余 + 支出/收入两列）在固定字号下高度恒定，
 * 锁死整卡高度后，眼睛在 eye/eye.slash、金额在数字/圆点之间切换都不会让卡片跳动。
 */
const BALANCE_CARD_HEIGHT = 188;

export function BalanceCard({
  balanceCents,
  expenseCents,
  incomeCents,
  hidden,
  onToggleHidden,
  expenseTrend,
  incomeTrend,
}: {
  balanceCents: number;
  expenseCents: number;
  incomeCents: number;
  hidden: boolean;
  onToggleHidden: () => void;
  expenseTrend: Trend;
  incomeTrend: Trend;
}) {
  const palette = usePalette();
  return (
    <VStack
      alignment="leading"
      spacing={Space[2]}
      modifiers={[
        padding({ all: Space[4] }),
        frame({ height: BALANCE_CARD_HEIGHT }),
        background(palette.card),
        cornerRadius(Radius.lg),
        shadow({ radius: 10, x: 0, y: 2, color: palette.shadow }),
      ]}
    >
      {/* 头：本月结余 + 眼睛显隐 · 右侧周期胶囊（暂为静态展示） */}
      <HStack alignment="center" spacing={Space[2]}>
        <Text modifiers={[font({ size: 15 }), foregroundColor(palette.textSecondary)]}>本月结余</Text>
        <Image
          systemName={hidden ? 'eye.slash' : 'eye'}
          size={15}
          color={palette.textSecondary}
          modifiers={[padding({ horizontal: Space[1], vertical: Space[1] }), onTapGesture(() => onToggleHidden())]}
        />
        <Spacer />
        <HStack
          spacing={Space[1]}
          alignment="center"
          modifiers={[
            padding({ horizontal: Space[3], vertical: Space[1] }),
            background(palette.cardPill),
            cornerRadius(Radius.full),
          ]}
        >
          <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textPrimary)]}>本月</Text>
          <Image systemName="chevron.down" size={10} color={palette.textSecondary} />
        </HStack>
      </HStack>

      <MaskOrAmount
        cents={balanceCents}
        sign={signForNet(balanceCents)}
        color={palette.textPrimary}
        integerSize={34}
        decimalSize={17}
        weight="bold"
        hidden={hidden}
      />

      <HStack spacing={Space[8]} modifiers={[padding({ top: Space[2] })]}>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>支出</Text>
          <MaskOrAmount
            cents={expenseCents}
            color={palette.expense}
            integerSize={22}
            decimalSize={13}
            weight="bold"
            hidden={hidden}
          />
          <TrendRow trend={expenseTrend} />
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>收入</Text>
          <MaskOrAmount
            cents={incomeCents}
            color={palette.income}
            integerSize={22}
            decimalSize={13}
            weight="bold"
            hidden={hidden}
          />
          <TrendRow trend={incomeTrend} />
        </VStack>
      </HStack>
    </VStack>
  );
}

// ── 预算预警条幅（流程 8）：原生渲染以便随 @expo/ui 列表一起滚动。──
export function BudgetBanner({ text, danger }: { text: string; danger: boolean }) {
  const palette = usePalette();
  const bg = danger ? palette.danger : palette.bannerTint;
  const iconColor = danger ? '#FFFFFF' : palette.warning;
  const textColor = danger ? '#FFFFFF' : palette.textPrimary;
  return (
    <HStack
      spacing={Space[2]}
      alignment="center"
      modifiers={[padding({ horizontal: Space[3], vertical: Space[3] }), background(bg), cornerRadius(Radius.md)]}
    >
      <Image systemName={danger ? 'exclamationmark.triangle.fill' : 'bell.fill'} size={15} color={iconColor} />
      <Text modifiers={[font({ size: 13, weight: 'medium' }), foregroundColor(textColor)]}>{text}</Text>
      <Spacer />
    </HStack>
  );
}

// ── 列表到底提示：居中浅灰文案，置于流水列表末尾，表示「没有更多了」。──
export function EndOfListHint({ text = '暂无更多数据' }: { text?: string }) {
  const palette = usePalette();
  return (
    <HStack modifiers={[padding({ vertical: Space[2] })]}>
      <Spacer />
      <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textTertiary)]}>{text}</Text>
      <Spacer />
    </HStack>
  );
}

// ── 家庭动态提示条（日历图标 + 两行文案）。可点时右侧带箭头并跳转，纯展示时不带箭头。──
export function InsightBanner({ title, subtitle, onPress }: { title: string; subtitle: string; onPress?: () => void }) {
  const palette = usePalette();
  return (
    <HStack
      spacing={Space[3]}
      alignment="center"
      modifiers={[
        padding({ vertical: Space[4], horizontal: Space[4] }),
        background(palette.bannerTint),
        cornerRadius(Radius.md),
        ...(onPress ? [onTapGesture(() => onPress())] : []),
      ]}
    >
      <Image systemName="calendar" size={22} color={palette.warning} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ size: 15, weight: 'medium' }), foregroundColor(palette.textPrimary)]}>{title}</Text>
        <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>{subtitle}</Text>
      </VStack>
      <Spacer />
      {onPress ? <Image systemName="chevron.right" size={13} color={palette.textTertiary} /> : null}
    </HStack>
  );
}
