import { describe, expect, it } from 'vitest';

import {
  buildScopeCardLayout,
  DEFAULT_SCOPE_CARD_ORDER,
  encodeScopeCardLayouts,
  resolveAllScopeCardLayouts,
  resolveScopeCardLayout,
} from './report-cards';

describe('resolveScopeCardLayout', () => {
  it('uses each page default when nothing is saved, and savings goals stay on balance only', () => {
    const layouts = resolveAllScopeCardLayouts([], []);

    expect(layouts.expense.visible).toEqual(DEFAULT_SCOPE_CARD_ORDER.expense);
    expect(layouts.expense.visible).not.toContain('savings_goals');
    expect(layouts.income.visible).toEqual(DEFAULT_SCOPE_CARD_ORDER.income);
    expect(layouts.balance.visible).toEqual(DEFAULT_SCOPE_CARD_ORDER.balance);
    expect(layouts.balance.visible).toContain('savings_goals');
    expect(layouts.expense.hidden).toEqual([]);
  });

  it('keeps visibility and order independent across pages', () => {
    const expense = resolveScopeCardLayout(
      'expense',
      ['expense:overview', 'expense:insights', 'expense:budget'],
      ['expense:insights', 'income:budget', 'insights'],
    );
    const income = resolveScopeCardLayout('income', ['income:overview', 'income:insights'], ['expense:insights']);

    expect(expense.visible[0]).toBe('overview');
    expect(expense.hidden).toContain('insights');
    expect(expense.visible).not.toContain('insights');
    expect(expense.order).not.toContain('savings_goals');
    expect(income.visible).toContain('insights');
    expect(income.hidden).toEqual([]);
  });

  it('ignores unprefixed legacy ids and cards that do not belong to the page', () => {
    const layout = resolveScopeCardLayout(
      'expense',
      ['budget', 'expense:savings_goals', 'overview'],
      ['savings_goals'],
    );

    expect(layout.visible).toEqual(DEFAULT_SCOPE_CARD_ORDER.expense);
    expect(layout.hidden).toEqual([]);
  });

  it('appends a newly registered card and keeps overview pinned and visible', () => {
    const layout = resolveScopeCardLayout(
      'income',
      ['income:income_trend', 'income:overview'],
      ['income:overview', 'income:more_stats'],
    );

    expect(layout.order[0]).toBe('overview');
    expect(layout.order[1]).toBe('income_trend');
    expect(layout.visible[0]).toBe('overview');
    expect(layout.hidden).toContain('more_stats');
    expect(layout.hidden).not.toContain('overview');
    expect(layout.order).toEqual([
      'overview',
      'income_trend',
      'income_structure',
      'income_target',
      'more_stats',
      'insights',
    ]);
  });

  it('round-trips an edited layout', () => {
    const initial = resolveAllScopeCardLayouts([], []);
    const edited = {
      ...initial,
      expense: buildScopeCardLayout(
        [
          'overview',
          'expense_category',
          'budget',
          'expense_trend',
          'category_mom',
          'member',
          'more_stats',
          'top_expenses',
          'insights',
        ],
        ['budget', 'insights'],
      ),
    };
    const encoded = encodeScopeCardLayouts(edited);
    expect(encoded.report_card_order.every((id) => id.includes(':'))).toBe(true);
    expect(encoded.report_card_hidden).toEqual(['expense:budget', 'expense:insights']);
    expect(resolveAllScopeCardLayouts(encoded.report_card_order, encoded.report_card_hidden)).toEqual(edited);
  });
});
