/**
 * 家账 HomeBook · 认证邮件下发（阿里云函数计算 FC 3.0 · Web 函数）
 *
 * 它是 Supabase Auth(GoTrue)的 **Send Email Hook** 的落地实现，与短信 Hook（services/sms-hook-fc）
 * 完全同构。存在的原因：自托管 GoTrue(auth)容器**无公网出口**，直连阿里云邮件推送 SMTP（465/587/80）
 * 全部 `context deadline exceeded` 超时；而它到 FC 的**内网地址**可达、FC 到阿里云公网可达，故绕道 FC 走
 * 邮件推送的 **HTTP API `SingleSendMail`**（443 HTTPS，不受 SMTP 端口封锁影响）。
 *
 * 整条链路（以「找回密码」为例）：
 *   客户端 resetPasswordForEmail({ email })
 *     → GoTrue **自己生成 OTP/token**、自己存储、稍后自己校验、自己签发 session
 *     → GoTrue 以 Standard Webhooks 签名回调本服务（把 user.email + email_data.token 交给我们去发）
 *     → 本服务调阿里云邮件推送 SingleSendMail，把那串 token 拼进中文邮件正文发出去
 *     → 用户回填 → GoTrue verifyOtp(type=recovery) 校验通过 → 原生签发 session → updateUser 改密。
 *
 * 关键取舍：**开启 Send Email Hook 后，Supabase 自带的邮件模板被完全旁路**，邮件正文由本函数拼装
 * （所以之前纠结的「recovery 模板要含 {{ .Token }}」不再需要）。生成/校验/会话仍全在 GoTrue 原生流程里。
 *
 * 形态＝FC 3.0 **Web 函数**：自起 HTTP 服务监听端口（FC 默认 9000，可用 FC_SERVER_PORT），
 * 启动命令 `node index.js`。Web 函数原样透传请求体，验签拿得到原始 body（事件函数会预解析、签名对不上）。
 * 本函数**零第三方依赖**：邮件推送的 RPC 签名用 Node 内置 crypto 手写，部署包极小。
 */
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');

// 部署校验标记：改代码时递增，GET / 会回显，用来确认 FC 跑的是不是最新代码（排"部署没生效"）。
const BUILD = 'sig-fix-2';

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
        console.error('[send-email hook] request error:', (e && (e.stack || e.message)) || e);
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(hookError(500, 'internal error')));
      }
    });
    req.on('error', () => res.writeHead(400).end());
  });
  // FC 自定义运行时要求监听 0.0.0.0:<port>；监听失败要显式退出报错，别静默退出（否则平台只报 CAExited）。
  server.on('error', (e) => {
    console.error('[send-email hook] server error:', e);
    process.exit(1);
  });
  server.listen(port, '0.0.0.0', () => console.log(`[send-email hook] listening on 0.0.0.0:${port}`));
}

/**
 * 处理一次 Hook 请求，返回 { status, body }。抽出来便于本地单测（不起真服务）。
 */
async function processHook(method, headers, rawBody) {
  // 健康检查：FC 平台探活 / 浏览器直接 GET 时返回 ok（带 build 标记，便于确认部署已生效）。
  if (String(method || 'POST').toUpperCase() === 'GET') return { status: 200, body: { ok: true, build: BUILD } };

  try {
    // 1) 验签：确认请求确实来自我们的 GoTrue（Standard Webhooks / HMAC-SHA256）。
    if (!verifyWebhook(env('HOOK_SECRET'), headers, rawBody)) {
      return { status: 401, body: hookError(401, 'invalid webhook signature') };
    }

    // 2) 取出收件邮箱、GoTrue 生成的 token、以及邮件动作类型。
    const payload = JSON.parse(rawBody || '{}');
    const user = (payload && payload.user) || {};
    const data = (payload && payload.email_data) || {};
    const { email, token } = pickRecipient(user, data);
    if (!email || !token) return { status: 200, body: hookError(400, 'missing recipient email or token') };

    // 3) 组邮件（主题/正文按动作类型），经阿里云邮件推送发出去。
    const tpl = EMAIL_TEMPLATES[data.email_action_type] || EMAIL_TEMPLATES._default;
    const minutes = Math.max(1, Math.round((Number(process.env.EMAIL_OTP_EXP) || 3600) / 60));
    await sendDirectMail(email, tpl.subject, buildHtml(tpl.intro, token, minutes));

    // 成功：200 + 空对象，GoTrue 据此判定下发成功。
    return { status: 200, body: {} };
  } catch (e) {
    console.error('[send-email hook] failed:', (e && (e.stack || e.message)) || e);
    // 失败：200 + error 对象，GoTrue 会把它当作邮件下发失败上报给客户端。
    return { status: 200, body: hookError(500, 'email delivery failed') };
  }
}

// ── 邮件动作类型 → 主题/开场白 ───────────────────────────────────────────────────
// GoTrue 的 email_action_type 取值：signup / recovery / invite / magiclink /
// email_change / email_change_current / email_change_new / reauthentication。
const EMAIL_TEMPLATES = {
  recovery: { subject: '【家账】找回密码验证码', intro: '你正在重置家账的登录密码。' },
  magiclink: { subject: '【家账】登录验证码', intro: '你正在登录家账。' },
  signup: { subject: '【家账】注册验证码', intro: '欢迎注册家账，请确认你的邮箱。' },
  invite: { subject: '【家账】邀请验证码', intro: '你受邀加入家账。' },
  reauthentication: { subject: '【家账】安全验证码', intro: '你正在进行安全验证。' },
  email_change: { subject: '【家账】邮箱验证码', intro: '你正在绑定 / 更换家账的登录邮箱。' },
  email_change_current: { subject: '【家账】邮箱验证码', intro: '你正在更换家账的登录邮箱（原邮箱确认）。' },
  email_change_new: { subject: '【家账】邮箱验证码', intro: '你正在绑定 / 更换家账的登录邮箱。' },
  _default: { subject: '【家账】验证码', intro: '你正在进行邮箱验证。' },
};

/**
 * 依动作类型挑收件人与 token。换绑邮箱（email_change*）要发到**新邮箱**并用 token_new；
 * 仅原邮箱确认（email_change_current）发到当前邮箱、用 token。其余动作都发到 user.email、用 token。
 */
function pickRecipient(user, data) {
  const type = data.email_action_type;
  if (type === 'email_change' || type === 'email_change_new') {
    return { email: user.new_email || user.email, token: data.token_new || data.token };
  }
  return { email: user.email, token: data.token };
}

/** 极简中文 HTML 正文；验证码放大加字距，附有效期与安全提示。 */
function buildHtml(intro, token, minutes) {
  const code = escapeHtml(String(token));
  return (
    '<div style="max-width:480px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.6">' +
    '<h2 style="margin:0 0 16px;font-size:20px">家账 HomeBook</h2>' +
    `<p style="margin:0 0 12px;font-size:15px">${escapeHtml(intro)}</p>` +
    `<p style="margin:0 0 12px;font-size:15px">你的验证码是：</p>` +
    `<p style="margin:0 0 16px;font-size:30px;font-weight:700;letter-spacing:8px;color:#111">${code}</p>` +
    `<p style="margin:0;font-size:13px;color:#888">验证码 ${minutes} 分钟内有效，请勿泄露给他人。若非本人操作，请忽略此邮件。</p>` +
    '</div>'
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── 阿里云邮件推送 SingleSendMail（RPC 风格 · 手写签名，零 SDK 依赖）──────────────────
/**
 * 调 dm.aliyuncs.com 的 SingleSendMail 发一封信。RPC 签名（HMAC-SHA1，SignatureVersion=1.0）。
 * accountName＝控制台创建的发信地址（addressType=1）；发件人昵称走 FromAlias。
 */
async function sendDirectMail(toAddress, subject, htmlBody) {
  const params = {
    // —— 公共参数 ——
    Action: 'SingleSendMail',
    Format: 'JSON',
    Version: '2015-11-23',
    AccessKeyId: env('ALIBABA_CLOUD_ACCESS_KEY_ID'),
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), // ISO8601 UTC，去毫秒
    // —— 业务参数 ——
    AccountName: env('DM_ACCOUNT_NAME'), // 如 no-reply@homebook-app.com
    AddressType: '1',
    ReplyToAddress: 'false',
    ToAddress: toAddress,
    Subject: subject,
    HtmlBody: htmlBody,
    FromAlias: process.env.DM_FROM_ALIAS || '家账',
  };
  params.Signature = rpcSign('POST', params, env('ALIBABA_CLOUD_ACCESS_KEY_SECRET'));

  const form = Object.keys(params)
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const endpoint = process.env.DM_ENDPOINT || 'dm.aliyuncs.com';

  const { status, text } = await httpsPostForm(endpoint, form);
  let json = {};
  try {
    json = JSON.parse(text || '{}');
  } catch {
    /* 保留原始 text 供报错 */
  }
  if (status < 200 || status >= 300) {
    throw new Error(`DirectMail SingleSendMail failed: HTTP ${status} ${json.Code || ''} ${json.Message || text}`);
  }
  return json; // { EnvId, RequestId }
}

/** RPC v1 签名：排序→规范化 query→StringToSign→HMAC-SHA1(secret+'&')→base64。 */
function rpcSign(method, params, accessKeySecret) {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');
  const stringToSign = `${method}&${percentEncode('/')}&${percentEncode(canonical)}`;
  return crypto.createHmac('sha1', accessKeySecret + '&').update(stringToSign).digest('base64');
}

/**
 * 阿里云 RPC 专用百分号编码（RFC3986）。注意：JS 的 encodeURIComponent 会**漏编** `! ' ( ) *`
 * 这几个字符（保留为字面量），而阿里云签名要求它们也编码——否则含这些字符（如正文 font-family 里的
 * 单引号 'Segoe UI'）时，客户端与服务端算出的 stringToSign 不一致，报 SignatureDoesNotMatch。
 * 故在 encodeURIComponent 基础上补齐：+ →%20、* →%2A、! →%21、' →%27、( →%28、) →%29、%7E →~。
 */
function percentEncode(str) {
  return encodeURIComponent(String(str))
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
    .replace(/[!'()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function httpsPostForm(host, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        method: 'POST',
        path: '/',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('DirectMail request timeout')));
    req.end(body);
  });
}

// ── Standard Webhooks 验签（与短信 Hook 完全一致）────────────────────────────────
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
/** GoTrue Send Email Hook 约定的失败返回体。 */
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
module.exports = { processHook, verifyWebhook, pickRecipient, buildHtml, rpcSign, percentEncode };
