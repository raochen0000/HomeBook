# 认证邮件 Hook（阿里云 FC）

把 Supabase Auth(GoTrue)的 **Send Email Hook** 落到阿里云函数计算 FC，由它调用阿里云
**邮件推送(DirectMail)** 的 HTTP API `SingleSendMail` 发认证邮件（找回密码 / 换绑邮箱 / 登录验证码等）。

**为什么不用 SMTP？** 自托管 GoTrue(auth)容器**无公网出口**，直连 `smtpdm.aliyun.com` 的 465/587/80
全部 `context deadline exceeded` 超时。改走 FC：auth 容器 → FC **内网地址**可达，FC → 阿里云公网可达。
与短信 Hook（[`../sms-hook-fc`](../sms-hook-fc)）**完全同构**，链路与取舍见 [`index.js`](index.js) 顶部注释。

一句话：**GoTrue 自己生成/校验 OTP、自己签发 session，本函数只负责把那串 token 拼进邮件发出去**——
登录/找回密码/换绑全是 GoTrue 原生行为，客户端只多调 `resetPasswordForEmail` / `verifyOtp`。

> ⚠️ 开启 Send Email Hook 后，**Supabase 自带邮件模板被完全旁路**，正文由本函数拼装。所以不用再去
> Studio 改 `recovery` 模板加 `{{ .Token }}`。

---

## 前置（你已完成）

- 阿里云开通「邮件推送」；**发信域名 `homebook-app.com` 验证通过**；**发信地址 `no-reply@homebook-app.com`** 已建。
- 拿到有邮件推送权限的 **AccessKey ID/Secret**（建议用 RAM 子账号，仅授权 `AliyunDirectMailFullAccess`）。

## 1. 部署 FC 函数（FC 3.0「Web 函数」）

本函数**零第三方依赖**，打包极小：

```bash
cd services/email-hook-fc
npm run zip            # 产出 function.zip（只含 index.js + package.json）
```

FC 控制台 → 创建函数 → 选 **Web 函数**（**别选事件函数**——本服务靠透传原始 body 验签）：
- 运行环境：**Node.js 20**
- 上传 `function.zip`
- **启动命令**：`node index.js`
- **监听端口**：`9000`
- **访问设置**：开启公网访问、**认证方式「无需认证（anonymous）」**（安全由下面的 Webhook HMAC 保证）。

记下 FC 的两个访问地址：**公网**（`https://<id>.cn-hangzhou.fcapp.run`，本地联调用）和 **内网/VPC**
（带 `-vpc`，给 GoTrue 用）。

## 2. 生成 Hook 共享密钥

```bash
echo "v1,whsec_$(openssl rand -base64 32 | tr -d '\n')"
# 同一串同时填到 GoTrue 与 FC
```

## 3. 配置 FC 环境变量

按 [`.env.example`](.env.example) 逐项填：`ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET`
/ `DM_ACCOUNT_NAME`（`no-reply@homebook-app.com`）/ `HOOK_SECRET`（上一步那串）。可选 `DM_FROM_ALIAS`（默认「家账」）。

## 4. 本地先验「FC + 邮件推送」这半边（强烈建议）

接 GoTrue 之前，先用**公网地址**打一封真信，隔离掉 GoTrue 因素：

```bash
HOOK_SECRET='v1,whsec_...' \
FC_URL='https://<id>.cn-hangzhou.fcapp.run' \
node test-send.mjs 你的邮箱@example.com recovery
```

收到信 → FC→邮件推送 通了，进下一步。没收到 → 看 FC「实时日志」的 `[send-email hook] failed:`。

## 5. 配置 GoTrue（自托管实例环境变量）

```bash
GOTRUE_HOOK_SEND_EMAIL_ENABLED=true
# ⚠️ 用 FC 的【内网/VPC 地址】(带 -vpc)！auth 容器无公网出口，填公网地址会 hook_timeout（见短信 README §5）
GOTRUE_HOOK_SEND_EMAIL_URI=https://<FC 内网地址，形如 xxx-vpc.cn-hangzhou.fcapp.run>
GOTRUE_HOOK_SEND_EMAIL_SECRETS=v1,whsec_<与 FC 完全相同>
```

改完**重启 auth 容器**。（邮箱确认 Confirm email 你已在 UI 关掉＝autoconfirm，登录即注册那条路不受影响。）

## 6. 端到端验证

```bash
# 直接打 GoTrue 的 recover（和 App「忘记密码」等价），应收到验证码邮件
curl -s -X POST "$EXPO_PUBLIC_SUPABASE_URL/auth/v1/recover" \
  -H "apikey: $EXPO_PUBLIC_SUPABASE_KEY" -H "Content-Type: application/json" \
  -d '{"email":"你的邮箱@example.com"}'
```

- 排错：客户端/`curl` 报 `hook_timeout` → GoTrue 够不到 FC，URI 换 FC **内网**地址。
- GoTrue 报签名失败 → `HOOK_SECRET` 两边不一致，或 FC 与实例时钟偏差 > 5 分钟。
- 函数 200 但收不到信 → 看 FC 日志 `[send-email hook] failed:`（发信地址未验证 / AccessKey 无权限 / 域名未验证 / 欠费）。

## 支持的邮件动作

`recovery`（找回密码）· `email_change`(_current/_new，换绑邮箱)· `magiclink` · `signup` · `invite`
· `reauthentication`。主题/正文见 [`index.js`](index.js) 的 `EMAIL_TEMPLATES`。换绑邮箱会自动发到**新邮箱**。

## 密钥轮换

`GOTRUE_HOOK_SEND_EMAIL_SECRETS` 与 `HOOK_SECRET` 都支持空格分隔多串，灰度期新旧并存，切完再删旧。
