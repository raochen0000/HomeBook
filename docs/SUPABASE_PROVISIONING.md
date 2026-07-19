# 新建 Supabase 实例 · 开机清单（阿里云托管 RDS Supabase）

在**新的阿里云托管「RDS Supabase」实例**上把家账 HomeBook 后端**从零重建到可用**。适用：旧实例丢失/迁移。
背景：最早的自建实例（`spb-…opentrust.net`）是「免费试用」到期被**自动释放**（连回收站都没有）；现改用**付费的阿里云托管 RDS Supabase**（当前实例 `http://112.124.220.11`）。

> ⚠️ **务必用正式实例（按量/包月），别再用「免费试用」**——到期会自动释放清空。关联底层 RDS 一并转正式。
> ⚠️ **托管版 ≠ 自建版**：Auth 配置在**阿里云 RDS 控制台**（不在 Studio）；邮件走 **SMTP**（没有 Send Email Hook）；控制台**没有 Apple provider**。下面按托管版写，差异处标注「（自建版则…）」。

结构性配置全在 git 迁移里（跑一遍即重建）；少量手动设置逐条列在下面。
FC 三个函数（短信 `homebooksms`、邮件 `email-hook-fc`、推送 `homebook_notification_push`）**不随 Supabase 释放、仍在**——托管版下：短信 FC 仍复用、**邮件 FC 闲置**（改走 SMTP）、推送 FC 换环境变量复用。

---

## 0. 建实例，记下这些

Studio 里点 **ApiKeys 弹窗**（或控制台右上「获取 API Key」）拿三把 key：

- **AnonKey**（`role:anon`）→ 客户端 `.env`
- **ServiceKey**（`role:service_role`，高权限）→ 只给 push-fc / 后端，**切勿进客户端或仓库**
- **JwtSecret** → 签发所有令牌的母密钥，最敏感，什么都别填、别外传
- **Project URL**：当前 `http://112.124.220.11`（**纯 HTTP 裸 IP**，见第 5 步 ATS）
- Studio **登录用户名/密码**（用户名 `supabase`）→ **存密码管理器**

> ⚠️ 别被 Studio 的 **Connect → App Frameworks → `.env.local`** 那页骗了——它只显示占位符 `<prefer publishable key…>`，**不是真 key**；真 key 在 ApiKeys 弹窗 / Settings→API。AnonKey 与 ServiceKey **开头几乎一样**（都 `eyJ0…eyJpc3M…`），只差 payload 里 `role`，**别复制错**（service_role 进客户端＝谁都能绕 RLS 读全库）。
> 顺手把三把 key + 面板密码 + `.p8`/Key ID/Team ID 一起存密码管理器——上次就是丢面板密码 + 无备份才被动。

## 1. 跑数据库迁移（重建 schema / RLS / RPC / 种子 / 存储策略）

Studio → **SQL Editor**，把 `supabase/migrations/` 下**全部 `.sql` 按文件名顺序各跑一遍**（文件名 `YYYYMMDDHHMMSS_*`，字典序即执行序）。跑完即得：全部表、约束/触发器、RLS 辅助函数与策略、所有 RPC、系统分类种子、存储桶策略、`homebook-feedback-images` 桶。

> 便捷：可用 `all_migrations.sql`（31 段合并、带 `-- ===== 文件名 =====` 分隔）一次贴进跑完；报错就看最近分隔定位、从那段起单独往后跑。
> DB 端口对外被墙，只能走 Studio SQL Editor，不能 psql/CLI（见 [[supabase-deploy-constraint]]）。
> Studio 里除 `public` 都是系统 schema（`storage`/`auth`/… 只读，别动）；你的业务表只在 `public`，跑迁移前它是空的。

## 2. 建存储桶（迁移只建了反馈桶，头像/封面桶要手建）

Studio → **Storage** → 新建两个 **Public** 桶（策略已由迁移 0020–0022 建好，桶本身要手建）：

- `homebook-user-avatars`（public）
- `homebook-family-covers`（public）

（`homebook-feedback-images` 由迁移 0025 自动建。为何 public：storage 上下文取不到 `auth.uid()`，用「公开桶 + 不可猜随机路径」，写权限由 owner 列策略兜底，见 [[supabase-storage-rls-no-identity]]。）

## 3. Auth 手动设置（托管版：**阿里云 RDS 控制台 → 配置 → Auth配置**）

> 托管版把 Auth 挪出了 Studio（Studio 的 Authentication 只剩 Users + Policies）。（自建版则在 Studio → Authentication，且邮件走 Hook、有 Apple provider。）

**「身份验证」tab：**

- **用户注册** → 允许新用户注册：开（登录即注册）。
- **邮箱**（走 SMTP —— 托管版**没有 Send Email Hook**）：
  - 启用外部邮箱登录：开；邮箱自动确认：开（`mailer_autoconfirm`，不依赖邮件确认）。
  - SMTP：主机 `smtpdm.aliyun.com`（新加坡区 `smtpdm-ap-southeast-1.aliyun.com`）/ 端口 `465` / 用户名＝发信地址 `no-reply@homebook-app.com` / 密码＝邮件推送控制台「设置SMTP密码」那串（**不是 AccessKey**）/ 发件人名「家账」/ 管理员邮箱＝你的。
  - **网站前端地址 → `homebook://`**（app scheme；表单若强制 http(s) 就填 `http://112.124.220.11`）；**API外部访问地址 → `http://112.124.220.11`**（默认 `localhost:3000` **必须改**）。
  - 邮件 OTP：6 位 / 3600s（与 `verifyOtp(type=recovery/email_change)` 一致）。
  - ⇒ 结果：`email-hook-fc` 这个实例**用不上**，闲置即可。
- **手机号** → 用 **SMS Webhook** tab（**不是**「阿里云 SMS Provider」——那个走短信服务要企业资质；你走 PNVS→FC，见 [[supabase-phone-otp-native-aliyun]]）：
  - 开启 SMS Web Hook；https 服务地址 = `homebooksms` FC 地址；**Hook 密钥 = 该 FC 的 `HOOK_SECRET`（两边必须一致，否则验签失败、收不到码）**；SMS OTP 有效期填个值（如 `600`）。
- **Apple** → 托管版控制台**没有 Apple provider**：
  - **国内版：搁置**。主登录是手机 OTP + 邮箱（均第一方）；只要不接第三方社交登录，App Store 4.8 不强制 Apple。⚠️ 一旦加微信/Google 登录，Apple 立即变强制。
  - **国际版：本就不用阿里云 RDS Supabase**，走 **Supabase 云版 / 海外自建**（原生支持 Apple）。App 代码（`src/app/account/apple.tsx` 的 `linkIdentity`）已就绪，后端配好 provider 零改动生效。
- **密码策略**：托管版邮箱面板**无此入口**。若手机 OTP 报 `422 weak_password`（自建版靠 Password Requirements=`No required characters` 规避），托管版需**工单**问阿里云。

## 4. FC（托管版：**只 push-fc 一个要改**）

> SMS Hook 已在第 3 步控制台配好；Email Hook 托管版没有（走了 SMTP）→ `email-hook-fc` 闲置。（自建版则要在 Studio → Authentication → Hooks 配 SMS + Email 两个 Hook，且 URI 必须 FC 内网地址。）

- **push-fc**（`homebook_notification_push`，FC 定时轮询拉通知投递）：FC 控制台 → 该函数 → **配置 → 环境变量**：
  - `SUPABASE_URL` = `http://112.124.220.11`
  - `SUPABASE_SERVICE_ROLE_KEY` = 新 **ServiceKey**（第 0 步那把 service_role，**不是 anon**）
  - 定时触发器 `@every 1m` 不变（见 [`services/push-fc/README.md`](../services/push-fc/README.md)）。
  - 需实例**已开「允许实例访问公网」**，push-fc 才能连到公网 IP。

## 5. 客户端 `.env` + `app.json`（HTTP 要加 ATS）

项目根 `.env`：

```
EXPO_PUBLIC_SUPABASE_URL=http://112.124.220.11
EXPO_PUBLIC_SUPABASE_KEY=<新 AnonKey>
```

`app.json`（URL 是**纯 HTTP 裸 IP**，iOS ATS 会拦明文，必须加例外；IP 用不了 `NSExceptionDomains`，只能全局）：

```json
"ios": { "infoPlist": { "NSAppTransportSecurity": { "NSAllowsArbitraryLoads": true } } }
```

> ⚠️ 拿到 HTTPS / 上架 App Store 前**必须删掉这个例外**（否则审核卡 + 明文裸奔）。Android 若跑另配 `usesCleartextTraffic`。
> 改完 `npx expo start --clear`（`EXPO_PUBLIC_*` 打包内联，必须清缓存）。`infoPlist` 是**原生配置** → 现有 dev client 连不上（日志见 `cleartext`）时要**重建 dev client**。客户端**代码一行不用动**。

## 6. 验证清单

- [ ] 迁移无报错；`select count(*) from public.categories;` 有系统分类种子。
- [ ] 两个桶 `homebook-user-avatars` / `homebook-family-covers` 已建且 public。
- [ ] 真机手机号登录**收到验证码**（SMS Webhook + FC 通）→ 登录成功。
- [ ] 记一笔 / 建家庭 / 报表（表 + RLS + RPC 通）。
- [ ] 头像上传成功（storage 通）。
- [ ] 「忘记密码」**收到邮件**（SMTP 通）。
- [ ] 通知设置开系统推送 → `device_tokens` 有令牌；插一条 in_app 通知 → 真机收推（push-fc 通；真正到达还依赖 APNs / 付费 Apple Dev）。

---

## 常见坑速查

| 症状 | 处置 |
| --- | --- |
| 手机 OTP `422 weak_password` | 自建版：Email → Password Requirements=`No required characters`；**托管版无此入口 → 工单**（第 3 步） |
| 手机收不到码 | SMS Webhook 的 **Hook 密钥 ≠ FC 的 `HOOK_SECRET`** → 同步一致（第 3 步） |
| 短信/邮件 `hook_timeout` | 自建版 Hook URI 必须 FC 内网/VPC 地址；**托管版可能与 FC 不同 VPC → 开「允许实例访问公网」改用公网地址** |
| 邮件发不出 | 未开「允许实例访问公网」，或 SMTP 密码填成了 AccessKey（第 3 步） |
| 邮件里没验证码 | 模板正文要含 `{{ .Token }}`（你的流程是验证码、非魔法链接） |
| iOS 连不上 Supabase | app.json 缺 ATS 例外，或改后 dev client 未重建（第 5 步） |
| FC 子域名 `Subdomain is invalid` | FC 函数名**别带连字符**（如 `homebooksms`） |
| 头像上传 `violates row-level security` | 存储策略按 owner 列判定（迁移 0022 已含），且桶要 public（第 2 步） |

关联记忆：[[supabase-deploy-constraint]] · [[supabase-phone-otp-native-aliyun]] · [[email-hook-fc-no-smtp]] · [[supabase-storage-rls-no-identity]] · [[supabase-client-setup]] · [[supabase-instance-provisioning]]
