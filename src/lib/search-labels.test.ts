import { afterEach, describe, expect, it } from 'vitest';

import { setAppLocale } from '../i18n/instance';
import { compactAmountFilterLabel, customDateFilterLabel, summarizeSelectedLabels } from './search-labels';

afterEach(() => {
  setAppLocale('zh');
});

describe('summarizeSelectedLabels', () => {
  it('joins and collapses extra selections', () => {
    expect(summarizeSelectedLabels(['娱乐'])).toBe('娱乐');
    expect(summarizeSelectedLabels(['娱乐', '餐饮'])).toBe('娱乐 餐饮');
    expect(summarizeSelectedLabels(['娱乐', '餐饮', '医疗'])).toBe('娱乐 餐饮 +1');
    expect(summarizeSelectedLabels(['我', '小王', '妈妈', '爸爸'])).toBe('我 小王 +2');
  });
});

describe('compactAmountFilterLabel', () => {
  it('formats amount chips in the default locale', () => {
    expect(compactAmountFilterLabel('', '')).toBe('金额');
    expect(compactAmountFilterLabel('100', '500')).toBe('¥100–500');
    expect(compactAmountFilterLabel('10000', '50000')).toBe('¥1万–5万');
    expect(compactAmountFilterLabel('100', '')).toBe('¥100+');
    expect(compactAmountFilterLabel('', '500')).toBe('≤¥500');
    setAppLocale('en');
    expect(compactAmountFilterLabel('10000', '50000')).toBe('¥10k–50k');
    expect(compactAmountFilterLabel('', '')).toBe('Amount');
  });
});

describe('customDateFilterLabel', () => {
  it('omits year within the same calendar year as today', () => {
    expect(customDateFilterLabel(new Date(2026, 5, 1), new Date(2026, 5, 30), new Date(2026, 6, 4))).toBe(
      '06/01–06/30',
    );
  });

  it('includes year when the range crosses years', () => {
    expect(customDateFilterLabel(new Date(2025, 11, 31), new Date(2026, 0, 2), new Date(2026, 6, 4))).toBe(
      '2025/12/31–2026/01/02',
    );
  });
});
