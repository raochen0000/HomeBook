/**
 * G10.1 报表卡片管理（PRD §18 自定义能力）。原生 SwiftUI List/ForEach 实现。
 *
 * 两段式（iOS 定制卡标准形态）：
 *   - 「已展示」段：List.ForEach + onMove 长按拖动排序（iOS 15+，无需进入编辑态）；「收支概览」
 *     锁定常驻（moveDisabled + 不给隐藏按钮）；其余行尾「−」隐藏，隐藏到剩 MIN_VISIBLE 张时拦截。
 *   - 「未展示」段：行尾「＋」添加回已展示末尾。
 * 每次改动即时落库（accounting_preferences.report_card_order / report_card_hidden，乐观更新）。
 * 存储的 order 为「可见序 + 隐藏序」拼接的全序，配合 @/lib/report-cards resolveCardLayout 还原。
 */
import { HStack, Image, List, Section, Spacer, Text } from '@expo/ui/swift-ui';
import { contentShape, font, foregroundColor, moveDisabled, onTapGesture, shapes } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

import { DEFAULT_ACCOUNTING_PREFS, useAccountingPrefs, useSaveAccountingPrefs } from '@/api';
import { toast } from '@/components/toast';
import { Space, usePalette } from '@/constants/design';
import { Caption, SettingsList } from '@/features/settings/native-list';
import {
  isLockedCard,
  MIN_VISIBLE_CARDS,
  reportCardMeta,
  resolveCardLayout,
  type ReportCardId,
} from '@/lib/report-cards';

type IconName = ComponentProps<typeof Image>['systemName'];

/** SwiftUI onMove 语义的 JS 复刻：把 sources 处的项整体移到 destination（移除前索引）之前。 */
function moveItems<T>(arr: T[], sources: number[], destination: number): T[] {
  const picked = sources.map((i) => arr[i]);
  const remaining = arr.filter((_, i) => !sources.includes(i));
  const removedBeforeDest = sources.filter((i) => i < destination).length;
  const insertAt = destination - removedBeforeDest;
  remaining.splice(insertAt, 0, ...picked);
  return remaining;
}

export default function ReportCardsScreen() {
  const palette = usePalette();
  const { data } = useAccountingPrefs();
  const save = useSaveAccountingPrefs();

  const prefs = data ?? DEFAULT_ACCOUNTING_PREFS;
  const { visible, hidden } = resolveCardLayout(prefs.report_card_order, prefs.report_card_hidden);

  // 全序 = 可见序 + 隐藏序；隐藏集合另存，落库后由 resolveCardLayout 还原。
  const persist = (nextVisible: ReportCardId[], nextHidden: ReportCardId[]) =>
    save.mutate({ ...prefs, report_card_order: [...nextVisible, ...nextHidden], report_card_hidden: nextHidden });

  const onMove = (sources: number[], destination: number) => {
    persist(moveItems(visible, sources, destination), hidden);
  };

  const hideCard = (id: ReportCardId) => {
    if (isLockedCard(id)) return;
    if (visible.length <= MIN_VISIBLE_CARDS) {
      toast.warning(`至少展示 ${MIN_VISIBLE_CARDS} 个卡片`);
      return;
    }
    persist(
      visible.filter((x) => x !== id),
      [...hidden, id],
    );
  };

  const showCard = (id: ReportCardId) => {
    persist(
      [...visible, id],
      hidden.filter((x) => x !== id),
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: '报表卡片' }} />
      <SettingsList>
        <Section title="已展示（长按拖动排序）">
          <List.ForEach onMove={onMove}>
            {visible.map((id) => {
              const meta = reportCardMeta(id);
              const locked = isLockedCard(id);
              return (
                <HStack key={id} alignment="center" spacing={Space[3]} modifiers={locked ? [moveDisabled(true)] : []}>
                  <Image systemName={meta.icon as IconName} size={19} color={palette.accent} />
                  <Text modifiers={[font({ size: 16 }), foregroundColor(palette.textPrimary)]}>{meta.title}</Text>
                  <Spacer />
                  {locked ? (
                    <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textTertiary)]}>常驻</Text>
                  ) : (
                    <Image
                      systemName="minus.circle.fill"
                      size={22}
                      color={palette.danger}
                      modifiers={[contentShape(shapes.rectangle()), onTapGesture(() => hideCard(id))]}
                    />
                  )}
                </HStack>
              );
            })}
          </List.ForEach>
        </Section>

        {hidden.length > 0 ? (
          <Section title="未展示">
            {hidden.map((id) => {
              const meta = reportCardMeta(id);
              return (
                <HStack key={id} alignment="center" spacing={Space[3]}>
                  <Image systemName={meta.icon as IconName} size={19} color={palette.textTertiary} />
                  <Text modifiers={[font({ size: 16 }), foregroundColor(palette.textPrimary)]}>{meta.title}</Text>
                  <Spacer />
                  <Image
                    systemName="plus.circle.fill"
                    size={22}
                    color={palette.accent}
                    modifiers={[contentShape(shapes.rectangle()), onTapGesture(() => showCard(id))]}
                  />
                </HStack>
              );
            })}
          </Section>
        ) : null}

        <Caption text="「收支概览」为核心卡，常驻不可隐藏。隐藏的卡片可随时添加回来。" />
      </SettingsList>
    </View>
  );
}
