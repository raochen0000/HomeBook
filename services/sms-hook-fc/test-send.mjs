#!/usr/bin/env node
/**
 * 本地联调脚本：像 GoTrue 一样对 payload 做 Standard Webhooks 签名，POST 到已部署的 FC，
 * 触发一条**真实短信**，用来在接 GoTrue 之前单独验证「FC + 阿里云短信认证」这半边。
 *
 * 用法（会消耗 1 条短信额度）：
 *   HOOK_SECRET='v1,whsec_...' \
 *   FC_URL='https://homebooksms-xxxx.cn-hangzhou.fcapp.run' \
 *   node test-send.mjs 13800138000
 */
import crypto from 'node:crypto';

const secretRaw = process.env.HOOK_SECRET;
const url = process.env.FC_URL;
const phoneArg = process.argv[2];
if (!secretRaw || !url || !phoneArg) {
  console.error("用法: HOOK_SECRET='v1,whsec_...' FC_URL='https://xxx.fcapp.run' node test-send.mjs <手机号>");
  process.exit(1);
}

// 规整成 GoTrue 存储形态：无「+」、带 86 前缀（与线上 hook 收到的一致）
let phone = phoneArg.replace(/\D/g, '');
if (!phone.startsWith('86')) phone = '86' + phone.replace(/^0+/, '');

const otp = String(Math.floor(100000 + Math.random() * 900000)); // 6 位
const body = JSON.stringify({ user: { phone }, sms: { otp } });

// Standard Webhooks 签名（与 index.js 的 verifyWebhook 完全对应）
const id = 'test_' + Date.now();
const ts = String(Math.floor(Date.now() / 1000));
const b64 = secretRaw.replace(/^v1,/, '').replace(/^whsec_/, '');
const key = Buffer.from(b64, 'base64');
const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');

console.log(`→ POST ${url}\n  phone=${phone}  otp=${otp}`);
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
  console.log(`✅ FC 已请求阿里云下发。请查收手机 ${phone} 的短信，验证码应为：${otp}`);
} else if (res.status === 401) {
  console.log('❌ 验签失败：HOOK_SECRET 与 FC 上配的不一致，或本机时钟与 FC 偏差 > 5 分钟。');
} else {
  console.log('❌ 下发未成功。去 FC 控制台「实时日志」看 `[send-sms hook] failed:` 后的阿里云具体报错');
  console.log('   （常见：签名名 SMS_SIGN_NAME 不对、模板 CODE 不对、AccessKey 无短信权限、套餐欠费）。');
}
