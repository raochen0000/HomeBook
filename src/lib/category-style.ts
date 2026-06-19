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

export function categoryColorKey(name: string, type: 'income' | 'expense'): CategoryColorKey {
  return NAME_TO_COLOR[name] ?? (type === 'income' ? 'incomeGeneric' : 'other');
}

/** 兜底 SF Symbol（分类无 icon 时）。 */
export function categorySymbol(icon: string | null, type: 'income' | 'expense'): string {
  if (icon) return icon;
  return type === 'income' ? 'plus.circle.fill' : 'circle.fill';
}
