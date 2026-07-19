/**
 * 首页 UI 组件（@expo/ui/swift-ui 原生 SwiftUI 渲染）。
 * 视觉对齐参考图 + DESIGN.md：浅灰底 + 白卡、分类圆底图标、两段式金额、收支语义色。
 */
import { Button, HStack, Image, Section, Spacer, SwipeActions, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import {
  aspectRatio,
  background,
  clipShape,
  contentShape,
  cornerRadius,
  font,
  foregroundColor,
  frame,
  lineLimit,
  listRowInsets,
  onTapGesture,
  opacity,
  padding,
  resizable,
  shapes,
  tint,
  truncationMode,
  zIndex,
} from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps } from 'react';
import { Dimensions } from 'react-native';

import { Radius, Space, Typography, usePalette } from '@/constants/design';
import { budgetLevel, budgetStage } from '@/lib/budget';
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

// ── 分类圆角方底图标（圆角比例对齐 iOS App 图标的 squircle ≈ 0.2237×边长）──────────
export function CategoryAvatar({ symbol, color, size = 44 }: { symbol: string; color: string; size?: number }) {
  return (
    <Image
      systemName={symbol as ComponentProps<typeof Image>['systemName']}
      size={Math.round(size * 0.42)}
      color="#FFFFFF"
      modifiers={[frame({ width: size, height: size }), background(color), cornerRadius(Math.round(size * 0.2237))]}
    />
  );
}

// ── 成员头像（真实照片 + 首字母色块回退）────────────────────────────────────────
// 回退色块底色改由 `@/constants/design` 的 useAvatarTints()/avatarTintFor() 统一供给
// （DESIGN §3.0 铁律 1、4：禁裸 hex + Light/Night 各自取值）。

export type AvatarInfo = {
  /** 本地缓存的头像文件路径（file://…）；无则走首字母回退。 */
  uri: string | null;
  /** 昵称首字（回退色块用）。 */
  initial: string;
  /** 回退色块底色。 */
  tint: string;
};

/** 单个成员头像：有图用真实照片（resizable + fill 居中裁圆），无图用首字母色块；外圈白环便于层叠区分。 */
function MemberAvatar({ info, size = 20 }: { info: AvatarInfo; size?: number }) {
  const palette = usePalette();
  const outer = Math.round(size + 3);
  const inner = info.uri ? (
    <Image
      uiImage={info.uri}
      modifiers={[
        resizable(),
        aspectRatio({ contentMode: 'fill' }),
        frame({ width: size, height: size }),
        clipShape('circle'),
      ]}
    />
  ) : (
    <Text
      modifiers={[
        frame({ width: size, height: size }),
        background(info.tint),
        clipShape('circle'),
        font({ size: Math.round(size * 0.5), weight: 'semibold' }),
        foregroundColor('#FFFFFF'),
      ]}
    >
      {info.initial}
    </Text>
  );
  return (
    <ZStack modifiers={[frame({ width: outer, height: outer }), background(palette.card), clipShape('circle')]}>
      {inner}
    </ZStack>
  );
}

/** 记录人（+修改者）头像：靠左层叠，记录人压在上层。 */
function AvatarStack({
  recorder,
  editor,
  size = 20,
}: {
  recorder: AvatarInfo;
  editor: AvatarInfo | null;
  size?: number;
}) {
  const overlap = Math.round(size * 0.42);
  return (
    <HStack spacing={0} alignment="center">
      <HStack modifiers={[zIndex(1)]}>
        <MemberAvatar info={recorder} size={size} />
      </HStack>
      {editor ? (
        <HStack modifiers={[padding({ leading: -overlap })]}>
          <MemberAvatar info={editor} size={size} />
        </HStack>
      ) : null}
    </HStack>
  );
}

// ── 单条流水的数据 ────────────────────────────────────────────────────────────
export type RowData = {
  id: string;
  title: string;
  symbol: string;
  iconColor: string;
  amountCents: number;
  sign: '+' | '-';
  amountColor: string;
  /** 备注（第二行最右，溢出省略）。 */
  note: string | null;
  /** 24h 时刻（记账时间；被他人修改后为最新修改时间）。 */
  timeLabel: string;
  /** 记录人头像。 */
  recorder: AvatarInfo;
  /** 修改者头像（仅当被「他人」修改时存在）。 */
  editor: AvatarInfo | null;
};

/** 行内边距。 */
const ROW_INSET_H = Space[1];

function TransactionRow({ row, onPress }: { row: RowData; onPress?: (id: string) => void }) {
  const palette = usePalette();
  return (
    <VStack
      spacing={0}
      // 整行（含留白）可点 → 详情弹窗；编辑/删除走左滑，不在此处。
      modifiers={[
        listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 }),
        ...(onPress ? [contentShape(shapes.rectangle()), onTapGesture(() => onPress(row.id))] : []),
      ]}
    >
      <HStack
        spacing={Space[2]}
        alignment="center"
        modifiers={[
          padding({
            horizontal: ROW_INSET_H,
          }),
        ]}
      >
        <CategoryAvatar symbol={row.symbol} color={row.iconColor} />
        <VStack alignment="leading" spacing={Space[1]} modifiers={[frame({ maxWidth: 9999 })]}>
          {/* 第一行：分类名 + 金额（正常字重） */}
          <HStack alignment="firstTextBaseline">
            <Text modifiers={[font({ size: 17, weight: 'medium' }), foregroundColor(palette.textPrimary)]}>
              {row.title}
            </Text>
            <Spacer />
            <AmountText
              cents={row.amountCents}
              sign={row.sign}
              color={row.amountColor}
              integerSize={17}
              decimalSize={13}
              weight="regular"
            />
          </HStack>
          {/* 第二行：记录人/修改者头像 + 时间（左）｜备注（最右，溢出省略隐藏） */}
          <HStack spacing={Space[2]} alignment="center" modifiers={[frame({ maxWidth: 9999 })]}>
            <AvatarStack recorder={row.recorder} editor={row.editor} />
            <Text modifiers={[font({ size: 12 }), foregroundColor(palette.textSecondary)]}>{row.timeLabel}</Text>
            {row.note ? (
              <Text
                modifiers={[
                  font({ size: 12 }),
                  foregroundColor(palette.textTertiary),
                  lineLimit(1),
                  truncationMode('tail'),
                  frame({ maxWidth: 9999, alignment: 'trailing' }),
                ]}
              >
                {row.note}
              </Text>
            ) : (
              <Spacer />
            )}
          </HStack>
        </VStack>
      </HStack>
    </VStack>
  );
}

/** 与 Hero 卡等宽的内容宽度：屏宽 − 页边距(2×Space4)。用于分组头/横幅与卡片左右对齐。 */
const CONTENT_WIDTH = Dimensions.get('window').width - Space[4] * 2;

/** 当日净额颜色（红/绿语义，与本 App income=红/expense=绿一致）：正→红、负→绿、零→中性。 */
function netColor(cents: number, palette: ReturnType<typeof usePalette>) {
  if (cents > 0) return palette.income;
  if (cents < 0) return palette.expense;
  return palette.textPrimary;
}

// ── 按日分组：原生 List Section（insetGrouped 灰底白卡）+ 行内左滑「编辑/删除」 ──────
// 用作 <List> 的直接子节点；当日合计按红/绿语义着色。
export function DayGroup({
  label,
  totalCents,
  rows,
  onRowPress,
  onEdit,
  onDelete,
}: {
  label: string;
  totalCents: number;
  rows: RowData[];
  onRowPress?: (id: string) => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}) {
  const palette = usePalette();
  // 定宽 = 屏宽 − 页边距：header 在系统默认缩进的可用区内居中，溢出对称，
  // 从而左右边缘与上方 Hero 卡 / 分组白卡对齐（系统 header 缩进不可直接清零）。
  const header = (
    <HStack modifiers={[frame({ width: CONTENT_WIDTH })]}>
      <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>{label}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 13, weight: 'bold' }), foregroundColor(netColor(totalCents, palette))]}>
        {formatAmount(totalCents, signForNet(totalCents))}
      </Text>
    </HStack>
  );
  return (
    // listRowInsets 放在 Section 上：清零 insetGrouped 默认行内边距，避免叠加 TransactionRow 自带 padding。
    <Section header={header} modifiers={[listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 })]}>
      {rows.map((row) => (
        <SwipeActions key={row.id} modifiers={[listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 })]}>
          <TransactionRow row={row} onPress={onRowPress} />
          {/* allowsFullSwipe=false：滑到底也不自动触发首个动作（否则误触「编辑」）。
              删除按钮不用 role="destructive"（那会让 SwiftUI 在点击时直接把行收起，取消后不复原）；
              改用红色 tint，真正的二次确认与危险色交给 RN Alert。 */}
          <SwipeActions.Actions edge="trailing" allowsFullSwipe={false}>
            <Button
              systemImage="square.and.pencil"
              label="编辑"
              onPress={() => onEdit?.(row.id)}
              modifiers={[tint(palette.info)]}
            />
            <Button
              systemImage="trash"
              label="删除"
              onPress={() => onDelete?.(row.id)}
              modifiers={[tint(palette.danger)]}
            />
          </SwipeActions.Actions>
        </SwipeActions>
      ))}
    </Section>
  );
}

// ── 本月脉搏卡（预算口径为主，超支预警内联；无预算降级为现金流摘要，DESIGN §5.9）──
/** 金额行固定行高（对齐 DESIGN Typography，避免显/隐切换时行盒高度变化）。 */
function amountLineHeight(integerSize: number): number {
  if (integerSize >= 34) return Typography.largeTitle.lineHeight;
  if (integerSize >= 22) return Typography.title1.lineHeight;
  return Typography.amountRow.lineHeight;
}

/** 进度条副文案占位（固定最长宽度，避免显/隐切换时换行或行高变化）。 */
const PROGRESS_CAPTION_RESERVE = '已用 ¥9,999,999.99 / ¥9,999,999.99 · 距月底 31 天';

/**
 * 金额：隐藏时用透明真实 AmountText 撑开行盒，遮罩层叠在上方；外层 HStack+Spacer 保证左对齐。
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
  const boxHeight = amountLineHeight(integerSize);
  return (
    <HStack modifiers={[frame({ height: boxHeight })]}>
      <ZStack alignment="topLeading">
        <HStack modifiers={[opacity(hidden ? 0 : 1)]}>
          <AmountText
            cents={cents}
            sign={sign}
            color={color}
            integerSize={integerSize}
            decimalSize={decimalSize}
            weight={weight}
          />
        </HStack>
        {hidden ? (
          <HStack spacing={0} alignment="firstTextBaseline">
            <Text
              modifiers={[font({ size: integerSize, weight }), foregroundColor(color)]}
            >{`${sign ?? ''}¥••••`}</Text>
            <Text modifiers={[font({ size: decimalSize, weight: 'regular' }), foregroundColor(color)]}>.••</Text>
          </HStack>
        ) : null}
      </ZStack>
      <Spacer />
    </HStack>
  );
}

/** 进度条下方「已用 / 距月底」副文案：固定占位行高。 */
function ProgressCaption({
  hidden,
  usedCents,
  totalCents,
  daysLeft,
}: {
  hidden: boolean;
  usedCents: number;
  totalCents: number;
  daysLeft: number;
}) {
  const palette = usePalette();
  const lineHeight = Typography.footnote.lineHeight;
  const visible = `已用 ${formatAmount(usedCents, '')} / ${formatAmount(totalCents, '')} · 距月底 ${daysLeft} 天`;
  const masked = `已用 ¥•••• / ¥•••• · 距月底 ${daysLeft} 天`;
  const textMods = [font({ size: 12 }), foregroundColor(palette.textSecondary), lineLimit(1), truncationMode('tail')];
  return (
    <HStack modifiers={[frame({ height: lineHeight, maxWidth: 9999 })]}>
      <ZStack alignment="topLeading">
        <Text modifiers={[...textMods, opacity(0)]}>{PROGRESS_CAPTION_RESERVE}</Text>
        <Text modifiers={textMods}>{hidden ? masked : visible}</Text>
      </ZStack>
      <Spacer />
    </HStack>
  );
}

/** 进度条 4 档颜色（绿→蓝→黄→红）：充裕 绿 / 正常 蓝 / 预警 黄 / 超支 红。 */
function budgetBarColor(stage: 'safe' | 'normal' | 'warning' | 'danger', palette: ReturnType<typeof usePalette>) {
  switch (stage) {
    case 'danger':
      return palette.danger; // 红：超支
    case 'warning':
      return palette.warning; // 黄：≥80%
    case 'normal':
      return palette.info; // 蓝：50%~80%
    default:
      return palette.expense; // 绿：<50%（已用占比低 = 充裕）
  }
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

  // 卡头：标题 + 眼睛（左）/「总结 ›」入口（右，仅此处可点开总结）。
  const header = (label: string) => (
    <HStack alignment="center" spacing={Space[2]}>
      <Text modifiers={[font({ size: 15 }), foregroundColor(palette.textSecondary)]}>{label}</Text>
      <Image
        systemName={hidden ? 'eye.slash' : 'eye'}
        size={15}
        color={palette.textSecondary}
        modifiers={[
          frame({ width: 22, height: 22 }),
          padding({ horizontal: Space[1], vertical: Space[1] }),
          onTapGesture(() => onToggleHidden()),
        ]}
      />
      <Spacer />
      <HStack
        alignment="center"
        spacing={Space[1]}
        modifiers={[padding({ vertical: Space[1] }), contentShape(shapes.rectangle()), onTapGesture(() => onPress())]}
      >
        <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textTertiary)]}>总结</Text>
        <Image systemName="chevron.right" size={11} color={palette.textTertiary} />
      </HStack>
    </HStack>
  );

  const cardModifiers = [listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 })];

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
  const barColor = budgetBarColor(budgetStage(pct), palette);

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
        <ProgressCaption hidden={hidden} usedCents={usedCents} totalCents={totalCents} daysLeft={daysLeft} />
      </VStack>
      {/* 分隔线 + 现金流结余行（对账口径，无环比） */}
      <HStack modifiers={[padding({ top: Space[2] })]}>
        <HStack modifiers={[frame({ height: 0.5, maxWidth: 9999 }), background(palette.separator)]}>
          <Spacer />
        </HStack>
      </HStack>
      <HStack
        alignment="center"
        modifiers={[
          padding({ top: Space[1] }),
          frame({ height: Typography.amountRow.lineHeight, alignment: 'center' }),
        ]}
      >
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

// ── 家庭动态提示条（日历图标 + 两行文案）。可点时右侧带箭头并跳转；可关时右侧带「X」。──
export function InsightBanner({
  title,
  subtitle,
  onPress,
  onDismiss,
}: {
  title: string;
  subtitle: string;
  onPress?: () => void;
  onDismiss?: () => void;
}) {
  const palette = usePalette();
  const contentMods = [
    frame({ maxWidth: 9999 }),
    ...(onPress ? [contentShape(shapes.rectangle()), onTapGesture(() => onPress())] : []),
  ];
  return (
    <HStack
      spacing={Space[3]}
      alignment="center"
      modifiers={[listRowInsets({ top: 0, bottom: 0, leading: 0, trailing: 0 })]}
    >
      <HStack spacing={Space[3]} alignment="center" modifiers={contentMods}>
        <Image systemName="calendar" size={28} color={palette.textSecondary} />
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 15, weight: 'medium' }), foregroundColor(palette.textPrimary)]}>{title}</Text>
          <Text modifiers={[font({ size: 11 }), foregroundColor(palette.textSecondary)]}>{subtitle}</Text>
        </VStack>
        <Spacer />
        {onPress ? <Image systemName="chevron.right" size={13} color={palette.textTertiary} /> : null}
      </HStack>
      {onDismiss ? (
        <Image
          systemName="xmark.circle.fill"
          size={18}
          color={palette.textTertiary}
          modifiers={[
            padding({ leading: Space[1], vertical: Space[1] }),
            contentShape(shapes.rectangle()),
            onTapGesture(() => onDismiss()),
          ]}
        />
      ) : null}
    </HStack>
  );
}
