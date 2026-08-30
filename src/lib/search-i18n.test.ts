import { describe, expect, it } from 'vitest';

import { categorySearchNames } from '../i18n/category-name';
import type { Tables } from './database.types';
import { EMPTY_FILTERS, runSearch } from './search';

type Transaction = Tables<'transactions'>;

function txn(partial: Partial<Transaction> & Pick<Transaction, 'id' | 'category_id'>): Transaction {
  return {
    family_id: 'fam',
    type: 'expense',
    amount: 1280,
    note: '午饭',
    occurred_at: '2026-08-01T12:00:00.000Z',
    recorder_user_id: 'me',
    source: 'normal',
    savings_goal_id: null,
    sync_status: 'synced',
    is_deleted: false,
    created_at: '2026-08-01T12:00:00.000Z',
    updated_at: '2026-08-01T12:00:00.000Z',
    last_editor_user_id: null,
    ...partial,
  };
}

describe('search bilingual category hit', () => {
  const row = txn({ id: 't1', category_id: 'food' });
  const ctx = {
    categoryNamesById: new Map([['food', categorySearchNames('餐饮', true)]]),
    recorderNameById: new Map<string, string>(),
    myId: 'me',
    meLabel: 'Me',
  };

  it('matches Dining in English UI', () => {
    const { matched } = runSearch([row], { ...EMPTY_FILTERS, keyword: 'Dining' }, ctx);
    expect(matched.map((item) => item.id)).toEqual(['t1']);
  });

  it('still matches the stored Chinese name', () => {
    const { matched } = runSearch([row], { ...EMPTY_FILTERS, keyword: '餐饮' }, ctx);
    expect(matched.map((item) => item.id)).toEqual(['t1']);
  });
});
