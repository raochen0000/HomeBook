import { Stack, useLocalSearchParams } from 'expo-router';

import { MonthlySummaryScreen } from '@/features/report/monthly-summary';
import { t, useLocalePreference } from '@/i18n';

/** 月度总结独立页（流程 9）：脉搏卡点击落本月至今；月初提醒落上月。`period` 决定初始月份。 */
export default function SummaryRoute() {
  useLocalePreference();
  const { period } = useLocalSearchParams<{ period?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('summary.title') }} />
      <MonthlySummaryScreen initialPeriod={period} />
    </>
  );
}
