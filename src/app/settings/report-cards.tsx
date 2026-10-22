/**
 * 报表卡片管理（PRD §18.3.1.1）。
 *
 * 与「我的」相同的 inset grouped 列表，分成支出 / 收入 / 结余三组。
 * 每组除锁定的收支概览外，长按拖动排序；行尾「− / ＋」切换显隐，隐藏后仍留在本组。
 * 三页的顺序和显隐互不影响，即时写入 accounting_preferences。
 */
import { HStack, Image, List, Section, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { contentShape, font, foregroundColor, onTapGesture, shapes, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { DEFAULT_ACCOUNTING_PREFS, useAccountingPrefs, useSaveAccountingPrefs } from '@/api';
import { Space, usePalette } from '@/constants/design';
import { SettingsList } from '@/features/settings/native-list';
import { t } from '@/i18n';
import {
  buildScopeCardLayout,
  CARD_SCOPES,
  encodeScopeCardLayouts,
  isLockedCard,
  reportCardMeta,
  reportCardTitle,
  resolveAllScopeCardLayouts,
  scopeCardKey,
  type ReportCardId,
  type ReportScope,
  type ScopeCardLayout,
} from '@/lib/report-cards';

type IconName = ComponentProps<typeof Image>['systemName'];

const SCOPE_LABEL: Record<ReportScope, string> = {
  expense: 'record.expense',
  income: 'record.income',
  balance: 'report.balance',
};

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
  const order = prefs.report_card_order;
  const hiddenPrefs = prefs.report_card_hidden;
  const resolved = resolveAllScopeCardLayouts(order, hiddenPrefs);

  // 渲染以本地布局为准。SwiftUI onMove 要求回调内同步改数据源；偏好缓存变化时再对齐。
  const [layouts, setLayouts] = useState(resolved);
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- 对齐远端偏好，不是从 render 派生交互态 */
    setLayouts(resolveAllScopeCardLayouts(order, hiddenPrefs));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [order, hiddenPrefs]);

  const persist = (next: Record<ReportScope, ScopeCardLayout>) =>
    save.mutate({ ...prefs, ...encodeScopeCardLayouts(next) });

  const commit = (scope: ReportScope, nextOrder: ReportCardId[], nextHidden: ReportCardId[]) => {
    const next = { ...layouts, [scope]: buildScopeCardLayout(nextOrder, nextHidden) };
    setLayouts(next);
    persist(next);
  };

  const onMove = (scope: ReportScope, sources: number[], destination: number) => {
    const layout = layouts[scope];
    const locked = layout.order.filter(isLockedCard);
    const movable = layout.order.filter((id) => !isLockedCard(id));
    commit(scope, [...locked, ...moveItems(movable, sources, destination)], layout.hidden);
  };

  const hideCard = (scope: ReportScope, id: ReportCardId) => {
    if (isLockedCard(id)) return;
    const layout = layouts[scope];
    commit(scope, layout.order, [...layout.hidden, id]);
  };

  const showCard = (scope: ReportScope, id: ReportCardId) => {
    const layout = layouts[scope];
    commit(
      scope,
      layout.order,
      layout.hidden.filter((hiddenId) => hiddenId !== id),
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: t('report.cardsTitle') }} />
      <SettingsList>
        {CARD_SCOPES.map((scope) => {
          const layout = layouts[scope];
          const hidden = new Set(layout.hidden);
          const locked = layout.order.filter(isLockedCard);
          const movable = layout.order.filter((id) => !isLockedCard(id));
          return (
            <Section key={scope} title={t(SCOPE_LABEL[scope])}>
              {locked.map((id) => {
                const meta = reportCardMeta(id);
                return (
                  <HStack
                    key={scopeCardKey(scope, id)}
                    alignment="center"
                    spacing={Space[3]}
                    modifiers={[tag(scopeCardKey(scope, id))]}
                  >
                    <Image systemName={meta.icon as IconName} size={19} color={palette.ink} />
                    <Text modifiers={[font({ size: 16 }), foregroundColor(palette.textPrimary)]}>
                      {reportCardTitle(id)}
                    </Text>
                    <Spacer />
                    <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textTertiary)]}>
                      {t('common.pinned')}
                    </Text>
                  </HStack>
                );
              })}
              <List.ForEach onMove={(sources, destination) => onMove(scope, sources, destination)}>
                {movable.map((id) => {
                  const meta = reportCardMeta(id);
                  const isHidden = hidden.has(id);
                  const titleColor = isHidden ? palette.textTertiary : palette.textPrimary;
                  const iconColor = isHidden ? palette.textTertiary : palette.ink;
                  return (
                    <HStack
                      key={scopeCardKey(scope, id)}
                      alignment="center"
                      spacing={Space[3]}
                      modifiers={[tag(scopeCardKey(scope, id))]}
                    >
                      <Image systemName={meta.icon as IconName} size={19} color={iconColor} />
                      <VStack alignment="leading" spacing={2}>
                        <Text modifiers={[font({ size: 16 }), foregroundColor(titleColor)]}>{reportCardTitle(id)}</Text>
                        {id === 'budget' ? (
                          <Text modifiers={[font({ size: 13 }), foregroundColor(palette.textTertiary)]}>
                            {t('report.monthOnly')}
                          </Text>
                        ) : null}
                      </VStack>
                      <Spacer />
                      <Image
                        systemName={isHidden ? 'plus.circle.fill' : 'minus.circle.fill'}
                        size={22}
                        color={isHidden ? palette.ink : palette.danger}
                        modifiers={[
                          contentShape(shapes.rectangle()),
                          onTapGesture(() => (isHidden ? showCard(scope, id) : hideCard(scope, id))),
                        ]}
                      />
                    </HStack>
                  );
                })}
              </List.ForEach>
            </Section>
          );
        })}
      </SettingsList>
    </View>
  );
}
