#!/usr/bin/env node
/**
 * 本地联调脚本：像 GoTrue 一样对 payload 做 Standard Webhooks 签名，POST 到已部署的 FC，
 * 触发一封**真实邮件**，用来在接 GoTrue 之前单独验证「FC + 阿里云邮件推送」这半边。
 *
 * 用法（会真的发一封信，走邮件推送额度）：
 *   HOOK_SECRET='v1,whsec_...' \
 *   FC_URL='https://homebookemail-xxxx.cn-hangzhou.fcapp.run' \
 *   node test-send.mjs you@example.com [recovery|magiclink|email_change]
 */
import crypto from 'node:crypto';

const secretRaw = process.env.HOOK_SECRET;
const url = process.env.FC_URL;
const email = process.argv[2];
const action = process.argv[3] || 'recovery';
if (!secretRaw || !url || !email) {
  console.error("用法: HOOK_SECRET='v1,whsec_...' FC_URL='https://xxx.fcapp.run' node test-send.mjs <邮箱> [动作]");
  process.exit(1);
}

const token = String(Math.floor(100000 + Math.random() * 900000)); // 6 位
// 复刻 GoTrue Send Email Hook 的 payload 形态
const body = JSON.stringify({
  user: { email, new_email: action.startsWith('email_change') ? email : '' },
  email_data: { token, token_new: token, email_action_type: action, redirect_to: '', site_url: '' },
});

// Standard Webhooks 签名（与 index.js 的 verifyWebhook 完全对应）
const id = 'test_' + Date.now();
const ts = String(Math.floor(Date.now() / 1000));
const b64 = secretRaw.replace(/^v1,/, '').replace(/^whsec_/, '');
const key = Buffer.from(b64, 'base64');
const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');

console.log(`→ POST ${url}\n  email=${email}  action=${action}  token=${token}`);
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': ts,
    'webhook-signature': `v1,${sig}`,
  },
  body,
});
const text = await res.text();
console.log(`← HTTP ${res.status}  ${text}`);

if (res.status === 200 && text.trim() === '{}') {
  console.log(`✅ FC 已请求邮件推送下发。请查收 ${email}（含垃圾箱），验证码应为：${token}`);
} else if (res.status === 401) {
  console.log('❌ 验签失败：HOOK_SECRET 与 FC 上配的不一致，或本机时钟与 FC 偏差 > 5 分钟。');
} else {
  console.log('❌ 下发未成功。去 FC 控制台「实时日志」看 `[send-email hook] failed:` 后的阿里云具体报错');
  console.log('   （常见：发信地址 DM_ACCOUNT_NAME 未验证/写错、AccessKey 无邮件推送权限、域名未验证、欠费）。');
}
