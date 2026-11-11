import { describe, expect, it } from 'vitest';

import type { Category } from '@/api';
import { buildCategoryHierarchy } from '@/lib/category-hierarchy';
import { categoriesForType, isValidAmountInput, moveAmountBound, SEARCH_DATE_PRESETS } from './filter-logic';

function category(id: string, type: 'expense' | 'income'): Category {
  return {
    id,
    name: id,
    status: 'active',
    type,
    family_id: null,
    is_system: true,
    icon: null,
    color_key: null,
    created_at: '',
    updated_at: '',
  };
}

describe('search category and type filters', () => {
  const hierarchy = buildCategoryHierarchy([category('food', 'expense'), category('salary', 'income')], []);
  it('removes the other type while preserving selections of the chosen type', () => {
    const selected = new Set(['food', 'salary']);
    expect([...categoriesForType(selected, 'expense', hierarchy)]).toEqual(['food']);
    expect([...categoriesForType(selected, 'income', hierarchy)]).toEqual(['salary']);
    expect([...selected]).toEqual(['food', 'salary']);
  });
  it('keeps both types when switching to all and removes unavailable categories when selecting a type', () => {
    const selected = new Set(['food', 'salary', 'missing']);
    expect([...categoriesForType(selected, null, hierarchy)]).toEqual(['food', 'salary', 'missing']);
    expect([...categoriesForType(selected, 'expense', hierarchy)]).toEqual(['food']);
  });
});

describe('search amount slider', () => {
  it('accepts only safe, non-negative amounts with at most two decimal places', () => {
    expect(['', '0', '12.', '12.34'].every(isValidAmountInput)).toBe(true);
    expect(['-1', '1.234', '.', '1e3', '99999999999999999999999999'].some(isValidAmountInput)).toBe(false);
  });
  it('represents the outside ends as unlimited and clamps overlapping bounds', () => {
    expect(moveAmountBound('min', 0, 1000, '100', '500')).toEqual({ min: '', max: '500' });
    expect(moveAmountBound('max', 1, 1000, '100', '500')).toEqual({ min: '100', max: '' });
    expect(moveAmountBound('min', 0.9, 1000, '', '500')).toEqual({ min: '500', max: '500' });
    expect(moveAmountBound('max', 0.1, 1000, '200', '')).toEqual({ min: '200', max: '200' });
  });
  it('snaps both handles to multiples of ten without crossing manually entered bounds', () => {
    expect(moveAmountBound('min', 0.156, 1000, '', '')).toEqual({ min: '160', max: '' });
    expect(moveAmountBound('max', 0.144, 1000, '', '')).toEqual({ min: '', max: '140' });
    expect(moveAmountBound('min', 0.5, 1000, '', '103.50')).toEqual({ min: '100', max: '103.50' });
    expect(moveAmountBound('max', 0.01, 1000, '101.50', '')).toEqual({ min: '101.50', max: '110' });
  });
});

describe('search date presets', () => {
  it('places this year first and leaves unrestricted dates to the reset action', () => {
    expect(SEARCH_DATE_PRESETS).toEqual(['thisYear', 'thisMonth', 'lastMonth', 'last7', 'last30']);
  });
});
