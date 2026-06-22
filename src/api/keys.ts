/** React Query 的查询键工厂，集中管理便于失效。 */
export const queryKeys = {
  profile: ['profile'] as const,
  family: ['family'] as const,
  familyMembers: ['family_members'] as const,
  memberships: ['memberships'] as const,
  notifications: ['notifications'] as const,
  notificationsAll: ['notifications', 'all'] as const,
  categories: (type?: 'expense' | 'income') => ['categories', type ?? 'all'] as const,
  hiddenCategories: ['hidden_categories'] as const,
  transactions: ['transactions'] as const,
  savingsGoals: ['savings_goals'] as const,
  savingsEntries: (goalId: string) => ['savings_entries', goalId] as const,
  budget: (period: string) => ['budget', period] as const,
};
