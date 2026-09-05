/** React Query 的查询键工厂，集中管理便于失效。 */
export const queryKeys = {
  profile: ['profile'] as const,
  family: ['family'] as const,
  familyMembers: ['family_members'] as const,
  memberships: ['memberships'] as const,
  notifications: ['notifications'] as const,
  notificationsAll: ['notifications', 'all'] as const,
  notificationPrefs: ['notification_preferences'] as const,
  accountingPrefs: ['accounting_preferences'] as const,
  recurringRules: ['recurring_transactions'] as const,
  categories: (type?: 'expense' | 'income') => ['categories', type ?? 'all'] as const,
  hiddenCategories: ['hidden_categories'] as const,
  transactions: ['transactions'] as const,
  transaction: (id: string) => ['transactions', 'detail', id] as const,
  hasTransactions: (familyId: string) => ['transactions', 'has-any', familyId] as const,
  savingsGoals: ['savings_goals'] as const,
  savingsEntries: (goalId: string) => ['savings_entries', goalId] as const,
  budget: (period: string) => ['budget', period] as const,
  homeDashboard: (period: string) => ['home_dashboard', period] as const,
  analytics: ['analytics'] as const,
  budgetProgress: (period: string) => ['analytics', 'budget-progress', period] as const,
  monthlySummary: (period: string) => ['analytics', 'monthly-summary', period] as const,
  familyActivity: ['analytics', 'family-activity'] as const,
  reportAnalytics: (input: {
    start: string;
    end: string;
    previousStart: string;
    historyStart: string;
    memberIds: string[];
    categoryIds: string[];
  }) =>
    [
      'analytics',
      'report',
      input.start,
      input.end,
      input.previousStart,
      input.historyStart,
      input.memberIds,
      input.categoryIds,
    ] as const,
};
