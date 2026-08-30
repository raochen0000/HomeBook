/**
 * G10 记账设置（PRD §18.3.1 + §18 自定义能力 / DESIGN §10.5）。原生 SwiftUI List/Section 实现。
 *
 * 个人级偏好，改动即时落库、无「保存」按钮（accounting_preferences，服务端持久化，乐观更新）：
 *   - 记账偏好：默认记账类型 / 记一笔后行为（Picker 下拉）、金额隐私模式（开关）；金额恒显角分不设开关。
 *   - 报表与自动化：报表卡片（显隐 + 拖动排序，子页）、定时收支（每月自动记一笔，子页）。
 */
import { Section } from '@expo/ui/swift-ui';
import { Stack, useRouter, type Href } from 'expo-router';
import { View } from 'react-native';

import {
  DEFAULT_ACCOUNTING_PREFS,
  useAccountingPrefs,
  useRecurringRules,
  useSaveAccountingPrefs,
  type AfterRecordBehavior,
  type DefaultTxnType,
} from '@/api';
import { t } from '@/i18n';
import { usePalette } from '@/constants/design';
import { InfoCaption, MenuRow, Row, SettingsList, ToggleRow } from '@/features/settings/native-list';
import { resolveCardLayout, TOTAL_CARDS } from '@/lib/report-cards';

export default function RecordSettingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { data } = useAccountingPrefs();
  const save = useSaveAccountingPrefs();
  const rulesQ = useRecurringRules();

  // 加载中 / 行不存在时回落默认；乐观更新让控件即时响应。
  const prefs = data ?? DEFAULT_ACCOUNTING_PREFS;

  const { visible } = resolveCardLayout(prefs.report_card_order, prefs.report_card_hidden);
  const ruleCount = rulesQ.data?.length ?? 0;

  return (
    <View style={{ flex: 1, backgroundColor: palette.base }}>
      <Stack.Screen options={{ headerShown: true, title: t('settings.recordSettings') }} />
      <SettingsList>
        <Section title={t('settings.recordPrefs')} footer={<InfoCaption text={t('settings.amountPrivacyHint')} />}>
          <MenuRow<DefaultTxnType>
            icon="arrow.left.arrow.right"
            label={t('settings.defaultType')}
            selection={prefs.default_txn_type}
            tintColor={palette.textSecondary}
            onSelectionChange={(v) => save.mutate({ ...prefs, default_txn_type: v })}
            options={[
              { value: 'expense', label: t('record.expense') },
              { value: 'income', label: t('record.income') },
            ]}
          />
          <MenuRow<AfterRecordBehavior>
            icon="checkmark.circle"
            label={t('settings.afterRecord')}
            selection={prefs.after_record_behavior}
            tintColor={palette.textSecondary}
            onSelectionChange={(v) => save.mutate({ ...prefs, after_record_behavior: v })}
            options={[
              { value: 'close', label: t('settings.afterClose') },
              { value: 'continue', label: t('settings.afterContinue') },
            ]}
          />
          <ToggleRow
            icon="eye.slash.fill"
            label={t('settings.amountPrivacy')}
            value={prefs.amount_privacy}
            onValueChange={(v) => save.mutate({ ...prefs, amount_privacy: v })}
          />
        </Section>

        <Section title={t('settings.homeSection')} footer={<InfoCaption text={t('settings.summaryBannerHint')} />}>
          <ToggleRow
            icon="doc.text.fill"
            label={t('settings.summaryBanner')}
            value={prefs.show_monthly_summary_entry}
            onValueChange={(v) => save.mutate({ ...prefs, show_monthly_summary_entry: v })}
          />
        </Section>

        <Section title={t('settings.reportAuto')} footer={<InfoCaption text={t('settings.recordHint')} />}>
          <Row
            icon="rectangle.grid.1x2.fill"
            label={t('settings.reportCards')}
            value={t('settings.shownCards', { visible: visible.length, total: TOTAL_CARDS })}
            onPress={() => router.push('/settings/report-cards' as Href)}
          />
          <Row
            icon="clock.arrow.circlepath"
            label={t('settings.recurring')}
            value={ruleCount > 0 ? t('settings.ruleCount', { count: ruleCount }) : t('settings.notSet')}
            onPress={() => router.push('/settings/recurring' as Href)}
          />
        </Section>
      </SettingsList>
    </View>
  );
}
