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

/** 自定义分类可选的 24 色；顺序交错冷暖色，方便在 6 × 4 网格中一眼区分。 */
export const CUSTOM_CATEGORY_COLORS = [
  { key: 'food', label: '蜜桃' },
  { key: 'transit', label: '湖蓝' },
  { key: 'shopping', label: '玫瑰' },
  { key: 'home', label: '鼠尾草' },
  { key: 'entertainment', label: '紫藤' },
  { key: 'medical', label: '靛青' },
  { key: 'apricot', label: '杏黄' },
  { key: 'sky', label: '天青' },
  { key: 'rose', label: '莓红' },
  { key: 'mint', label: '薄荷' },
  { key: 'plum', label: '梅子' },
  { key: 'ochre', label: '麦穗' },
  { key: 'coral', label: '珊瑚' },
  { key: 'periwinkle', label: '雾蓝' },
  { key: 'social', label: '藕粉' },
  { key: 'olive', label: '橄榄' },
  { key: 'amber', label: '琥珀' },
  { key: 'aqua', label: '碧青' },
  { key: 'lavender', label: '薰衣草' },
  { key: 'incomeGeneric', label: '森林' },
  { key: 'saving', label: '沙棕' },
  { key: 'education', label: '青绿' },
  { key: 'sand', label: '暖灰' },
  { key: 'slate', label: '岩灰' },
] as const satisfies readonly { key: CategoryColorKey; label: string }[];

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
