import { equalPeriodIncomeExpenseSeries, incomeExpenseSeries } from './report';

function expectEqual(actual: unknown, expected: unknown, msg: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg}: expected ${e}, got ${a}`);
  }
}

const iso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

// 月维度：跨年标签 + 收支归期 + 储蓄类计入（对账口径由调用方传全量流水体现）
{
  const s = incomeExpenseSeries('month', new Date(2026, 2, 15), [
    { occurred_at: iso(2025, 10, 5), type: 'income', amount: 100 }, // 首期
    { occurred_at: iso(2025, 9, 30), type: 'income', amount: 999 }, // 窗口前，丢弃
    { occurred_at: iso(2026, 1, 1), type: 'expense', amount: 30 }, // 期首边界
    { occurred_at: iso(2026, 3, 31), type: 'expense', amount: 50 }, // 末期期末
    { occurred_at: iso(2026, 3, 1), type: 'income', amount: 80 },
    { occurred_at: iso(2026, 4, 1), type: 'expense', amount: 999 }, // 窗口后，丢弃
  ]);
  expectEqual(
    s.map((x) => x.label),
    ['10月', '11月', '12月', '1月', '2月', '3月'],
    '月维度近 6 期跨年标签',
  );
  expectEqual(s[0], { label: '10月', income: 100, expense: 0 }, '首期收入归桶');
  expectEqual(s[3], { label: '1月', income: 0, expense: 30 }, '期首边界归当期');
  expectEqual(s[5], { label: '3月', income: 80, expense: 50 }, '末期收支同期归桶');
}

// 月维度：31 号锚点不得因 setMonth 溢出串月
{
  const s = incomeExpenseSeries('month', new Date(2026, 4, 31), []);
  expectEqual(
    s.map((x) => x.label),
    ['12月', '1月', '2月', '3月', '4月', '5月'],
    '5/31 锚点近 6 期',
  );
}

// 周维度：起始日短标签，周一为界
{
  const s = incomeExpenseSeries(
    'week',
    new Date(2026, 6, 9), // 周四，所在周 = 7/6（周一）起
    [
      { occurred_at: iso(2026, 7, 6), type: 'expense', amount: 10 }, // 本周一
      { occurred_at: iso(2026, 7, 5), type: 'expense', amount: 20 }, // 上周日
    ],
    2,
  );
  expectEqual(
    s.map((x) => x.label),
    ['6/29', '7/6'],
    '周维度起始日标签',
  );
  expectEqual(
    s.map((x) => x.expense),
    [20, 10],
    '周一边界归本周',
  );
}

// 年维度
{
  const s = incomeExpenseSeries(
    'year',
    new Date(2026, 0, 1),
    [{ occurred_at: iso(2024, 6, 1), type: 'income', amount: 7 }],
    3,
  );
  expectEqual(
    s.map((x) => x.label),
    ['2024', '2025', '2026'],
    '年维度标签',
  );
  expectEqual(s[0].income, 7, '年维度归桶');
}

// 自定义维度：按用户选择区间长度生成上一等长周期
{
  const s = equalPeriodIncomeExpenseSeries(
    { start: new Date(2026, 6, 11), end: new Date(2026, 6, 16) }, // 7/11–7/15，5 天
    [
      { occurred_at: iso(2026, 7, 6), type: 'expense', amount: 10 }, // 前一等长周期
      { occurred_at: iso(2026, 7, 11), type: 'income', amount: 20 }, // 当前自定义周期
      { occurred_at: iso(2026, 7, 16), type: 'income', amount: 999 }, // 期末边界，丢弃
    ],
    2,
  );
  expectEqual(
    s.map((x) => x.label),
    ['7/6', '7/11'],
    '自定义维度按等长周期生成标签',
  );
  expectEqual(
    s.map((x) => ({ income: x.income, expense: x.expense })),
    [
      { income: 0, expense: 10 },
      { income: 20, expense: 0 },
    ],
    '自定义维度按等长周期归桶',
  );
}
