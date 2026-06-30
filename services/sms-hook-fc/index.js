/**
 * 家账 HomeBook · 手机号 OTP 短信下发（阿里云函数计算 FC 3.0 · Web 函数）
 *
 * 它是 Supabase Auth(GoTrue)的 **Send SMS Hook** 的落地实现。整条链路：
 *   客户端 signInWithOtp({ phone })
 *     → GoTrue **自己生成 OTP**、自己存储、稍后自己校验、自己签发 session
 *     → GoTrue 以 Standard Webhooks 签名回调本服务（把 phone + otp 交给我们去发）
 *     → 本服务调阿里云「短信认证服务」dypnsapi.SendSmsVerifyCode，把 GoTrue 那串 otp
 *       塞进系统赠送模板发出去（阿里云此处只当“发送管道”，验证码内容由我们指定）
 *     → 用户回填 → GoTrue verifyOtp 校验通过 → 原生签发 session。
 *
 * 关键取舍：**不**用 dypnsapi 的 CheckSmsVerifyCode、**不**自行签发 session。
 * 生成/校验/会话全部留在 GoTrue 原生流程里，所以登录/注册/注销/绑号/删号都是原生行为。
 * 个人开发者用「短信认证服务(PNVS)」无需企业资质（仅个人实名 + 系统赠送签名/模板）。
 *
 * 形态＝FC 3.0 **Web 函数**：自起 HTTP 服务监听端口（FC 默认 9000，可用 FC_SERVER_PORT），
 * 启动命令 `node index.js`。Web 函数原样透传请求体，验签拿得到原始 body（事件函数会预解析、签名对不上）。
 */
'use strict';

const http = require('http');
const crypto = require('crypto');
const Dypnsapi = require('@alicloud/dypnsapi20170525');
const OpenApi = require('@alicloud/openapi-client');
const Util = require('@alicloud/tea-util');

// ── HTTP 服务（FC Web 函数入口）────────────────────────────────────────────────
function startServer() {
  const port = Number(process.env.FC_SERVER_PORT) || 9000;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf8'); // 原始字节，验签必需
        const result = await processHook(req.method, lowerKeys(req.headers || {}), rawBody);
        res.writeHead(result.status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result.body));
      } catch (e) {
        console.error('[send-sms hook] request error:', (e && (e.stack || e.message)) || e);
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(hookError(500, 'internal error')));
      }
    });
    req.on('error', () => res.writeHead(400).end());
  });
  // FC 自定义运行时要求监听 0.0.0.0:<port>；监听失败要显式退出报错，别静默退出（否则平台只报 CAExited）。
  server.on('error', (e) => {
    console.error('[send-sms hook] server error:', e);
    process.exit(1);
  });
  server.listen(port, '0.0.0.0', () => console.log(`[send-sms hook] listening on 0.0.0.0:${port}`));
}

/**
 * 处理一次 Hook 请求，返回 { status, body }。抽出来便于本地单测（不起真服务）。
 */
async function processHook(method, headers, rawBody) {
  // 健康检查：FC 平台探活 / 浏览器直接 GET 时返回 ok。
  if (String(method || 'POST').toUpperCase() === 'GET') return { status: 200, body: { ok: true } };

  try {
    // 1) 验签：确认请求确实来自我们的 GoTrue（Standard Webhooks / HMAC-SHA256）。
    if (!verifyWebhook(env('HOOK_SECRET'), headers, rawBody)) {
      return { status: 401, body: hookError(401, 'invalid webhook signature') };
    }

    // 2) 取出手机号与 GoTrue 生成的验证码。
    const payload = JSON.parse(rawBody || '{}');
    const phone = payload && payload.user && payload.user.phone;
    const otp = payload && payload.sms && payload.sms.otp;
    if (!phone || !otp) return { status: 200, body: hookError(400, 'missing user.phone or sms.otp') };

    // 3) 经阿里云短信认证服务把这串验证码发出去。
    await sendAliyunCode(phone, otp);

    // 成功：200 + 空对象，GoTrue 据此判定下发成功。
    return { status: 200, body: {} };
  } catch (e) {
    console.error('[send-sms hook] failed:', (e && (e.stack || e.message)) || e);
    // 失败：200 + error 对象，GoTrue 会把它当作短信下发失败上报给客户端。
    return { status: 200, body: hookError(500, 'SMS delivery failed') };
  }
}

// ── 阿里云短信认证（dypnsapi.SendSmsVerifyCode）─────────────────────────────────
let _client = null;
function aliyunClient() {
  if (_client) return _client;
  const config = new OpenApi.Config({
    accessKeyId: env('ALIBABA_CLOUD_ACCESS_KEY_ID'),
    accessKeySecret: env('ALIBABA_CLOUD_ACCESS_KEY_SECRET'),
  });
  config.endpoint = process.env.ALIYUN_SMS_ENDPOINT || 'dypnsapi.aliyuncs.com';
  _client = new Dypnsapi.default(config);
  return _client;
}

async function sendAliyunCode(rawPhone, otp) {
  const request = new Dypnsapi.SendSmsVerifyCodeRequest({
    phoneNumber: toAliyunPhone(rawPhone),
    countryCode: '86',
    signName: env('SMS_SIGN_NAME'),
    templateCode: env('SMS_TEMPLATE_CODE'),
    templateParam: buildTemplateParam(otp),
    // 与 GoTrue 的 OTP 长度/有效期保持一致（GOTRUE_SMS_OTP_LENGTH / _EXP）。
    codeLength: String(otp).length,
    validTime: Number(process.env.SMS_OTP_EXP || 300),
  });
  const res = await aliyunClient().sendSmsVerifyCodeWithOptions(request, new Util.RuntimeOptions({}));
  const code = res && res.body && res.body.code;
  if (code !== 'OK') {
    const msg = (res && res.body && res.body.message) || '';
    throw new Error(`Aliyun SendSmsVerifyCode not OK: ${code} ${msg}`);
  }
}

/**
 * 把验证码塞进模板参数。系统赠送模板（100001 登录/注册 等）都含 `${code}` 与 `${min}`
 * 两个变量，故默认填 `{"code":"<otp>","min":"<有效分钟>"}`（min = SMS_OTP_EXP/60，默认 5）。
 * 若你的模板变量不同，用环境变量 SMS_TEMPLATE_PARAM 给出带 `{code}` 占位符的 JSON 串覆盖，
 * 例如 `{"code":"{code}"}`（只含 code）或 `{"code":"{code}","min":"3"}`。
 */
function buildTemplateParam(otp) {
  const tpl = process.env.SMS_TEMPLATE_PARAM;
  if (tpl && tpl.includes('{code}')) return tpl.replace(/\{code\}/g, String(otp));
  const min = String(Math.max(1, Math.round((Number(process.env.SMS_OTP_EXP) || 300) / 60)));
  return JSON.stringify({ code: String(otp), min });
}

/** GoTrue 存的是无「+」的 E.164（如 8613800138000）；阿里云要 11 位本地号 + countryCode=86。 */
function toAliyunPhone(raw) {
  let p = String(raw).replace(/\D/g, '');
  if (p.startsWith('86') && p.length === 13) p = p.slice(2);
  return p;
}

// ── Standard Webhooks 验签 ──────────────────────────────────────────────────────
/**
 * 校验 GoTrue 的 Webhook 签名。头：webhook-id / webhook-timestamp / webhook-signature。
 * 签名 = base64( HMAC_SHA256(key, `${id}.${ts}.${body}`) )，key = 密钥 whsec_ 之后的 base64 解码。
 * 密钥形如 `v1,whsec_<base64>`，可空格分隔多个（轮换期）。
 */
function verifyWebhook(secretRaw, headers, rawBody) {
  const id = headers['webhook-id'];
  const ts = headers['webhook-timestamp'];
  const sigHeader = headers['webhook-signature'];
  if (!id || !ts || !sigHeader) return false;

  // 时间戳容差 ±5 分钟，挡重放（自托管注意 FC 与实例时钟同步）。
  const skew = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(skew) || skew > 300) return false;

  const signedContent = `${id}.${ts}.${rawBody}`;
  const provided = String(sigHeader)
    .split(' ')
    .map((part) => (part.includes(',') ? part.split(',')[1] : part))
    .filter(Boolean);

  for (const secret of String(secretRaw).split(' ').map((s) => s.trim()).filter(Boolean)) {
    const b64 = secret.replace(/^v1,/, '').replace(/^whsec_/, '');
    const key = Buffer.from(b64, 'base64');
    const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64');
    for (const sig of provided) {
      if (timingSafeEqual(sig, expected)) return true;
    }
  }
  return false;
}

function timingSafeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ── 工具 ────────────────────────────────────────────────────────────────────────
/** GoTrue Send SMS Hook 约定的失败返回体。 */
function hookError(httpCode, message) {
  return { error: { http_code: httpCode, message } };
}

function lowerKeys(obj) {
  const out = {};
  for (const k of Object.keys(obj)) out[k.toLowerCase()] = obj[k];
  return out;
}

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env: ${name}`);
  return v;
}

// FC 以 `node index.js` 启动时起服务；被 require（单测）时只导出，不监听。
if (require.main === module) startServer();
module.exports = { processHook, verifyWebhook, toAliyunPhone, buildTemplateParam };
