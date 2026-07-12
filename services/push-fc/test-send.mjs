/**
 * 本地手动测试：跑一次轮询周期，打印结果。
 *   1) cp .env.example .env 并填 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   2) node test-send.mjs
 * 会真实读你的实例并给「待推的 in_app 通知」发 Expo 推送——请在真机已登录、已授权、
 * device_tokens 有令牌的前提下，插一条测试通知再跑（见 README「本地/线上验证」）。
 * 顺带对 describe() 的分类/文案做零依赖自检。
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// 极简 .env 加载（零依赖）
try {
  for (const line of readFileSync(new URL('./.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  console.warn('[test] 未找到 .env，仅跑 describe 自检');
}

const { runPollCycle, describe, TYPE_CATEGORY } = require('./index.js');

// describe / 分类映射自检
const cases = ['removed', 'transfer', 'succession', 'goal_achieved', 'budget_alert', 'monthly_summary', 'unknown'];
for (const t of cases) {
  const d = describe(t, { family_name: '调试之家', goal_name: '旅行基金', period: '2026-06', text: '本月已超支' });
  console.log(`  ${t.padEnd(16)} → [${TYPE_CATEGORY[t] || '—'}] ${d.title} · ${d.body}`);
}

if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.log('\n[test] 跑一次轮询…');
  runPollCycle()
    .then((r) => console.log('[test] 结果:', r))
    .catch((e) => {
      console.error('[test] 失败:', e);
      process.exit(1);
    });
} else {
  console.log('\n[test] 无 Supabase 凭证，跳过真实轮询。');
}
