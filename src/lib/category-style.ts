/**
 * 分类 → 识别色 + SF Symbol。
 * SF Symbol 直接取分类记录里存的 icon（见种子迁移 0010）；
 * 识别色按分类名映射到 DESIGN §9.1 的功能色，未命中按收支类型兜底。
 */
import type { CategoryColorKey } from '@/constants/design';

/** 分类名 → 识别色 key。 */
const NAME_TO_COLOR: Record<string, CategoryColorKey> = {
  餐饮: 'food',
  交通: 'transit',
  购物: 'shopping',
  居家: 'home',
  娱乐: 'entertainment',
  医疗: 'medical',
  教育: 'education',
  人情: 'social',
  '储蓄·目标存入': 'saving',
  '储蓄·目标取出': 'saving',
  工资: 'incomeGeneric',
  奖金: 'incomeGeneric',
  理财: 'incomeGeneric',
};

/** 自定义分类可选的 24 色；顺序交错冷暖色，方便在 6 × 4 网格中一眼区分。展示名用 `t('categoryColors.' + key)`。 */
export const CUSTOM_CATEGORY_COLORS = [
  { key: 'food' },
  { key: 'transit' },
  { key: 'shopping' },
  { key: 'home' },
  { key: 'entertainment' },
  { key: 'medical' },
  { key: 'apricot' },
  { key: 'sky' },
  { key: 'rose' },
  { key: 'mint' },
  { key: 'plum' },
  { key: 'ochre' },
  { key: 'coral' },
  { key: 'periwinkle' },
  { key: 'social' },
  { key: 'olive' },
  { key: 'amber' },
  { key: 'aqua' },
  { key: 'lavender' },
  { key: 'incomeGeneric' },
  { key: 'saving' },
  { key: 'education' },
  { key: 'sand' },
  { key: 'slate' },
] as const satisfies readonly { key: CategoryColorKey }[];

export type CustomCategoryColorKey = (typeof CUSTOM_CATEGORY_COLORS)[number]['key'];

export const DEFAULT_CUSTOM_CATEGORY_COLOR: CustomCategoryColorKey = 'entertainment';

const CUSTOM_CATEGORY_COLOR_KEY_SET = new Set<string>(CUSTOM_CATEGORY_COLORS.map(({ key }) => key));

/** 为旧自定义分类提供可保存的颜色回退，绝不将灰色兜底写回 color_key。 */
export function customCategoryColorKey(colorKey?: string | null): CustomCategoryColorKey {
  return colorKey && CUSTOM_CATEGORY_COLOR_KEY_SET.has(colorKey)
    ? (colorKey as CustomCategoryColorKey)
    : DEFAULT_CUSTOM_CATEGORY_COLOR;
}

const CATEGORY_COLOR_KEYS = new Set<string>(
  Object.keys(NAME_TO_COLOR).concat(CUSTOM_CATEGORY_COLORS.map(({ key }) => key)),
);

/** color_key 有效时优先使用；系统分类及旧数据仍按名称映射兜底。 */
export function categoryColorKey(name: string, type: 'income' | 'expense', colorKey?: string | null): CategoryColorKey {
  if (colorKey && CATEGORY_COLOR_KEYS.has(colorKey)) return colorKey as CategoryColorKey;
  return NAME_TO_COLOR[name] ?? (type === 'income' ? 'incomeGeneric' : 'other');
}

/** 兜底 SF Symbol（分类无 icon 时）。 */
export function categorySymbol(icon: string | null, type: 'income' | 'expense'): string {
  if (icon) return icon;
  return type === 'income' ? 'plus.circle.fill' : 'circle.fill';
}
