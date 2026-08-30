import { t } from './instance';
import en from './resources/en';
import zhHans from './resources/zh-Hans';
import { systemCategoryCode } from './system-categories';

export function displayCategoryName(name: string, isSystem = true): string {
  if (!isSystem) return name;
  const code = systemCategoryCode(name);
  if (!code) return name;
  return t(`categories.${code}`);
}

/** 系统分类同时提供中英名，便于任一界面语言下用 Dining 或「餐饮」搜索。 */
export function categorySearchNames(name: string, isSystem: boolean): string[] {
  const names = [name];
  if (!isSystem) return names;
  const code = systemCategoryCode(name);
  if (!code) return names;
  const zh = zhHans.categories[code as keyof typeof zhHans.categories];
  const english = en.categories[code as keyof typeof en.categories];
  if (zh && !names.includes(zh)) names.push(zh);
  if (english && !names.includes(english)) names.push(english);
  return names;
}
