# 手机号 OTP 短信 Hook（阿里云 FC）

把 Supabase Auth(GoTrue)的 **Send SMS Hook** 落到阿里云函数计算 FC，由它调用
阿里云「短信认证服务(PNVS)」`dypnsapi.SendSmsVerifyCode` 下发验证码。**个人开发者免企业资质**
（仅个人实名 + 系统赠送签名/模板）。

链路与取舍见 [`index.js`](index.js) 顶部注释。一句话：**GoTrue 自己生成/校验 OTP、自己签发 session，
本函数只负责把那串验证码经阿里云发出去**——登录/注册/注销/绑号/删号全是 GoTrue 原生行为，客户端
（`src/lib/auth.ts` 的 `signInWithOtp`/`verifyOtp`）一行不用改。

---

## 前置（你已完成）

- 阿里云个人实名 + 开通「短信认证服务」，拿到 **AccessKey ID/Secret**、系统赠送的 **SignName** 与 **TemplateCode**。

## 1. 部署 FC 函数（FC 3.0「Web 函数」）

1. 准备代码包（本地装依赖后打包，纯 JS 无原生依赖）：
   ```bash
   cd services/sms-hook-fc
   npm install
   npm run zip            # 产出 function.zip（含 node_modules）
   ```
2. FC 控制台 → 创建函数 → 选 **Web 函数**（FC 3.0 的 HTTP 服务型函数，旧版叫「HTTP 函数」；
   **别选「事件函数」**——本服务靠透传的原始 body 验签，事件函数会预解析导致签名对不上）：
   - 运行环境：**Node.js 20**
   - 代码上传方式：上传 `function.zip`
   - **启动命令**：`node index.js`
   - **监听端口**：`9000`（与代码默认一致；FC 也会用 `FC_SERVER_PORT` 注入，代码已兼容）
3. **访问设置**：开启公网访问，**认证方式选「无需认证（anonymous）」**。安全由下面的 Webhook HMAC
   保证，不依赖 FC/IAM 鉴权。记下公网访问 URL（形如 `https://<id>.cn-hangzhou.fcapp.run/`）。

## 2. 生成 Hook 共享密钥

GoTrue 与本函数用同一把密钥做 Standard Webhooks 验签：

```bash
echo "v1,whsec_$(openssl rand -base64 32 | tr -d '\n')"
# 例：v1,whsec_Yk9...（同一串同时填到 GoTrue 与 FC）
```

## 3. 配置 FC 环境变量

按 [`.env.example`](.env.example) 在函数配置里逐项填入：
`ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `SMS_SIGN_NAME`（从「短信认证 →
签名配置」复制）/ `SMS_TEMPLATE_CODE`（登录/注册＝`100001`）/ `HOOK_SECRET`（上一步那串）。
系统赠送模板含 `${code}` + `${min}` 两个变量，代码默认已自动填好（`min` = `SMS_OTP_EXP`/60，即 5），
无需额外配置；仅当模板变量不同才用 `SMS_TEMPLATE_PARAM` 覆盖。

## 4. 配置 GoTrue（自托管实例环境变量）

```bash
# 启用 Send SMS Hook（启用后即覆盖原内置 Aliyun provider，绕开企业资质那条死路）
GOTRUE_HOOK_SEND_SMS_ENABLED=true
# ⚠️ 用 FC 的【内网/VPC 地址】(带 -vpc)，不要用公网地址！自托管 auth 容器多半无公网出口，
#    填公网地址会 hook_timeout（5 秒内够不到）；内网地址走阿里云内网、免公网出口（见 §5）。
GOTRUE_HOOK_SEND_SMS_URI=https://<FC 内网访问地址，形如 xxx-vpc.cn-hangzhou.fcapp.run>
GOTRUE_HOOK_SEND_SMS_SECRETS=v1,whsec_<与 FC 完全相同>

# 手机号 OTP 基础项（与客户端一致：6 位、5 分钟、60s 限频）
GOTRUE_EXTERNAL_PHONE_ENABLED=true
GOTRUE_SMS_AUTOCONFIRM=false
GOTRUE_SMS_OTP_LENGTH=6
GOTRUE_SMS_OTP_EXP=300
GOTRUE_SMS_MAX_FREQUENCY=60s
```

改完重启 auth 容器。（`OTP_LENGTH=6` 必须与登录页 `OTP_LEN=6` 一致。）

## 5. 两处网络可达性（之前 504 的根因，务必确认）

1. **GoTrue → FC**：hook URI 用 FC 的**内网/VPC 地址**（见 §4）。实测：自托管 auth 容器无公网出口，
   填公网 `fcapp.run` 会 `hook_timeout`（5 秒内够不到）；换内网地址（同区域 cn-hangzhou）即通。
   若 GoTrue 与 FC 不同 VPC/区域，则需把 FC 绑到 GoTrue 的 VPC，或给 auth 容器配公网出口（NAT）。
2. **FC → `dypnsapi.aliyuncs.com`** 能通：FC 默认有公网出口；若 FC 绑了 VPC，需给该 VPC 配
   **NAT 网关**保证出网，否则发短信会超时（就是之前 GoTrue 直连阿里云时的 504/deadline）。

## 6. 验证

- 健康检查：浏览器开 FC URL，应返回 `{"ok":true}`。
- 端到端：真机登录页输入 +86 手机号 → 「获取验证码」→ 收到短信 → 输码 → 登录成功。
- 排错：FC 日志看本函数的 `[send-sms hook] failed:`；GoTrue 日志看 hook 调用与签名是否通过。
  - 客户端报 `hook_timeout`（5 秒够不到 hook）：GoTrue 够不到 FC，hook URI 改用 FC 内网地址（见 §5）。
  - 收不到短信但函数 200：多半是 `SMS_TEMPLATE_PARAM` 与系统模板变量不匹配，或 AccessKey 权限/欠费。
  - GoTrue 报签名失败：`HOOK_SECRET` 两边不一致，或 FC 与实例时钟偏差 > 5 分钟。

## 密钥轮换

`GOTRUE_HOOK_SEND_SMS_SECRETS` 与 `HOOK_SECRET` 都支持空格分隔多串，灰度期新旧并存，切完再删旧。
