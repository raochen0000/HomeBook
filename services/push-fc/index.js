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
 *   1) 先生成到期的月度总结通知，再拉取 channel='in_app'、pushed_at is null 且已到重试时间的通知。
 *   2) 逐条：type→分类，查 notification_preferences（无行=默认全开）判断该用户该类要不要推；
 *      要推则查该用户 device_tokens，拼 Expo 消息（标题/正文由 describe 按 type+payload 生成）。
 *   3) 批量发 Expo Push API（每 100 条一批）；Expo/API 临时失败不标记 pushed_at，按指数退避重试。
 *   4) 回执里 DeviceNotRegistered 的令牌 → 从 device_tokens 删除。
 *   5) 仅把已被 Expo 接受、或被用户偏好/无令牌明确跳过的通知标记 pushed_at。
 *
 * 语义：App 内通知中心（流程 13）始终可见，push 只是唤回副本；漏推一条（如轮询期外发失败）不影响
 * 用户在 App 内看到该通知。Expo 的 ticket 成功不等同于手机已展示；本实现保证临时投递失败可重试，
 * 并保留 App 内消息作为可靠兜底。
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
function famName(p, locale) {
  const fallback = locale === 'en' ? 'the family' : '家庭';
  return p && p.family_name ? `「${p.family_name}」` : fallback;
}

function describe(type, payload, userId, locale) {
  const p = payload || {};
  const en = locale === 'en';
  switch (type) {
    case 'removed':
      if (p.reason === 'dissolved') {
        return en
          ? { title: 'Family dissolved', body: `${famName(p, locale)} was dissolved by the owner` }
          : { title: '家庭已解散', body: `${famName(p, locale)}已被户主解散` };
      }
      return en
        ? { title: 'You were removed', body: `You were removed from ${famName(p, locale)}` }
        : { title: '你已被移出家庭', body: `你已被移出${famName(p, locale)}` };
    case 'transfer':
      if (p.new_owner_user_id === userId) {
        return en
          ? { title: 'Owner changed', body: `You are now the owner of ${famName(p, locale)}` }
          : { title: '户主变更', body: `你已成为${famName(p, locale)}的户主` };
      }
      {
        const who = p.new_owner_name || (en ? 'A family member' : '一位家庭成员');
        return en
          ? { title: 'Owner changed', body: `${who} is now the owner of ${famName(p, locale)}` }
          : { title: '户主变更', body: `${who}已成为${famName(p, locale)}的户主` };
      }
    case 'succession':
      return en
        ? { title: 'Owner succession', body: 'Someone requested to become the owner' }
        : { title: '户主继任', body: '有成员发起了户主继任申请' };
    case 'goal_achieved': {
      const goal = p.goal_name ? `「${p.goal_name}」` : en ? 'A savings goal' : '一个储蓄目标';
      return en
        ? { title: 'Savings goal reached', body: `${goal} is complete 🎉` }
        : { title: '储蓄目标达成', body: `${goal}已达成 🎉` };
    }
    case 'budget_alert':
      if (en) {
        return { title: 'Budget alert', body: 'This month’s budget needs attention' };
      }
      return { title: '预算预警', body: p.text || '本月预算需要关注' };
    case 'monthly_summary': {
      const period = p.period || (en ? 'last month' : '上月');
      return en
        ? { title: 'Monthly recap', body: `The ${period} household recap is ready` }
        : { title: '月度总结', body: `${period}的家庭总结已生成` };
    }
    default:
      return en
        ? { title: 'HomeBook', body: 'You have a new notification' }
        : { title: '家账', body: '你有一条新通知' };
  }
}

// ── 一个轮询周期 ────────────────────────────────────────────────────────────────
async function runPollCycle() {
  const limit = Number(process.env.PUSH_BATCH_LIMIT) || 200;
  const now = new Date().toISOString();

  // 月度总结事件由 DB 按每个家庭时区、每月前 7 天且 08:00 后幂等生成；生成失败不阻断既有通知投递。
  let producedMonthly = 0;
  try {
    const result = await sbFetch('POST', 'rpc/emit_monthly_summary_notifications', {}, true);
    producedMonthly = typeof result === 'number' ? result : 0;
  } catch (e) {
    console.error('[push-fc] monthly summary producer failed:', (e && e.message) || e);
  }

  const notifs = await sbFetch(
    'GET',
    'notifications?select=id,user_id,type,payload,push_attempts' +
      '&channel=eq.in_app&pushed_at=is.null' +
      `&or=${encodeURIComponent(`(push_next_attempt_at.is.null,push_next_attempt_at.lte.${now})`)}` +
      `&order=created_at.asc&limit=${limit}`,
  );
  if (!notifs || !notifs.length) return { producedMonthly, processed: 0, retried: 0, sent: 0, invalid: 0 };

  const prefCache = new Map(); // user_id → 偏好行（或 null=无行）
  const tokenCache = new Map(); // user_id → [token...]
  const messages = []; // { message, notification, token }，与 Expo ticket 同序
  const terminalIds = []; // 不需要再尝试的通知（成功、偏好关闭或无有效设备）
  const delivery = new Map(); // notification id → { notification, failed }

  for (const n of notifs) {
    const category = TYPE_CATEGORY[n.type];
    if (!category) {
      terminalIds.push(n.id); // 未知类型：没有对应推送规则，保留 App 内消息即可
      continue;
    }
    if (!(await isEnabled(n.user_id, category, prefCache))) {
      terminalIds.push(n.id); // 用户明确关闭该分类
      continue;
    }
    const tokens = await tokensFor(n.user_id, tokenCache);
    if (!tokens.length) {
      terminalIds.push(n.id); // 无设备令牌：等待下次新通知，而不让旧消息无限轮询
      continue;
    }
    delivery.set(n.id, { notification: n, failed: false });
    const url = notificationUrl(n.type, n.payload);
    for (const device of tokens) {
      const { title, body } = describe(n.type, n.payload, n.user_id, device.locale);
      messages.push({
        notification: n,
        token: device.token,
        message: { to: device.token, title, body, sound: 'default', data: { type: n.type, id: n.id, url } },
      });
    }
  }

  // 批量发 Expo（每 100 条一批）。任一临时失败均保留该通知，并在后续轮询重试。
  let sent = 0;
  const invalidTokens = new Set();
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const tickets = await expoPush(chunk.map((entry) => entry.message));
      chunk.forEach((entry, j) => {
        const ticket = tickets[j];
        const state = delivery.get(entry.notification.id);
        if (ticket && ticket.status === 'ok') {
          sent += 1;
        } else if (ticket && ticket.details && ticket.details.error === 'DeviceNotRegistered') {
          invalidTokens.add(entry.token);
        } else if (state) {
          state.failed = true;
        }
      });
    } catch (e) {
      console.error('[push-fc] expo chunk failed:', (e && e.message) || e);
      chunk.forEach((entry) => {
        const state = delivery.get(entry.notification.id);
        if (state) state.failed = true;
      });
    }
  }

  // 清理失效令牌（DeviceNotRegistered：用户卸载/关推送/令牌轮换）。
  for (const token of invalidTokens) {
    await sbFetch('DELETE', `device_tokens?token=eq.${encodeURIComponent(token)}`).catch(() => {});
  }

  let retried = 0;
  for (const state of delivery.values()) {
    if (state.failed) {
      await deferPush(state.notification);
      retried += 1;
    } else {
      terminalIds.push(state.notification.id);
    }
  }
  await markPushed(terminalIds);

  return { producedMonthly, processed: terminalIds.length, retried, sent, invalid: invalidTokens.size };
}

/** App 内/系统推送共用的白名单深链；客户端还会再次校验。 */
function notificationUrl(type, payload) {
  const p = payload || {};
  if (type === 'monthly_summary') return /^\d{4}-(0[1-9]|1[0-2])$/.test(p.period || '') ? `/summary?period=${p.period}` : '/summary';
  if (type === 'goal_achieved' || type === 'transfer' || type === 'succession' || type === 'removed') return '/family';
  return '/';
}

/** Expo 未接收时按 1m、2m、4m…退避，最长 1h；不会错误写入 pushed_at。 */
async function deferPush(notification) {
  const attempts = (Number(notification.push_attempts) || 0) + 1;
  const delaySeconds = Math.min(60 * 2 ** Math.min(attempts - 1, 6), 3600);
  const nextAttempt = new Date(Date.now() + delaySeconds * 1000).toISOString();
  await sbFetch('PATCH', `notifications?id=eq.${encodeURIComponent(notification.id)}`, {
    push_attempts: attempts,
    push_next_attempt_at: nextAttempt,
  });
}

async function markPushed(ids) {
  if (!ids.length) return;
  const idList = ids.map((id) => `"${id}"`).join(',');
  await sbFetch('PATCH', `notifications?id=in.(${idList})`, {
    pushed_at: new Date().toISOString(),
    push_next_attempt_at: null,
  });
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
    const rows = await sbFetch('GET', `device_tokens?select=token,locale&user_id=eq.${userId}`);
    tokenCache.set(
      userId,
      (rows || [])
        .filter((r) => r && r.token)
        .map((r) => ({ token: r.token, locale: r.locale === 'en' ? 'en' : 'zh' })),
    );
  }
  return tokenCache.get(userId);
}

// ── Supabase REST（service_role，绕 RLS）───────────────────────────────────────────
function sbBase() {
  return env('SUPABASE_URL').replace(/\/+$/, '');
}

async function sbFetch(method, path, bodyObj, returnRepresentation = false) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const headers = { apikey: key, authorization: `Bearer ${key}`, accept: 'application/json' };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers.prefer = returnRepresentation ? 'return=representation' : 'return=minimal'; // 写操作默认不回读，省流量
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

module.exports = { handler, runPollCycle, describe, notificationUrl, TYPE_CATEGORY };
