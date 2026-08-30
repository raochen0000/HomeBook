/** 系统分类中文存库名 → 稳定 code。库内 name 与储蓄 RPC 不得改名。 */
export const SYSTEM_CATEGORY_CODE: Record<string, string> = {
  餐饮: 'food',
  交通: 'transit',
  购物: 'shopping',
  居家: 'home',
  娱乐: 'entertainment',
  医疗: 'medical',
  教育: 'education',
  人情: 'social',
  其他支出: 'otherExpense',
  工资: 'salary',
  奖金: 'bonus',
  理财: 'investment',
  其他收入: 'otherIncome',
  '储蓄·目标存入': 'savingIn',
  '储蓄·目标取出': 'savingOut',
};

export function systemCategoryCode(name: string): string | null {
  return SYSTEM_CATEGORY_CODE[name] ?? null;
}
