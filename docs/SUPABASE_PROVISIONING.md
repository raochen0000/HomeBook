# 新建 Supabase 实例 · 开机清单（自建 · 阿里云）

在**新的自建 Supabase 实例**上把家账 HomeBook 的后端**从零重建到可用**。适用场景：旧实例丢失/迁移。
背景：旧实例是「免费试用」到期被**自动释放**（连回收站都没有），故——

> ⚠️ **务必选正式实例（按量付费 / 包年包月），不要再用「免费试用」**——到期会像这次一样自动释放清空。
> 关联底层 RDS 也要一并转正式，别让它单独到期。

配置分两块：**结构性配置全在 git 迁移里（跑一遍即重建）**；**少量手动设置**在下面逐条列出。
你之前部署在阿里云 FC 的三个函数（短信 `homebooksms`、邮件、推送 `homebook_notification_push`）
**不随 Supabase 释放、仍在**，只需把新实例的 Hook 重新指过去 / 换环境变量即可复用。

---

## 0. 建实例，记下四样东西

新实例建好后，从 Studio → **Project Settings → API** 记下：

- **Project URL**（如 `https://xxx.supabase.opentrust.net`）
- **anon key**（public，给客户端）
- **service_role key**（secret，给 push-fc / 后端，切勿进客户端或仓库）
- Studio **DASHBOARD 登录用户名/密码**（自建 Kong Basic Auth；**存进密码管理器**，别再忘）

> 顺手把这些连同 `.p8`/Key ID/Team ID 一起存进密码管理器——上次就是丢了面板密码 + 无备份才被动。

## 1. 跑数据库迁移（重建 schema / RLS / RPC / 种子 / 存储策略）

Studio → **SQL Editor**，把 `supabase/migrations/` 下**所有 `.sql` 按文件名顺序从头到尾各跑一遍**
（文件名即 `YYYYMMDDHHMMSS_*`，按字典序就是正确的执行顺序）。跑完即得：全部表、约束/触发器、
RLS 辅助函数与策略、所有 RPC 函数、系统分类种子、存储桶策略、`homebook-feedback-images` 桶。

> DB 端口对外被墙，只能走 Studio SQL Editor，不能 psql/CLI（见 [[supabase-deploy-constraint]]）。
> 一次贴一个文件执行；报错就停下来看，别跳过顺序。

## 2. 建存储桶（迁移只建了反馈桶，头像/封面桶要手建）

Studio → **Storage** → 新建两个 **Public** 桶（策略已由迁移 0020–0022 建好，桶本身要手建）：

- `homebook-user-avatars`（public）
- `homebook-family-covers`（public）

（`homebook-feedback-images` 由迁移 0025 自动建，无需手动。）

> 为何 public：本实例 storage 上下文取不到 `auth.uid()`，做不了「仅本人可读」私有桶，MVP 用
> 「公开桶 + 不可猜随机路径」；写权限由 owner 列策略兜底（见 [[supabase-storage-rls-no-identity]]）。

## 3. Auth 手动设置（Studio → Authentication）

这些当初手点、没进 git，逐条重配：

- **Providers → Email**：
  - **Password Requirements = `No required characters`**（否则手机号 OTP 会 `422 weak_password`——强密码
    策略套到了无密码的手机注册路径，坑见 [[supabase-phone-otp-native-aliyun]]）。
  - **Confirm email 关闭 / autoconfirm 开启**（登录即注册、不依赖邮件；`mailer_autoconfirm`）。
  - Email OTP：6 位 / 3600s（与 `verifyOtp(type=recovery/email_change)` 及邮件 FC 的有效期文案一致）。
- **Providers → Phone**：启用（短信下发走 Hook，不用原生 provider；见第 4 步）。
- **Providers → Apple**：填 Apple 登录的 Service ID / Team ID / Key ID / `.p8` +**开 Manual Linking**
  （`bindApple` 走 `linkIdentity(id_token)` 需要它）。注意这是 **Sign in with Apple 登录**用的，
  与推送的 APNs Key 是两把不同的东西。
- （可选）Secure email change：与 `bindEmail` 的新旧邮箱双确认流程相关，按需开。

## 4. 重新指向三个 FC（都还在阿里云，复用）

- **Send SMS Hook**（Studio → Authentication → Hooks）：
  - URI = 短信 FC 的**内网/VPC 地址**（形如 `https://xxx-vpc.cn-hangzhou.fcapp.run/`）。
    **必须内网地址**——填公网会 `hook_timeout`（自建 auth 容器无公网出口，见 [[supabase-phone-otp-native-aliyun]]）。
  - Secret = 一把 `v1,whsec_...`，同时填到 Hook 和 FC 的 `HOOK_SECRET`（`GOTRUE_HOOK_SEND_SMS_SECRETS`）。
- **Send Email Hook**：同理，URI = 邮件 FC 内网地址，Secret 同步到 FC 的 `HOOK_SECRET`
  （`GOTRUE_HOOK_SEND_EMAIL_SECRETS`，见 [[email-hook-fc-no-smtp]]）。
- **push-fc**（推送投递，FC 定时轮询）：改它的环境变量为**新实例**的：
  - `SUPABASE_URL` = 新 Project URL
  - `SUPABASE_SERVICE_ROLE_KEY` = 新 service_role key
  - 定时触发器 `@every 1m` 不变（见 [`services/push-fc/README.md`](../services/push-fc/README.md)）。

## 5. 更新客户端 `.env`

项目根 `.env`：

```
EXPO_PUBLIC_SUPABASE_URL=<新 Project URL>
EXPO_PUBLIC_SUPABASE_KEY=<新 anon key>
```

（改完重启 Metro；客户端代码一行不用动。）

## 6. 验证清单

- [ ] 迁移全跑完、无报错；`select count(*) from public.categories;` 有系统分类种子。
- [ ] 两个桶 `homebook-user-avatars` / `homebook-family-covers` 已建且 public。
- [ ] 真机登录：手机号收到验证码（短信 Hook 通）→ 登录成功。
- [ ] 记一笔 / 建家庭 / 报表 正常（表 + RPC 通）。
- [ ] 头像上传成功（storage 通）。
- [ ] 「忘记密码」收到邮件（邮件 Hook 通）。
- [ ] 通知设置开系统推送 → `device_tokens` 有令牌；插一条 in_app 通知 → 真机收推（push-fc 通）。

---

## 常见坑速查（都来自实战记忆）

| 症状 | 处置 |
| --- | --- |
| 手机 OTP `422 weak_password` | Email provider → Password Requirements 置 `No required characters`（第 3 步） |
| 短信/邮件 `hook_timeout` | Hook URI 必须用 **FC 内网/VPC 地址**，不是公网（第 4 步） |
| FC 子域名 `Subdomain is invalid` | FC 函数名**别带连字符**（如 `homebooksms`） |
| Studio 测试号不发真短信 | 测试号会短路不调 Hook，验真链路用真号 |
| 头像上传 `violates row-level security` | 存储策略按 owner 列判定（迁移 0022 已含），且桶要 public（第 2 步） |

关联记忆：[[supabase-deploy-constraint]] · [[supabase-phone-otp-native-aliyun]] · [[email-hook-fc-no-smtp]] · [[supabase-storage-rls-no-identity]] · [[supabase-client-setup]]
