/** Daily amounts use the family's calendar dates, not device time-zone instants. */
export type ExpenseDay = { date: string; expenseNormalAmount: number };

export type ExpensePeriodStats = {
  days: { date: string; amount: number; future: boolean }[];
  recordedDays: number;
  recordedDayAverage: number | null;
  workday: { days: number; average: number | null };
  weekend: { days: number; average: number | null };
  months: { month: string; amount: number }[];
};

function key(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** range.end is exclusive; today is the current date in the family's time zone. */
export function buildExpensePeriodStats(
  rows: ExpenseDay[],
  range: { start: Date; end: Date },
  today: Date,
): ExpensePeriodStats {
  const values = new Map(rows.map((row) => [row.date, row.expenseNormalAmount]));
  const todayKey = key(today);
  const days: ExpensePeriodStats['days'] = [];
  const months = new Map<string, number>();
  let recordedDays = 0;
  let total = 0;
  let workdayDays = 0;
  let workdayTotal = 0;
  let weekendDays = 0;
  let weekendTotal = 0;
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate());
  while (cursor < range.end) {
    const date = key(cursor);
    const future = date > todayKey;
    const amount = future ? 0 : (values.get(date) ?? 0);
    days.push({ date, amount, future });
    if (!future) {
      const month = date.slice(0, 7);
      months.set(month, (months.get(month) ?? 0) + amount);
      if (amount > 0) recordedDays += 1;
      total += amount;
      if (cursor.getDay() === 0 || cursor.getDay() === 6) {
        weekendDays += 1;
        weekendTotal += amount;
      } else {
        workdayDays += 1;
        workdayTotal += amount;
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return {
    days,
    recordedDays,
    recordedDayAverage: recordedDays ? total / recordedDays : null,
    workday: { days: workdayDays, average: workdayDays ? workdayTotal / workdayDays : null },
    weekend: { days: weekendDays, average: weekendDays ? weekendTotal / weekendDays : null },
    months: Array.from(months, ([month, amount]) => ({ month, amount })),
  };
}
