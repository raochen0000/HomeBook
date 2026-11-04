import { describe, expect, it } from 'vitest';
import { buildExpensePeriodStats } from './more-stats';

describe('buildExpensePeriodStats', () => {
  it('handles a cross-year week, excluding future days from averages', () => {
    const stats = buildExpensePeriodStats(
      [
        { date: '2024-12-30', expenseNormalAmount: 100 },
        { date: '2025-01-01', expenseNormalAmount: 50 },
      ],
      { start: new Date(2024, 11, 30), end: new Date(2025, 0, 6) },
      new Date(2025, 0, 1),
    );
    expect(stats.days).toHaveLength(7);
    expect(stats.recordedDays).toBe(2);
    expect(stats.recordedDayAverage).toBe(75);
    expect(stats.workday).toEqual({ days: 3, average: 50 });
    expect(stats.weekend).toEqual({ days: 0, average: null });
    expect(stats.months).toEqual([
      { month: '2024-12', amount: 100 },
      { month: '2025-01', amount: 50 },
    ]);
  });

  it('includes leap day and represents empty periods without a fabricated average', () => {
    const stats = buildExpensePeriodStats(
      [],
      { start: new Date(2024, 1, 1), end: new Date(2024, 2, 1) },
      new Date(2024, 2, 1),
    );
    expect(stats.days).toHaveLength(29);
    expect(stats.days.at(-1)?.date).toBe('2024-02-29');
    expect(stats.recordedDayAverage).toBeNull();
    expect(stats.workday.average).toBe(0);
  });

  it('limits an ongoing 30-day month to elapsed dates even when future rows exist', () => {
    const stats = buildExpensePeriodStats(
      [
        { date: '2026-04-01', expenseNormalAmount: 900 },
        { date: '2026-04-15', expenseNormalAmount: 500 },
        { date: '2026-03-31', expenseNormalAmount: 700 },
      ],
      { start: new Date(2026, 3, 1), end: new Date(2026, 4, 1) },
      new Date(2026, 3, 1),
    );
    expect(stats.days).toHaveLength(30);
    expect(stats.recordedDays).toBe(1);
    expect(stats.recordedDayAverage).toBe(900);
    expect(stats.days[14]).toMatchObject({ future: true, amount: 0 });
    expect(stats.workday).toEqual({ days: 1, average: 900 });
  });
});
