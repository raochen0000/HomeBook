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
import { Dimensions } from 'react-native';

import { Radius, Space, usePalette } from '@/constants/design';
import { budgetLevel } from '@/lib/budget';
import { amountParts, formatAmount, signForNet } from '@/lib/format';

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

// ── 本月脉搏卡（预算口径为主，超支预警内联；无预算降级为现金流摘要，DESIGN §5.9）──
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

/** 进度条颜色档：<80% accent，80%~100% warning，>100% danger（与预算页一致）。 */
function budgetBarColor(level: 'normal' | 'warning' | 'danger', palette: ReturnType<typeof usePalette>) {
  return level === 'danger' ? palette.danger : level === 'warning' ? palette.warning : palette.accent;
}

/**
 * 进度条（@expo/ui SwiftUI 无现成可控变色进度件，用定宽轨道 + 比例填充自绘）。
 * 轨道宽 = 屏宽 − 页边距(2×Space4) − 卡内边距(2×Space4)。
 */
function ProgressBar({ frac, color, track }: { frac: number; color: string; track: string }) {
  const trackW = Dimensions.get('window').width - Space[4] * 2 - Space[4] * 2;
  const fillW = Math.round(Math.max(0, Math.min(1, frac)) * trackW);
  return (
    <HStack spacing={0} modifiers={[frame({ width: trackW, height: 8 }), background(track), cornerRadius(Radius.full)]}>
      <HStack modifiers={[frame({ width: fillW, height: 8 }), background(color), cornerRadius(Radius.full)]}>
        <Spacer />
      </HStack>
      <Spacer />
    </HStack>
  );
}

/**
 * 本月脉搏卡：整卡可点 → 全屏月度总结（PRD §11）。锁本月、无时间切换。
 * - 已设预算：预算口径主体（剩余可支配 / 进度条 / 已用·距月底）+ 现金流结余行；
 *   80%/超支由进度条变色 + 主数字翻转内联表达（不再用独立顶部红条，DESIGN §5.8）。
 * - 未设预算：降级为现金流摘要（结余 + 支出/收入）+「设置预算」引导（户主可点）。
 */
export function PulseCard({
  hasBudget,
  totalCents,
  usedCents,
  balanceCents,
  expenseCents,
  incomeCents,
  daysLeft,
  isOwner,
  hidden,
  onToggleHidden,
  onPress,
  onSetBudget,
}: {
  hasBudget: boolean;
  totalCents: number;
  usedCents: number;
  balanceCents: number;
  expenseCents: number;
  incomeCents: number;
  daysLeft: number;
  isOwner: boolean;
  hidden: boolean;
  onToggleHidden: () => void;
  onPress: () => void;
  onSetBudget: () => void;
}) {
  const palette = usePalette();

  // 卡头：标题 + 眼睛（左）/「总结 ›」入口提示（右）。
  const header = (label: string) => (
    <HStack alignment="center" spacing={Space[2]}>
      <Text modifiers={[font({ size: 15 }), foregroundColor(palette.textSecondary)]}>{label}</Text>
      <Image
        systemName={hidden ? 'eye.slash' : 'eye'}
        size={15}
        color={palette.textSecondary}
        modifiers={[padding({ horizontal: Space[1], vertical: Space[1] }), onTapGesture(() => onToggleHidden())]}
      />
      <Spacer />
      <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textTertiary)]}>总结</Text>
      <Image systemName="chevron.right" size={11} color={palette.textTertiary} />
    </HStack>
  );

  const cardModifiers = [
    padding({ all: Space[4] }),
    background(palette.card),
    cornerRadius(Radius.lg),
    shadow({ radius: 10, x: 0, y: 2, color: palette.shadow }),
    contentShape(shapes.rectangle()),
    onTapGesture(() => onPress()),
  ];

  // ── 未设预算：现金流摘要降级态 ──
  if (!hasBudget) {
    return (
      <VStack alignment="leading" spacing={Space[2]} modifiers={cardModifiers}>
        {header('本月结余')}
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
          </VStack>
        </HStack>
        {/* 设置预算引导：户主可点跳设置；普通成员只读 */}
        <HStack
          alignment="center"
          spacing={Space[1]}
          modifiers={[
            padding({ top: Space[2] }),
            ...(isOwner ? [contentShape(shapes.rectangle()), onTapGesture(() => onSetBudget())] : []),
          ]}
        >
          <Image systemName={isOwner ? 'plus.circle' : 'lock'} size={13} color={palette.textTertiary} />
          <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textTertiary)]}>
            {isOwner ? '设置本月预算，掌握可支配额度' : '待户主设置预算'}
          </Text>
          <Spacer />
          {isOwner ? <Image systemName="chevron.right" size={11} color={palette.textTertiary} /> : null}
        </HStack>
      </VStack>
    );
  }

  // ── 已设预算：预算口径主体 ──
  const pct = totalCents > 0 ? Math.round((usedCents / totalCents) * 100) : 0;
  const level = budgetLevel(pct);
  const remaining = totalCents - usedCents;
  const over = level === 'danger';
  const barColor = budgetBarColor(level, palette);

  return (
    <VStack alignment="leading" spacing={Space[2]} modifiers={cardModifiers}>
      {header(over ? '本月已超支' : '本月可支配')}
      <MaskOrAmount
        cents={over ? -remaining : remaining}
        sign=""
        color={over ? palette.danger : palette.textPrimary}
        integerSize={34}
        decimalSize={17}
        weight="bold"
        hidden={hidden}
      />
      <VStack alignment="leading" spacing={Space[1]} modifiers={[padding({ top: Space[1] })]}>
        <ProgressBar frac={pct / 100} color={barColor} track={palette.base} />
        <Text modifiers={[font({ size: 12 }), foregroundColor(palette.textSecondary)]}>
          {hidden
            ? `已用 ¥•••• / ¥•••• · 距月底 ${daysLeft} 天`
            : `已用 ${formatAmount(usedCents, '')} / ${formatAmount(totalCents, '')} · 距月底 ${daysLeft} 天`}
        </Text>
      </VStack>
      {/* 分隔线 + 现金流结余行（对账口径，无环比） */}
      <HStack modifiers={[padding({ top: Space[2] })]}>
        <HStack modifiers={[frame({ height: 0.5, maxWidth: 9999 }), background(palette.separator)]}>
          <Spacer />
        </HStack>
      </HStack>
      <HStack alignment="center" modifiers={[padding({ top: Space[1] })]}>
        <Text modifiers={[font({ size: 14 }), foregroundColor(palette.textSecondary)]}>本月结余</Text>
        <Spacer />
        <MaskOrAmount
          cents={balanceCents}
          sign={signForNet(balanceCents)}
          color={palette.textPrimary}
          integerSize={17}
          decimalSize={13}
          weight="semibold"
          hidden={hidden}
        />
      </HStack>
    </VStack>
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
      <Image systemName="calendar" size={22} color={palette.textSecondary} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ size: 15, weight: 'medium' }), foregroundColor(palette.textPrimary)]}>{title}</Text>
        <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>{subtitle}</Text>
      </VStack>
      <Spacer />
      {onPress ? <Image systemName="chevron.right" size={13} color={palette.textTertiary} /> : null}
    </HStack>
  );
}
