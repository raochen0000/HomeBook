import type { Category, CategoryLayout } from '@/api/categories';

export type CategoryHierarchy = {
  categories: Category[];
  byId: Map<string, Category>;
  layoutById: Map<string, CategoryLayout>;
  childrenByParent: Map<string, string[]>;
};

export function buildCategoryHierarchy(categories: Category[], layout: CategoryLayout[]): CategoryHierarchy {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const layoutById = new Map(layout.map((item) => [item.category_id, item]));
  const childrenByParent = new Map<string, string[]>();
  for (const item of layout) {
    if (item.parent_category_id) {
      const children = childrenByParent.get(item.parent_category_id) ?? [];
      children.push(item.category_id);
      childrenByParent.set(item.parent_category_id, children);
    }
  }
  return { categories, byId, layoutById, childrenByParent };
}

export function categoryRootId(id: string, hierarchy: CategoryHierarchy): string {
  return hierarchy.layoutById.get(id)?.parent_category_id ?? id;
}

/** A group ID also represents old, directly recorded transactions. */
export function categoryDescendantIds(id: string, hierarchy: CategoryHierarchy): string[] {
  return [id, ...(hierarchy.childrenByParent.get(id) ?? [])];
}

export function expandCategoryIds(ids: string[], hierarchy: CategoryHierarchy): string[] {
  return [...new Set(ids.flatMap((id) => categoryDescendantIds(id, hierarchy)))];
}

export function matchingCategoryIds(
  keyword: string,
  hierarchy: CategoryHierarchy,
  names: (category: Category) => string[],
  unspecified: string,
): string[] {
  const normalized = keyword.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const matched = new Set<string>();
  for (const category of hierarchy.categories) {
    const item = hierarchy.layoutById.get(category.id);
    if (names(category).some((name) => name.toLocaleLowerCase().includes(normalized))) {
      for (const id of categoryDescendantIds(category.id, hierarchy)) matched.add(id);
    }
    if (
      item?.is_group &&
      (hierarchy.childrenByParent.get(category.id)?.length ?? 0) > 0 &&
      unspecified.toLocaleLowerCase().includes(normalized)
    )
      matched.add(category.id);
  }
  return [...matched];
}

export function categoryPath(
  id: string,
  hierarchy: CategoryHierarchy,
  displayName: (category: Category) => string,
  unspecified: string,
): string | null {
  const category = hierarchy.byId.get(id);
  if (!category) return null;
  const item = hierarchy.layoutById.get(id);
  if (item?.is_group && (hierarchy.childrenByParent.get(id)?.length ?? 0) > 0)
    return `${displayName(category)} / ${unspecified}`;
  const parent = item?.parent_category_id ? hierarchy.byId.get(item.parent_category_id) : undefined;
  return parent ? `${displayName(parent)} / ${displayName(category)}` : displayName(category);
}

export function selectableCategories(
  hierarchy: CategoryHierarchy,
  type: 'expense' | 'income',
  hidden: Set<string>,
  editingId?: string | null,
): Category[] {
  const positions = new Map(hierarchy.categories.map((category, index) => [category.id, index]));
  return hierarchy.categories
    .filter((category) => {
      if (category.type !== type || category.name.startsWith('储蓄·')) return false;
      if (category.id === editingId) return true;
      if (category.status !== 'active' || hidden.has(category.id)) return false;
      const item = hierarchy.layoutById.get(category.id);
      if (item?.is_group && !item.legacy_entry) return false;
      if (item?.parent_category_id) {
        const parent = hierarchy.byId.get(item.parent_category_id);
        if (!parent || parent.status !== 'active' || hidden.has(parent.id)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aRoot = categoryRootId(a.id, hierarchy);
      const bRoot = categoryRootId(b.id, hierarchy);
      return (
        (positions.get(aRoot) ?? 0) - (positions.get(bRoot) ?? 0) ||
        (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0)
      );
    });
}

/** A root is selectable only while it has no children. */
export function selectableRecordCategories(
  hierarchy: CategoryHierarchy,
  type: 'expense' | 'income',
  hidden: Set<string>,
  editingId?: string | null,
): Category[] {
  const selectable = selectableCategories(hierarchy, type, hidden, editingId);
  const eligibleIds = new Set(selectable.map((category) => category.id));
  const positions = new Map(hierarchy.categories.map((category, index) => [category.id, index]));
  return hierarchy.categories
    .filter((category) => {
      const item = hierarchy.layoutById.get(category.id);
      if (item?.parent_category_id) return eligibleIds.has(category.id);
      if ((hierarchy.childrenByParent.get(category.id)?.length ?? 0) > 0) return false;
      if (category.type !== type || category.name.startsWith('储蓄·')) return false;
      return category.id === editingId || (category.status === 'active' && !hidden.has(category.id));
    })
    .sort((a, b) => {
      return (
        (positions.get(categoryRootId(a.id, hierarchy)) ?? 0) - (positions.get(categoryRootId(b.id, hierarchy)) ?? 0) ||
        (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0)
      );
    });
}
