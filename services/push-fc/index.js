/**
 * 家账 HomeBook · 系统推送投递（阿里云函数计算 FC 3.0 · 事件函数 · 定时器触发）
 *
 * 它是「层级二 · 远程推送」的服务端投递实现（PRD §18.3.3 / 流程 13 §15）。与 sms/email hook 同属
 * services/ 一族、同样零第三方依赖、手写 HTTP。不同点：**不是 GoTrue Hook，而是定时轮询**。
 *
 * 为什么轮询而不是 DB 触发：自建 Supabase 出网受限（SMTP 被墙、未启用 pg_net），DB 侧没有可靠的
 * 外发 HTTP 通道；而 FC 到公网（Supabase REST + Expo）可达。故由本函数（FC 定时器每 ~1min）
 * 以 service_role 主动拉取待推通知，绕开「DB 能否出网」的不确定性。
 *
 * 一个轮询周期（runPollCycle）：
 *   1) 拉取 channel='in_app' 且 pushed_at is null 的通知（近 PUSH_LOOKBACK_MINUTES 分钟内，防补推过旧）。
 *   2) 逐条：type→分类，查 notification_preferences（无行=默认全开）判断该用户该类要不要推；
 *      要推则查该用户 device_tokens，拼 Expo 消息（标题/正文由 describe 按 type+payload 生成）。
 *   3) 批量发 Expo Push API（每 100 条一批，best-effort：单批失败仅记录、不阻断，不重发以免刷屏）。
 *   4) 回执里 DeviceNotRegistered 的令牌 → 从 device_tokens 删除。
 *   5) 把本轮处理过的通知（含被偏好跳过 / 无令牌的）统一标记 pushed_at，避免反复处理。
 *
 * 语义：App 内通知中心（流程 13）始终可见，push 只是唤回副本；漏推一条（如轮询期外发失败）不影响
 * 用户在 App 内看到该通知。故整体取「至多一次、尽力而为」，优先不重复刷屏而非绝对不丢。
 *
 * 形态＝FC 3.0 **事件函数**（handler=index.handler，Node.js 运行时）：由**定时触发器**周期调用，
 * 无公网 HTTP 入口、无需鉴权（平台内部调用）。本函数零第三方依赖，部署包极小。
 */
'use strict';

const http = require('http');
const https = require('https');

// ── 通知类型 → 偏好分类（notification_preferences 的列名）────────────────────────
// 六类分类见 PRD §18.3.3；未列出的 type 不推（仅标记已处理）。
const TYPE_CATEGORY = {
  removed: 'member_change', // 被移出家庭
  transfer: 'family_activity', // 户主变更
  succession: 'family_activity', // 户主继任
  goal_achieved: 'savings_progress', // 储蓄目标达成
  budget_alert: 'budget_alert', // 预算预警
  monthly_summary: 'monthly_summary', // 月度总结
};

// ── 通知 → 推送标题/正文（与 App 内 center-sheet.tsx 的 describe 保持一致口径）──────────
function famName(p) {
  return p && p.family_name ? `「${p.family_name}」` : '家庭';
}

function describe(type, payload) {
  const p = payload || {};
  switch (type) {
    case 'removed':
      return p.reason === 'dissolved'
        ? { title: '家庭已解散', body: `${famName(p)}已被户主解散` }
        : { title: '你已被移出家庭', body: `你已被移出${famName(p)}` };
    case 'transfer':
      return { title: '户主变更', body: `你已成为${famName(p)}的户主` };
    case 'succession':
      return { title: '户主继任', body: '有成员发起了户主继任申请' };
    case 'goal_achieved':
      return { title: '储蓄目标达成', body: `${p.goal_name ? `「${p.goal_name}」` : '一个储蓄目标'}已达成 🎉` };
    case 'budget_alert':
      return { title: '预算预警', body: p.text || '本月预算需要关注' };
    case 'monthly_summary':
      return { title: '月度总结', body: `${p.period || '上月'}的家庭总结已生成` };
    default:
      return { title: '家账', body: '你有一条新通知' };
  }
}

// ── 一个轮询周期 ────────────────────────────────────────────────────────────────
async function runPollCycle() {
  const lookbackMin = Number(process.env.PUSH_LOOKBACK_MINUTES) || 360;
  const limit = Number(process.env.PUSH_BATCH_LIMIT) || 200;
  const sinceIso = new Date(Date.now() - lookbackMin * 60000).toISOString();

  const notifs = await sbFetch(
    'GET',
    'notifications?select=id,user_id,type,payload,created_at' +
      '&channel=eq.in_app&pushed_at=is.null' +
      `&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.asc&limit=${limit}`,
  );
  if (!notifs || !notifs.length) return { processed: 0, sent: 0, invalid: 0 };

  const prefCache = new Map(); // user_id → 偏好行（或 null=无行）
  const tokenCache = new Map(); // user_id → [token...]
  const messages = []; // Expo 消息
  const msgTokens = []; // 与 messages 平行：每条消息对应的 token（供失效清理）
  const processedIds = [];

  for (const n of notifs) {
    processedIds.push(n.id);
    const category = TYPE_CATEGORY[n.type];
    if (!category) continue; // 未知类型：仅标记已处理，不推
    if (!(await isEnabled(n.user_id, category, prefCache))) continue; // 该类被用户关掉
    const tokens = await tokensFor(n.user_id, tokenCache);
    if (!tokens.length) continue; // 无设备令牌（未授权/未登录设备）
    const { title, body } = describe(n.type, n.payload);
    for (const token of tokens) {
      messages.push({ to: token, title, body, sound: 'default', data: { type: n.type, id: n.id } });
      msgTokens.push(token);
    }
  }

  // 批量发 Expo（每 100 条一批）。single 批失败仅记录、不阻断（best-effort，不重发以免刷屏）。
  let sent = 0;
  const invalidTokens = new Set();
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const tickets = await expoPush(chunk);
      tickets.forEach((t, j) => {
        if (t && t.status === 'ok') sent += 1;
        else if (t && t.details && t.details.error === 'DeviceNotRegistered') invalidTokens.add(msgTokens[i + j]);
      });
    } catch (e) {
      console.error('[push-fc] expo chunk failed:', (e && e.message) || e);
    }
  }

  // 清理失效令牌（DeviceNotRegistered：用户卸载/关推送/令牌轮换）。
  for (const token of invalidTokens) {
    await sbFetch('DELETE', `device_tokens?token=eq.${encodeURIComponent(token)}`).catch(() => {});
  }

  // 标记本轮处理过的通知（含被偏好跳过/无令牌的），避免下轮重复处理。
  if (processedIds.length) {
    const idList = processedIds.map((id) => `"${id}"`).join(',');
    await sbFetch('PATCH', `notifications?id=in.(${idList})`, { pushed_at: new Date().toISOString() });
  }

  return { processed: processedIds.length, sent, invalid: invalidTokens.size };
}

/** 该用户该分类是否允许推送（无偏好行=默认全开；列值仅 false 才算关）。 */
async function isEnabled(userId, category, prefCache) {
  if (!prefCache.has(userId)) {
    const rows = await sbFetch('GET', `notification_preferences?select=*&user_id=eq.${userId}&limit=1`);
    prefCache.set(userId, (rows && rows[0]) || null);
  }
  const pref = prefCache.get(userId);
  if (!pref) return true;
  return pref[category] !== false;
}

/** 该用户的全部设备令牌。 */
async function tokensFor(userId, tokenCache) {
  if (!tokenCache.has(userId)) {
    const rows = await sbFetch('GET', `device_tokens?select=token&user_id=eq.${userId}`);
    tokenCache.set(userId, (rows || []).map((r) => r.token).filter(Boolean));
  }
  return tokenCache.get(userId);
}

// ── Supabase REST（service_role，绕 RLS）───────────────────────────────────────────
function sbBase() {
  return env('SUPABASE_URL').replace(/\/+$/, '');
}

async function sbFetch(method, path, bodyObj) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const headers = { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers.prefer = 'return=minimal'; // 写操作不回读，省流量
  }
  const { status, text } = await httpJson(method, `${sbBase()}/rest/v1/${path}`, headers, bodyObj);
  if (status < 200 || status >= 300) {
    throw new Error(`supabase ${method} ${path} → HTTP ${status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// ── Expo Push API ────────────────────────────────────────────────────────────────
/** 发一批（≤100）Expo 消息，返回 tickets 数组（与入参同序）。 */
async function expoPush(messages) {
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  // 若在 Expo 后台开启了「Enhanced Security for Push」，需带访问令牌。
  if (process.env.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const { status, text } = await httpJson('POST', 'https://exp.host/--/api/v2/push/send', headers, messages);
  if (status < 200 || status >= 300) throw new Error(`expo push → HTTP ${status} ${text}`);
  const json = JSON.parse(text || '{}');
  return json.data || [];
}

// ── 通用 JSON HTTP ────────────────────────────────────────────────────────────────
function httpJson(method, urlString, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const mod = u.protocol === 'http:' ? http : https;
    const body = bodyObj != null ? JSON.stringify(bodyObj) : null;
    const h = Object.assign({}, headers);
    if (body) h['content-length'] = Buffer.byteLength(body);
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method,
        headers: h,
        timeout: 15000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    if (body) req.write(body);
    req.end();
  });
}

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env: ${name}`);
  return v;
}

// ── FC 事件函数入口（定时触发器周期调用）──────────────────────────────────────────
async function handler(event, context) {
  try {
    const result = await runPollCycle();
    console.log('[push-fc] cycle', JSON.stringify(result));
    return result;
  } catch (e) {
    console.error('[push-fc] cycle failed:', (e && (e.stack || e.message)) || e);
    throw e; // 抛出让平台记失败，按触发器重试策略处理
  }
}

module.exports = { handler, runPollCycle, describe, TYPE_CATEGORY };
