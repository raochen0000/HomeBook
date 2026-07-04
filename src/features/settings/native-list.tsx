/**
 * 「我的」设置区的原生 SwiftUI 列表基件（@expo/ui/swift-ui）。
 * 用原生 List(insetGrouped) + Section + 行替代手写 RN 卡片：分组白卡、行分隔、点按高亮
 * 均由系统绘制，贴合 iOS 设置抽屉观感（DESIGN §9.3/§10.5；2026-07-02 按用户要求改原生 Form/List）。
 */
import { Host, HStack, Image, List, Picker, Section, Spacer, Text, Toggle } from '@expo/ui/swift-ui';
import {
  contentShape,
  font,
  foregroundColor,
  listRowBackground,
  listRowSeparator,
  listStyle,
  onTapGesture,
  padding,
  pickerStyle,
  shapes,
  tag,
} from '@expo/ui/swift-ui/modifiers';
import type { ComponentProps, ReactNode } from 'react';

import { Space, usePalette } from '@/constants/design';

type IconName = ComponentProps<typeof Image>['systemName'];
type Modifiers = ComponentProps<typeof List>['modifiers'];

/** 原生 insetGrouped List 外壳；extraModifiers 供首页式滚动折叠头（scrollGeometry）用。 */
export function SettingsList({ children, extraModifiers }: { children: ReactNode; extraModifiers?: Modifiers }) {
  return (
    <Host style={{ flex: 1 }}>
      <List modifiers={[listStyle('insetGrouped'), ...(extraModifiers ?? [])]}>{children}</List>
    </Host>
  );
}

/** 通用设置行：图标 + 标题 +（值）+ 尾随（chevron / 菜单箭头）；传 onPress 则整行可点。 */
export function Row({
  icon,
  label,
  value,
  valueSize = 15,
  danger,
  trailing = 'chevron',
  onPress,
}: {
  icon: IconName;
  label: string;
  value?: string;
  /** 右侧值文案字号；默认 15，传更小值可做行内小字提示（如账号注销风险提示）。 */
  valueSize?: number;
  danger?: boolean;
  trailing?: 'chevron' | 'menu' | 'none';
  onPress?: () => void;
}) {
  const palette = usePalette();
  const primary = danger ? palette.danger : palette.textPrimary;
  const tapMods = onPress ? [contentShape(shapes.rectangle()), onTapGesture(onPress)] : [];
  return (
    <HStack alignment="center" spacing={Space[3]} modifiers={tapMods}>
      <Image systemName={icon} size={19} color={primary} />
      <Text modifiers={[font({ size: 16 }), foregroundColor(primary)]}>{label}</Text>
      <Spacer />
      {value ? (
        <Text modifiers={[font({ size: valueSize }), foregroundColor(palette.textSecondary)]}>{value}</Text>
      ) : null}
      {trailing === 'chevron' ? <Image systemName="chevron.right" size={13} color={palette.textTertiary} /> : null}
      {trailing === 'menu' ? (
        <Image systemName="chevron.up.chevron.down" size={12} color={palette.textTertiary} />
      ) : null}
    </HStack>
  );
}

/**
 * 下拉选择行：外观同 Row，点按弹出原生 SwiftUI 菜单式 Picker（行内下拉、当前项打勾、无「取消」项）。
 * 用 Picker(.menu) 而非 Menu：Menu 的自定义 label 在 List 中打开时会被系统「抬」进浮层，原位留空
 * （整行短暂消失）；Picker 打开时行保持在位，是 iOS「设置」下拉的标准控件。
 * selection 受控且由调用方决定是否更新——占位功能可固定 selection、仅在 onSelectionChange 里提示。
 */
export function MenuRow<T extends string>({
  icon,
  label,
  selection,
  onSelectionChange,
  options,
}: {
  icon: IconName;
  label: string;
  selection: T;
  onSelectionChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  const palette = usePalette();
  return (
    <Picker
      selection={selection}
      onSelectionChange={onSelectionChange}
      modifiers={[pickerStyle('menu')]}
      label={
        <HStack alignment="center" spacing={Space[3]}>
          <Image systemName={icon} size={19} color={palette.textPrimary} />
          <Text modifiers={[font({ size: 16 }), foregroundColor(palette.textPrimary)]}>{label}</Text>
        </HStack>
      }
    >
      {options.map((o) => (
        <Text key={o.value} modifiers={[tag(o.value)]}>
          {o.label}
        </Text>
      ))}
    </Picker>
  );
}

/**
 * 开关行：图标 + 标题 + 尾随原生开关（SwiftUI Toggle）。外观同 iOS「设置」的 Toggle 行
 * （系统绿开关、整行随行分隔），受控——value 由调用方持久化后回传。
 */
export function ToggleRow({
  icon,
  label,
  value,
  onValueChange,
}: {
  icon: IconName;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return <Toggle isOn={value} onIsOnChange={onValueChange} label={label} systemImage={icon} />;
}

/** 分组脚注（小灰字，落在页面底色上、无白卡）。Section 本版无 footer 属性，故自绘一段。 */
export function Caption({ text }: { text: string }) {
  const palette = usePalette();
  return (
    <Section modifiers={[listRowBackground(palette.base), listRowSeparator('hidden')]}>
      <Text
        modifiers={[
          font({ size: 12 }),
          foregroundColor(palette.textTertiary),
          padding({ leading: Space[1], trailing: Space[1], top: Space[1] }),
        ]}
      >
        {text}
      </Text>
    </Section>
  );
}
