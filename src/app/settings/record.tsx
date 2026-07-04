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
import { usePalette } from '@/constants/design';
import { Caption, MenuRow, Row, SettingsList, ToggleRow } from '@/features/settings/native-list';
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
      <Stack.Screen options={{ headerShown: true, title: '记账设置' }} />
      <SettingsList>
        {/* 记账偏好（PRD §18.3.1） */}
        <Section title="记账偏好">
          <MenuRow<DefaultTxnType>
            icon="arrow.left.arrow.right"
            label="默认记账类型"
            selection={prefs.default_txn_type}
            onSelectionChange={(v) => save.mutate({ ...prefs, default_txn_type: v })}
            options={[
              { value: 'expense', label: '支出' },
              { value: 'income', label: '收入' },
            ]}
          />
          <MenuRow<AfterRecordBehavior>
            icon="checkmark.circle"
            label="记一笔后"
            selection={prefs.after_record_behavior}
            onSelectionChange={(v) => save.mutate({ ...prefs, after_record_behavior: v })}
            options={[
              { value: 'close', label: '保存即关' },
              { value: 'continue', label: '继续记下一笔' },
            ]}
          />
          <ToggleRow
            icon="eye.slash.fill"
            label="金额隐私模式"
            value={prefs.amount_privacy}
            onValueChange={(v) => save.mutate({ ...prefs, amount_privacy: v })}
          />
        </Section>
        <Caption text="开启金额隐私后，首页与报表金额显示为 ****，防窥屏。金额恒定显示到角分（两位小数）。" />

        {/* 首页展示 */}
        <Section title="首页">
          <ToggleRow
            icon="doc.text.fill"
            label="月度总结横幅"
            value={prefs.show_monthly_summary_entry}
            onValueChange={(v) => save.mutate({ ...prefs, show_monthly_summary_entry: v })}
          />
        </Section>
        <Caption text="关闭后，首页不再显示「上月总结来啦」月度总结入口横幅；月度总结仍可点脉搏卡进入。" />

        {/* 报表与自动化 */}
        <Section title="报表与自动化">
          <Row
            icon="rectangle.grid.1x2.fill"
            label="报表卡片"
            value={`已展示 ${visible.length}/${TOTAL_CARDS}`}
            onPress={() => router.push('/settings/report-cards' as Href)}
          />
          <Row
            icon="clock.arrow.circlepath"
            label="定时收支"
            value={ruleCount > 0 ? `${ruleCount} 条规则` : '未设置'}
            onPress={() => router.push('/settings/recurring' as Href)}
          />
        </Section>
        <Caption text="报表卡片可拖动排序、自由显隐（「收支概览」常驻，至少展示 3 个）。定时收支按「每月 N 号」自动记一笔，如工资、订阅。" />
      </SettingsList>
    </View>
  );
}
