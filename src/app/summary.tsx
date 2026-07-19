import { useLocalSearchParams, useRouter } from 'expo-router';

import { MonthlySummaryScreen } from '@/features/report/monthly-summary';

/** 月度总结独立页（流程 9）：脉搏卡点击落本月至今；月初提醒落上月。`period` 决定初始月份。 */
export default function SummaryRoute() {
  const router = useRouter();
  const { period } = useLocalSearchParams<{ period?: string }>();
  return <MonthlySummaryScreen initialPeriod={period} onClose={() => router.back()} />;
}
