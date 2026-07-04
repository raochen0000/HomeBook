/**
 * G10.2 定时收支（PRD §18 自定义能力）。原生 SwiftUI List 实现。
 *
 * 家庭共享规则列表：每行 分类图标 + 名称/备注 + 「每月 N 号 · 金额」 + 启用开关；左滑删除（List.ForEach onDelete）。
 * 顶部「新增定时收支」入口开编辑面板（RecurringSheet）。规则本身增删改即时落库；生成流水由客户端补记
 * （use-recurring-catchup，App 前台调 generate_due_recurring_transactions RPC，幂等）。
 */
import { HStack, Image, List, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import { contentShape, font, foregroundColor, onTapGesture, shapes } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import {
  useCategories,
  useDeleteRecurringRule,
  useGenerateDueRecurring,
  useMyFamily,
  useMyProfile,
  useRecurringRules,
  useUpdateRecurringRule,
  type RecurringRule,
} from '@/api';
import { Space, useCategoryColors, usePalette } from '@/constants/design';
import { RecurringSheet } from '@/features/record/recurring-sheet';
import { Caption, SettingsList } from '@/features/settings/native-list';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { formatAmount } from '@/lib/format';

type IconName = ComponentProps<typeof Image>['systemName'];

export default function RecurringScreen() {
  const palette = usePalette();
  const catColors = useCategoryColors();
  const rulesQ = useRecurringRules();
  const catsQ = useCategories();
  const profileQ = useMyProfile();
  const familyQ = useMyFamily();
  const updateM = useUpdateRecurringRule();
  const deleteM = useDeleteRecurringRule();
  const genM = useGenerateDueRecurring();

  const [sheet, setSheet] = useState<{ open: boolean; editing: RecurringRule | null }>({ open: false, editing: null });

  const familyId = familyQ.data?.id ?? profileQ.data?.current_family_id ?? '';
  const recorderId = profileQ.data?.id ?? '';

  const rules = rulesQ.data ?? [];
  const catById = useMemo(() => new Map((catsQ.data ?? []).map((c) => [c.id, c])), [catsQ.data]);

  const openAdd = () => {
    if (!familyId || !recorderId) return;
    setSheet({ open: true, editing: null });
  };

  const onDelete = (indices: number[]) => {
    const targets = indices.map((i) => rules[i]).filter(Boolean);
    for (const r of targets) deleteM.mutate(r.id, { onError: (e) => Alert.alert('删除失败', (e as Error).message) });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: '定时收支' }} />
      <SettingsList>
        <Section>
          <HStack
            alignment="center"
            spacing={Space[3]}
            modifiers={[contentShape(shapes.rectangle()), onTapGesture(openAdd)]}
          >
            <Image systemName="plus.circle.fill" size={20} color={palette.accent} />
            <Text modifiers={[font({ size: 16 }), foregroundColor(palette.accent)]}>新增定时收支</Text>
            <Spacer />
          </HStack>
        </Section>

        {rules.length > 0 ? (
          <Section title="每月自动记账">
            <List.ForEach onDelete={onDelete}>
              {rules.map((rule) => {
                const rtype = rule.type as 'expense' | 'income';
                const cat = catById.get(rule.category_id);
                const catName = cat?.name ?? (rtype === 'income' ? '其他收入' : '未分类');
                const icon = categorySymbol(cat?.icon ?? null, rtype) as IconName;
                const color = catColors[categoryColorKey(catName, rtype)];
                const title = rule.note?.trim() ? rule.note : catName;
                const amount = formatAmount(rule.amount, rtype === 'income' ? '+' : '-');
                const amountColor = rtype === 'income' ? palette.income : palette.expense;
                return (
                  <HStack key={rule.id} alignment="center" spacing={Space[3]}>
                    <HStack
                      alignment="center"
                      spacing={Space[3]}
                      modifiers={[
                        contentShape(shapes.rectangle()),
                        onTapGesture(() => setSheet({ open: true, editing: rule })),
                      ]}
                    >
                      <Image systemName={icon} size={22} color={color} />
                      <VStack alignment="leading" spacing={Space[1]}>
                        <Text modifiers={[font({ size: 16 }), foregroundColor(palette.textPrimary)]}>{title}</Text>
                        <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textSecondary)]}>
                          {`每月 ${rule.day_of_month} 号 · `}
                          <Text modifiers={[font({ size: 13 }), foregroundColor(amountColor)]}>{amount}</Text>
                        </Text>
                      </VStack>
                    </HStack>
                    <Spacer />
                    <Toggle
                      isOn={rule.enabled}
                      onIsOnChange={(v) => updateM.mutate({ id: rule.id, enabled: v })}
                      label=""
                    />
                  </HStack>
                );
              })}
            </List.ForEach>
          </Section>
        ) : null}

        <Caption
          text={
            rules.length > 0
              ? '关闭开关暂停该规则，不再自动记账；左滑可删除。生成的历史流水不受影响。'
              : '还没有定时收支。新增后，每月到「记账日」会自动记一笔，如工资、Apple Music 订阅。'
          }
        />
      </SettingsList>

      <RecurringSheet
        visible={sheet.open}
        editing={sheet.editing}
        familyId={familyId}
        recorderId={recorderId}
        onSaved={() => genM.mutate()}
        onClose={() => setSheet({ open: false, editing: null })}
      />
    </View>
  );
}
