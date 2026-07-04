import { compactAmountFilterLabel, customDateFilterLabel, summarizeSelectedLabels } from './search-labels';

function expectEqual(actual: string, expected: string) {
  if (actual !== expected) {
    throw new Error(`Expected "${expected}", got "${actual}"`);
  }
}

expectEqual(summarizeSelectedLabels(['娱乐']), '娱乐');
expectEqual(summarizeSelectedLabels(['娱乐', '餐饮']), '娱乐 餐饮');
expectEqual(summarizeSelectedLabels(['娱乐', '餐饮', '医疗']), '娱乐 餐饮 +1');
expectEqual(summarizeSelectedLabels(['我', '小王', '妈妈', '爸爸']), '我 小王 +2');

expectEqual(compactAmountFilterLabel('', ''), '金额');
expectEqual(compactAmountFilterLabel('100', '500'), '¥100–500');
expectEqual(compactAmountFilterLabel('10000', '50000'), '¥1万–5万');
expectEqual(compactAmountFilterLabel('100', ''), '¥100+');
expectEqual(compactAmountFilterLabel('', '500'), '≤¥500');

expectEqual(customDateFilterLabel(new Date(2026, 5, 1), new Date(2026, 5, 30), new Date(2026, 6, 4)), '06/01–06/30');
expectEqual(
  customDateFilterLabel(new Date(2025, 11, 31), new Date(2026, 0, 2), new Date(2026, 6, 4)),
  '2025/12/31–2026/01/02',
);
