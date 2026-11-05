import { describe, expect, it } from 'vitest';

import { automaticCategoryColorKey, CUSTOM_CATEGORY_COLORS, DEFAULT_CUSTOM_CATEGORY_COLOR } from './category-style';

describe('automatic category color', () => {
  it('assigns a supported color consistently for the same trimmed name', () => {
    const color = automaticCategoryColorKey('水果');
    expect(automaticCategoryColorKey(' 水果 ')).toBe(color);
    expect(CUSTOM_CATEGORY_COLORS.some((entry) => entry.key === color)).toBe(true);
  });

  it('provides a preview color before a name is entered', () => {
    expect(automaticCategoryColorKey('  ')).toBe(DEFAULT_CUSTOM_CATEGORY_COLOR);
  });
});
