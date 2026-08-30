import { afterEach, describe, expect, it } from 'vitest';

import { categorySearchNames, displayCategoryName } from './category-name';
import { setAppLocale } from './instance';

afterEach(() => {
  setAppLocale('zh');
});

describe('displayCategoryName', () => {
  it('translates system category names in English', () => {
    setAppLocale('en');
    expect(displayCategoryName('餐饮', true)).toBe('Dining');
    expect(displayCategoryName('工资', true)).toBe('Salary');
    expect(displayCategoryName('其他支出', true)).toBe('Other');
  });

  it('keeps the Chinese system name in Chinese', () => {
    setAppLocale('zh');
    expect(displayCategoryName('餐饮', true)).toBe('餐饮');
  });

  it('does not translate custom category names', () => {
    setAppLocale('en');
    expect(displayCategoryName('周末brunch', false)).toBe('周末brunch');
  });
});

describe('categorySearchNames', () => {
  it('includes both stored Chinese and English display names for system categories', () => {
    const names = categorySearchNames('餐饮', true);
    expect(names).toContain('餐饮');
    expect(names).toContain('Dining');
  });

  it('only includes the user name for custom categories', () => {
    expect(categorySearchNames('周末brunch', false)).toEqual(['周末brunch']);
  });
});
