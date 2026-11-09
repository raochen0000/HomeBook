import { describe, expect, it } from 'vitest';

import type { Category, CategoryLayout } from '@/api/categories';

import {
  buildCategoryHierarchy,
  categoryDescendantIds,
  categoryPath,
  matchingCategoryIds,
  selectableCategories,
  selectableRecordCategories,
} from './category-hierarchy';

function category(id: string, name: string, status = 'active'): Category {
  return {
    id,
    name,
    status,
    type: 'expense',
    family_id: null,
    is_system: true,
    icon: null,
    color_key: null,
    created_at: '',
    updated_at: '',
  };
}
function layout(categoryId: string, parentId: string | null, legacy = false): CategoryLayout {
  return {
    family_id: 'family',
    category_id: categoryId,
    parent_category_id: parentId,
    is_group: parentId === null,
    legacy_entry: legacy,
    created_at: '',
  };
}

describe('category hierarchy', () => {
  const categories = [
    category('food', '餐饮'),
    category('travel', '交通'),
    category('breakfast', '早餐'),
    category('old', '旧分类', 'archived'),
  ];
  const tree = buildCategoryHierarchy(categories, [
    layout('food', null, true),
    layout('breakfast', 'food'),
    layout('old', 'food'),
  ]);
  const name = (item: Category) => item.name;

  it('preserves old direct entries and expands a parent without duplicates', () => {
    expect(categoryDescendantIds('food', tree)).toEqual(['food', 'breakfast', 'old']);
    expect(categoryPath('food', tree, name, '未细分')).toBe('餐饮 / 未细分');
    expect(categoryPath('breakfast', tree, name, '未细分')).toBe('餐饮 / 早餐');
    expect(categoryPath('travel', tree, name, '未细分')).toBe('交通');
  });

  it('keeps the picker flat and hides children when their parent is hidden', () => {
    expect(selectableCategories(tree, 'expense', new Set()).map((item) => item.id)).toEqual([
      'food',
      'breakfast',
      'travel',
    ]);
    expect(selectableCategories(tree, 'expense', new Set(['food'])).map((item) => item.id)).toEqual(['travel']);
    expect(selectableCategories(tree, 'expense', new Set(['food']), 'old').map((item) => item.id)).toEqual([
      'old',
      'travel',
    ]);
  });

  it('does not expose an empty newly created parent as an entry category', () => {
    const empty = buildCategoryHierarchy([category('group', '餐饮')], [layout('group', null)]);
    expect(selectableCategories(empty, 'expense', new Set())).toEqual([]);
  });

  it('offers roots without children and excludes parents with children', () => {
    expect(selectableRecordCategories(tree, 'expense', new Set()).map((item) => item.id)).toEqual([
      'breakfast',
      'travel',
    ]);
    expect(selectableRecordCategories(tree, 'expense', new Set(), 'food').map((item) => item.id)).toEqual([
      'breakfast',
      'travel',
    ]);
    expect(selectableRecordCategories(tree, 'expense', new Set(['food']), 'old').map((item) => item.id)).toEqual([
      'old',
      'travel',
    ]);
  });

  it('switches from a root to its children without changing historical IDs', () => {
    const root = category('root', '工资');
    const child = category('child', '奖金');
    const before = buildCategoryHierarchy([root], [layout('root', null)]);
    const after = buildCategoryHierarchy([root, child], [layout('root', null), layout('child', 'root')]);
    expect(selectableRecordCategories(before, 'expense', new Set()).map((item) => item.id)).toEqual(['root']);
    expect(categoryPath('root', before, name, '未细分')).toBe('工资');
    expect(selectableRecordCategories(after, 'expense', new Set()).map((item) => item.id)).toEqual(['child']);
    expect(categoryPath('root', after, name, '未细分')).toBe('工资 / 未细分');
    expect(selectableRecordCategories(after, 'expense', new Set(['child']))).toEqual([]);
  });

  it('matches parent names to descendants while keeping unspecified searches specific', () => {
    const names = (item: Category) => [item.name];
    expect(matchingCategoryIds('餐饮', tree, names, '未细分')).toEqual(['food', 'breakfast', 'old']);
    expect(matchingCategoryIds('早餐', tree, names, '未细分')).toEqual(['breakfast']);
    expect(matchingCategoryIds('未细分', tree, names, '未细分')).toEqual(['food']);
  });
});
