/**
 * 首页 UI 组件（@expo/ui/swift-ui 原生 SwiftUI 渲染）。
 * 视觉对齐参考图 + DESIGN.md：浅灰底 + 白卡、分类圆底图标、两段式金额、收支语义色。
 */
import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import type { ComponentProps } from 'react';
import {
  background,
  clipShape,
  cornerRadius,
  font,
  foregroundColor,
  frame,
  onTapGesture,
  padding,
  shadow,
} from '@expo/ui/swift-ui/modifiers';

import { Radius, Space, usePalette } from '@/constants/design';
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
        ...(onPress ? [onTapGesture(() => onPress(row.id))] : []),
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

// ── 本月概览卡 ────────────────────────────────────────────────────────────────
export function BalanceCard({
  balanceCents,
  expenseCents,
  incomeCents,
}: {
  balanceCents: number;
  expenseCents: number;
  incomeCents: number;
}) {
  const palette = usePalette();
  return (
    <VStack
      alignment="leading"
      spacing={Space[2]}
      modifiers={[
        background(palette.card),
        cornerRadius(Radius.lg),
        padding({ all: Space[4] }),
        shadow({ radius: 8, x: 0, y: 1, color: palette.shadow }),
      ]}
    >
      <Text modifiers={[font({ size: 15 }), foregroundColor(palette.textSecondary)]}>本月结余</Text>
      <AmountText
        cents={balanceCents}
        sign={signForNet(balanceCents)}
        color={palette.textPrimary}
        integerSize={34}
        decimalSize={17}
        weight="bold"
      />
      <HStack spacing={Space[8]} modifiers={[padding({ top: Space[2] })]}>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>支出</Text>
          <AmountText cents={expenseCents} color={palette.expense} integerSize={22} decimalSize={13} weight="bold" />
        </VStack>
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>收入</Text>
          <AmountText cents={incomeCents} color={palette.income} integerSize={22} decimalSize={13} weight="bold" />
        </VStack>
      </HStack>
    </VStack>
  );
}

// ── 月度总结提示条 ────────────────────────────────────────────────────────────
export function InsightBanner({ message }: { message: string }) {
  const palette = usePalette();
  return (
    <HStack
      spacing={Space[2]}
      alignment="center"
      modifiers={[
        background(palette.bannerTint),
        cornerRadius(Radius.md),
        padding({ vertical: Space[3], horizontal: Space[3] }),
      ]}
    >
      <Image systemName="sparkles" size={16} color={palette.warning} />
      <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textPrimary)]}>{message}</Text>
      <Spacer />
      <Image systemName="xmark" size={12} color={palette.textTertiary} />
    </HStack>
  );
}
