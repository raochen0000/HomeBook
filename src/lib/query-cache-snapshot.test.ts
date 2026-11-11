import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { createQueryCacheSnapshot, parseQueryCacheSnapshot, restoreQueryCacheSnapshot } from './query-cache-snapshot';

describe('persisted query cache', () => {
  it('retains only the first feed page, excludes critical notifications, and restores budget maps', () => {
    const client = new QueryClient();
    client.setQueryData(['profile'], { id: 'user-1', current_family_id: 'family-1' });
    client.setQueryData(['family'], { id: 'family-1' });
    client.setQueryData(['categories', 'including-archived'], [{ id: 'food' }]);
    client.setQueryData(['category_layout'], []);
    client.setQueryData(['hidden_categories'], []);
    client.setQueryData(['transactions', 'home-feed', 'family-1'], {
      pages: [{ items: [{ id: 'new' }], nextCursor: { id: 'new' } }, { items: [{ id: 'old' }] }],
      pageParams: [null, { id: 'new' }],
    });
    client.setQueryData(['analytics', 'budget-progress', '2026-11'], {
      usedAmount: 200,
      byCategory: new Map([['food', 200]]),
    });
    client.setQueryData(['notifications'], [{ type: 'removed' }]);
    client.setQueryData(['notifications', 'all'], [{ id: 'old' }]);

    const raw = JSON.stringify(createQueryCacheSnapshot(client, 'user-1', 'family-1'));
    const parsed = parseQueryCacheSnapshot(raw, 'user-1');
    expect(parsed).not.toBeNull();
    expect(parseQueryCacheSnapshot(raw, 'user-2')).toBeNull();
    expect(parsed?.queries.some((query) => query.key.length === 1 && query.key[0] === 'notifications')).toBe(false);

    const restored = new QueryClient();
    if (!parsed) throw new Error('Expected a valid snapshot');
    restoreQueryCacheSnapshot(restored, parsed);
    expect(restored.getQueryData(['transactions', 'home-feed', 'family-1'])).toEqual({
      pages: [{ items: [{ id: 'new' }], nextCursor: { id: 'new' } }],
      pageParams: [null],
    });
    expect(restored.getQueryData(['analytics', 'budget-progress', '2026-11'])).toEqual({
      usedAmount: 200,
      byCategory: new Map([['food', 200]]),
    });
  });

  it('does not restore an incomplete category hierarchy', () => {
    const client = new QueryClient();
    client.setQueryData(['categories', 'including-archived'], [{ id: 'food' }]);
    client.setQueryData(['category_layout'], []);
    const snapshot = createQueryCacheSnapshot(client, 'user-1', 'family-1');
    expect(snapshot.queries).toEqual([]);
  });

  it('bounds cache size while keeping core family and homepage queries', () => {
    const client = new QueryClient();
    client.setQueryData(['family'], { id: 'family-1' });
    client.setQueryData(['home_dashboard', '2026-11'], { transaction_count: 1 });
    client.setQueryData(['analytics', 'report', 'oversized'], 'x'.repeat(260_000));
    const snapshot = createQueryCacheSnapshot(client, 'user-1', 'family-1');
    expect(snapshot.queries.some((query) => query.key[0] === 'family')).toBe(true);
    expect(snapshot.queries.some((query) => query.key[0] === 'home_dashboard')).toBe(true);
    expect(snapshot.queries.some((query) => query.key[0] === 'analytics')).toBe(false);
    expect(JSON.stringify(snapshot).length).toBeLessThan(250_000);
  });

  it('limits the number of retained queries and favors recent non-core results', () => {
    const client = new QueryClient();
    client.setQueryData(['family'], { id: 'family-1' });
    for (let index = 0; index < 50; index += 1) {
      client.setQueryData(['analytics', 'report', index], { count: index }, { updatedAt: index + 1 });
    }
    const snapshot = createQueryCacheSnapshot(client, 'user-1', 'family-1');
    expect(snapshot.queries).toHaveLength(40);
    expect(snapshot.queries.some((query) => query.key[0] === 'family')).toBe(true);
    expect(snapshot.queries.some((query) => query.key[2] === 49)).toBe(true);
    expect(snapshot.queries.some((query) => query.key[2] === 0)).toBe(false);
  });

  it('rejects corrupted, wrong-version and unexpected query entries', () => {
    expect(parseQueryCacheSnapshot('{', 'user-1')).toBeNull();
    expect(
      parseQueryCacheSnapshot(JSON.stringify({ version: 2, userId: 'user-1', familyId: 'f', queries: [] }), 'user-1'),
    ).toBeNull();
    expect(
      parseQueryCacheSnapshot(
        JSON.stringify({
          version: 1,
          userId: 'user-1',
          familyId: 'f',
          queries: [{ key: ['auth-token'], data: 'secret', updatedAt: 1 }],
        }),
        'user-1',
      ),
    ).toBeNull();
  });
});
