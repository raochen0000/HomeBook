/**
 * G10.2 定时收支（PRD §18 自定义能力）。原生 SwiftUI List 实现。
 *
 * 家庭共享规则列表：显示周期、金额和启用开关；左滑删除。服务端定时生成流水。
 */
import { HStack, Image, List, Section, Spacer, Text, Toggle, VStack } from '@expo/ui/swift-ui';
import { contentShape, font, foregroundColor, onTapGesture, shapes } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';

import {
  useAllCategories,
  useDeleteRecurringRule,
  useGenerateDueRecurring,
  useMyFamily,
  useMyProfile,
  useRecurringRules,
  useUpdateRecurringRule,
  type RecurringRule,
} from '@/api';
import { alertOk, displayCategoryName, t, useLocalePreference } from '@/i18n';
import { Space, useCategoryColors, usePalette } from '@/constants/design';
import { RecurringSheet } from '@/features/record/recurring-sheet';
import { Caption, SettingsList } from '@/features/settings/native-list';
import { categoryColorKey, categorySymbol } from '@/lib/category-style';
import { formatAmount } from '@/lib/format';

type IconName = ComponentProps<typeof Image>['systemName'];

export default function RecurringScreen() {
  const palette = usePalette();
  useLocalePreference();
  const catColors = useCategoryColors();
  const rulesQ = useRecurringRules();
  const catsQ = useAllCategories();
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
    for (const r of targets)
      deleteM.mutate(r.id, { onError: (e) => Alert.alert(t('home.deleteFailed'), (e as Error).message, alertOk()) });
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: t('settings.recurring') }} />
      <SettingsList>
        <Section>
          <HStack
            alignment="center"
            spacing={Space[3]}
            modifiers={[contentShape(shapes.rectangle()), onTapGesture(openAdd)]}
          >
            <Image systemName="plus.circle.fill" size={20} color={palette.accent} />
            <Text modifiers={[font({ size: 16 }), foregroundColor(palette.accent)]}>{t('record.addRecurring')}</Text>
            <Spacer />
          </HStack>
        </Section>

        {rules.length > 0 ? (
          <Section title={t('record.monthlyAuto')}>
            <List.ForEach onDelete={onDelete}>
              {rules.map((rule) => {
                const rtype = rule.type as 'expense' | 'income';
                const cat = catById.get(rule.category_id);
                const catName = cat
                  ? displayCategoryName(cat.name, cat.is_system)
                  : rtype === 'income'
                    ? t('categories.otherIncome')
                    : t('common.uncategorized');
                const icon = categorySymbol(cat?.icon ?? null, rtype) as IconName;
                const color = catColors[categoryColorKey(catName, rtype, cat?.color_key)];
                const title = rule.note?.trim() ? rule.note : catName;
                const amount = formatAmount(rule.amount, rtype === 'income' ? '+' : '-');
                const amountColor = rtype === 'income' ? palette.income : palette.expense;
                const schedule =
                  rule.frequency === 'daily'
                    ? t('record.recurringDaily')
                    : rule.frequency === 'yearly' && rule.month_of_year !== null
                      ? t('record.recurringYearlyOn', { month: rule.month_of_year, day: rule.day_of_month })
                      : t('common.everyMonthDay', { day: rule.day_of_month });
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
                          {`${schedule} · `}
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

        <Caption text={rules.length > 0 ? t('settings.recurringHint') : t('settings.recurringEmpty')} />
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
