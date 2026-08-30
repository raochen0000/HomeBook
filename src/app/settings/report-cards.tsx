/**
 * G10.1 报表卡片管理（PRD §18 自定义能力）。原生 SwiftUI List/ForEach 实现。
 *
 * 两段式（iOS 定制卡标准形态）：
 *   - 「已展示」段：锁定卡（收支概览）在 ForEach 外固定置顶；其余卡进 List.ForEach + onMove
 *     长按拖动排序。不可把 moveDisabled 项与可拖项放进同一 ForEach，否则拖到锁定卡邻位会弹回。
 *   - 「未展示」段：行尾「＋」添加回已展示末尾。
 * 每次改动即时落库（accounting_preferences.report_card_order / report_card_hidden，乐观更新）。
 * 存储的 order 为「可见序 + 隐藏序」拼接的全序，配合 @/lib/report-cards resolveCardLayout 还原。
 *
 * 排序用本地 state 做渲染源：SwiftUI onMove 要求回调内同步更新数据源。
 */
import { HStack, Image, List, Section, Spacer, Text } from '@expo/ui/swift-ui';
import { contentShape, font, foregroundColor, onTapGesture, shapes, tag } from '@expo/ui/swift-ui/modifiers';
import { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { DEFAULT_ACCOUNTING_PREFS, useAccountingPrefs, useSaveAccountingPrefs } from '@/api';
import { toast } from '@/components/toast';
import { Space, usePalette } from '@/constants/design';
import { SettingsList } from '@/features/settings/native-list';
import { t } from '@/i18n';
import {
  isLockedCard,
  MIN_VISIBLE_CARDS,
  reportCardMeta,
  reportCardTitle,
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

function splitVisible(visible: ReportCardId[]) {
  return {
    locked: visible.filter(isLockedCard),
    movable: visible.filter((id) => !isLockedCard(id)),
  };
}

export default function ReportCardsScreen() {
  const palette = usePalette();
  const { data } = useAccountingPrefs();
  const save = useSaveAccountingPrefs();

  const prefs = data ?? DEFAULT_ACCOUNTING_PREFS;
  const order = prefs.report_card_order;
  const hiddenPrefs = prefs.report_card_hidden;
  const resolved = resolveCardLayout(order, hiddenPrefs);

  // 渲染以本地序为准；偏好缓存变化（首拉 / 乐观更新 / 失败回滚 / 重拉）时再对齐。
  // SwiftUI onMove 要求回调内同步改数据源，故用本地 state；外部偏好变化时再对齐。
  const [visible, setVisible] = useState(resolved.visible);
  const [hidden, setHidden] = useState(resolved.hidden);
  useEffect(() => {
    const next = resolveCardLayout(order, hiddenPrefs);
    /* eslint-disable react-hooks/set-state-in-effect -- 对齐远端偏好，不是从 render 派生交互态 */
    setVisible(next.visible);
    setHidden(next.hidden);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [order, hiddenPrefs]);

  const { locked, movable } = splitVisible(visible);

  const visibleCardsHeader = (
    <Text modifiers={[font({ size: 17, weight: 'semibold' }), foregroundColor(palette.textSecondary)]}>
      {t('report.shownHeader')}
    </Text>
  );
  const visibleCardsFooter = (
    <HStack alignment="center" spacing={Space[2]}>
      <Image systemName="info.circle" size={13} color={palette.textTertiary} />
      <Text modifiers={[font({ size: 12 }), foregroundColor(palette.textTertiary)]}>{t('report.shownFooter')}</Text>
    </HStack>
  );

  // 全序 = 可见序 + 隐藏序；隐藏集合另存，落库后由 resolveCardLayout 还原。
  const persist = (nextVisible: ReportCardId[], nextHidden: ReportCardId[]) =>
    save.mutate({ ...prefs, report_card_order: [...nextVisible, ...nextHidden], report_card_hidden: nextHidden });

  const onMove = (sources: number[], destination: number) => {
    // ForEach 只含可拖项，索引相对 movable；拼回时锁定卡仍置顶。
    const nextVisible = [...locked, ...moveItems(movable, sources, destination)];
    setVisible(nextVisible);
    persist(nextVisible, hidden);
  };

  const hideCard = (id: ReportCardId) => {
    if (isLockedCard(id)) return;
    if (visible.length <= MIN_VISIBLE_CARDS) {
      toast.warning(t('report.minCards', { count: MIN_VISIBLE_CARDS }));
      return;
    }
    const nextVisible = visible.filter((x) => x !== id);
    const nextHidden = [...hidden, id];
    setVisible(nextVisible);
    setHidden(nextHidden);
    persist(nextVisible, nextHidden);
  };

  const showCard = (id: ReportCardId) => {
    const nextVisible = [...visible, id];
    const nextHidden = hidden.filter((x) => x !== id);
    setVisible(nextVisible);
    setHidden(nextHidden);
    persist(nextVisible, nextHidden);
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: t('report.cardsTitle') }} />
      <SettingsList>
        <Section header={visibleCardsHeader} footer={visibleCardsFooter}>
          {locked.map((id) => {
            const meta = reportCardMeta(id);
            return (
              <HStack key={id} alignment="center" spacing={Space[3]} modifiers={[tag(id)]}>
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
          <List.ForEach onMove={onMove}>
            {movable.map((id) => {
              const meta = reportCardMeta(id);
              return (
                <HStack key={id} alignment="center" spacing={Space[3]} modifiers={[tag(id)]}>
                  <Image systemName={meta.icon as IconName} size={19} color={palette.ink} />
                  <Text modifiers={[font({ size: 16 }), foregroundColor(palette.textPrimary)]}>
                    {reportCardTitle(id)}
                  </Text>
                  <Spacer />
                  <Image
                    systemName="minus.circle.fill"
                    size={22}
                    color={palette.danger}
                    modifiers={[contentShape(shapes.rectangle()), onTapGesture(() => hideCard(id))]}
                  />
                </HStack>
              );
            })}
          </List.ForEach>
        </Section>

        {hidden.length > 0 ? (
          <Section title={t('settings.hidden')}>
            {hidden.map((id) => {
              const meta = reportCardMeta(id);
              return (
                <HStack key={id} alignment="center" spacing={Space[3]} modifiers={[tag(id)]}>
                  <Image systemName={meta.icon as IconName} size={19} color={palette.textTertiary} />
                  <Text modifiers={[font({ size: 16 }), foregroundColor(palette.textPrimary)]}>
                    {reportCardTitle(id)}
                  </Text>
                  <Spacer />
                  <Image
                    systemName="plus.circle.fill"
                    size={22}
                    color={palette.ink}
                    modifiers={[contentShape(shapes.rectangle()), onTapGesture(() => showCard(id))]}
                  />
                </HStack>
              );
            })}
          </Section>
        ) : null}
      </SettingsList>
    </View>
  );
}
