# HomeBook 迁移至 Supabase Cloud 执行手册

> 文档状态：执行中；方案基线：2026-08-31；适用项目：HomeBook iOS（Expo SDK 56）。目标是将当前阿里云自托管 Supabase 迁移到 Supabase Cloud，并继续使用现有 App、Bundle ID 与 App Store Connect 记录。

## 1. 已确认的首版决策

| 项目          | 首版决定                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 用户区域      | 仅面向海外用户；App Store 首版不勾选中国大陆 storefront                                                                                |
| App 形态      | 只维护一套 App、一套数据，不做中国版/海外版双部署                                                                                      |
| Supabase 套餐 | 先使用 Supabase Cloud Free；达到升级条件后再转 Pro/Team                                                                                |
| 登录方式      | 邮箱密码 + Apple ID                                                                                                                    |
| 手机号 OTP    | 首版不提供，也不作为发布阻塞项；阿里云短信 FC 暂停使用                                                                                 |
| 认证邮件      | 配置第三方自定义 SMTP；不得将 Supabase 默认 SMTP 用于生产用户                                                                          |
| 密码错误锁定  | Free/Pro 无法启用 Password Verification Attempt Hook；首版不承诺“连续错误 5 次锁定 24 小时”                                            |
| 计算任务      | 目标形态为 Supabase Edge Functions + Cron；允许迁移期间短期保留现有推送 FC 作为过渡                                                    |
| 域名与 TLS    | App API 先使用 Supabase 默认 `https://<project-ref>.supabase.co`；无需购买新域名或证书                                                 |
| 现有域名      | 保留 `homebook-app.com`，继续用于隐私政策、支持页和邮件发信域名验证                                                                    |
| 发布方式      | 保留 `com.raochen.homebook-app`、`homebook` scheme、EAS project ID `faed146a-1f37-4a70-8ee7-c4a31a8ffa40` 及现有 App Store Connect App |

这些决定改变了当前 [PRD.md](./PRD.md) 与 [TECH.md](./TECH.md) 中“国内优先、手机号为主登录、五次错误锁定”的产品契约。实施迁移时必须同步修改相关产品文档、界面、文案和测试；本手册本身不代表这些改动已经完成。

## 2. 成功标准

迁移只有同时满足以下条件才算完成：

- [ ] App 的生产构建仅连接目标 Supabase Cloud 项目，且客户端只持 publishable/anon 级凭据。
- [ ] 邮箱注册/登录、找回密码、更换邮箱和 Apple 登录/绑定/解绑均在真机通过。
- [ ] 47 个版本化迁移（44 个基线 migration + 3 个 Cloud 兼容/安全 migration）在干净 Cloud 项目可重放；所有客户端表、视图和 RPC 均通过 RLS 允许/拒绝测试。
- [ ] 家庭、流水、预算、储蓄、报表、通知、反馈、账号注销等现有核心流程通过回归。
- [ ] 四个 Storage bucket 的可见性、策略、对象数量和文件可读性符合预期。
- [ ] 推送投递任务在目标架构稳定运行，且不会重复推送或异常放大调用量。
- [ ] 新的 EAS production 二进制通过 TestFlight 真机回归；不得用 OTA 更新替代后端地址切换。
- [ ] 旧后端在观察期内保留为短期技术回退参照；路径 A 不迁数据，路径 B 才要求最终备份可校验与恢复路径真实可用。
- [ ] App Store 上架地区、隐私披露、隐私政策和支持页与海外单区方案一致。

## 3. 当前实现盘点

迁移范围以仓库和源端实际部署状态共同为准，不能只看任意一方。

| 能力       | 当前实现                                                                                                     | 迁移重点                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 客户端连接 | [`src/lib/supabase.ts`](../src/lib/supabase.ts) 读取 `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY` | URL 与 key 是构建时配置，切换后必须重新 EAS Build                                     |
| Auth       | 邮箱密码、手机号 OTP、Apple `signInWithIdToken`、身份绑定/解绑                                               | 首版隐藏/移除手机号入口；配置 Apple 与生产 SMTP                                       |
| 数据库     | `supabase/migrations/` 共 47 个版本化迁移（含 Cloud Storage、权限兼容与安全修复 migration）                  | 路径 A 以仓库 migration 为唯一重建来源；路径 B 才需逐项对照源库实际 schema 与迁移历史 |
| RLS/RPC    | 大量业务 RPC、触发器和 RLS policy                                                                            | 在 Cloud 逐项做授权与拒绝测试                                                         |
| Storage    | 三个公开媒体桶、一个私有反馈桶（以目标最终状态为准）                                                         | 路径 A 不复制对象或旧 URL；目标项目须用 migration 从零创建并回归验证四个 bucket       |
| 账号注销   | `delete_account` RPC 直接操作 `auth.identities`、`auth.sessions`、`auth.users`                               | Cloud 兼容性与权限必须先专项验证或重构                                                |
| 认证邮件   | 阿里云 SMTP/邮件 FC 历史实现                                                                                 | 生产改用 Cloud Auth 自定义 SMTP；邮件 FC 退出主链路                                   |
| 短信       | GoTrue Send SMS Hook → 阿里云 FC/PNVS                                                                        | 首版关闭，不迁移为发布依赖                                                            |
| 推送       | 阿里云 FC 定时轮询 → Expo Push → APNs                                                                        | 推荐先保持行为等价，再迁 Edge Function + Cron                                         |
| Realtime   | 数据库具备相关能力，当前 App 核心通知不依赖 Realtime                                                         | 不为迁移额外引入 Realtime 依赖                                                        |

目标 Storage 最终状态：

| Bucket                       | 目标可见性 | 用途              |
| ---------------------------- | ---------- | ----------------- |
| `homebook-user-avatars`      | public     | 用户头像          |
| `homebook-family-covers`     | public     | 家庭头像/历史封面 |
| `homebook-family-background` | public     | 家庭背景          |
| `homebook-feedback-images`   | private    | 意见反馈截图      |

> 路径 A 不以源端 bucket 状态作为迁移阻塞项；上表是目标 Cloud 必须实现的最终状态。路径 B 才需从源端导出实际 bucket 与对象清单。

## 4. 执行原则与停止条件

### 4.1 执行原则

1. **先演练、后启用生产**：所有 schema、Auth、Storage 和账号注销兼容性先在干净 Cloud 目标项目验证；路径 A 验证通过后可将同一项目作为生产项目。
2. **优先走“干净重建”**：如果尚无真实生产用户，迁移 schema 与配置，不迁开发账号和测试数据。
3. **不修改历史迁移**：新的兼容性修复通过新 migration 追加，避免破坏已执行环境。
4. **数据库、Auth、Storage 分开核对**：路径 A 重建目标数据库与空 bucket；路径 B 的数据库 dump 不等于 Storage 对象已经迁移。
5. **秘密不进仓库**：数据库密码、Apple 私钥、SMTP 密码、secret/service-role key 仅放密码管理器或服务端 Secret；不得写入 Markdown、`.env.example`、日志或 `EXPO_PUBLIC_*`。
6. **旧后端延迟下线**：路径 A 在 Cloud TestFlight 验证和观察期结束前不删除阿里云实例、FC 或测试数据；路径 B 还须完成可恢复备份。

### 4.2 任一命中即 No-Go

- 路径 B：无法生成并恢复验证源端最终备份。
- 路径 B：仓库迁移与源端实际 schema 差异尚未解释。
- 任一关键 RLS 拒绝用例失败，或客户端可以越权读取/修改家庭数据。
- Apple、邮箱找回密码、更换邮箱或账号注销在 Cloud 失败。
- 真实用户只有手机号登录方式，但首版又已关闭短信。
- 路径 B：Storage 对象数量、字节数或抽样哈希不一致。
- 路径 B：业务表仍引用旧 Storage URL，且旧后端计划下线。
- 推送任务出现重复投递、无限重试或异常调用量。
- TestFlight 真机仍访问旧后端，或 production 构建使用 HTTP/错误 key。

## 5. 先选择数据迁移路径

开始迁移前，只选择下面一条路径，并记录证据。

### 路径 A：尚无真实生产用户（推荐）

适用条件：App 尚未公开发布，源端只有开发/测试账号与可丢弃数据。

执行方式：

- 在 Cloud 从全部仓库 migration 干净重建业务 schema。
- 仅保留 migration 内的系统种子；不迁移测试用户、测试流水和测试图片。
- 在 Cloud 重新创建测试账号进行回归。
- 无需处理用户密码、Apple identity、手机号账号过渡或生产停写窗口。
- 不导出、不恢复源端数据库/Storage 测试数据；源端不作为目标 schema 的权威来源。
- 保留阿里云源端及其 FC 至少到 Cloud TestFlight 验证和观察期完成，用于短期技术回退与问题比对。

优点是风险最低，也能验证仓库是否真正具备可重放能力。

### 路径 B：已有真实生产用户或必须保留的数据

适用条件：源端存在不能丢失的用户、家庭、流水、图片或反馈。

额外要求：

- 完整迁移 `auth` 数据后，邮箱密码 hash 才能保留；不得把密码导出为明文。
- 新 Cloud 项目的 JWT 签名体系与旧项目不同，所有旧 session 一律视为失效，用户需重新登录。
- Apple provider 必须保持相同的 App 身份配置，并用真实迁移账号验证 identity 能继续登录。
- 只有手机号登录的用户，在关闭短信前必须先绑定邮箱或 Apple；否则迁移后会失去登录能力。
- 必须安排最终停写窗口、增量差异核对和正式 Go/No-Go。

路径选择记录：

| 字段                       | 记录                                               |
| -------------------------- | -------------------------------------------------- |
| 选择                       | `A`                                                |
| 判断日期                   | `2026-08-31`                                       |
| 源端真实用户数             | `0（用户确认：现有账号均为测试账号）`              |
| 源端业务表总行数           | `不要求统计；测试数据不迁移`                       |
| 源端 Storage 对象数/总字节 | `不要求统计；测试对象不迁移`                       |
| 证据位置                   | `本运行手册阶段 0/1 执行记录；本地 migration 基线` |
| 执行人                     | `Codex + 用户确认`                                 |

## 6. 分阶段执行方案

### 阶段 0：冻结范围与修改产品契约

目标：在动数据库前，把首版功能范围写清楚。

- [x] 在 `docs/PRD.md` 更新登录方式：邮箱密码 + Apple，首版不提供手机号 OTP。
- [x] 删除/调整所有“手机号为主”“敏感操作优先原手机号 OTP”的交互约定，并明确新的二次验证方式。
- [x] 在 `docs/PRD.md` 暂停“五次错误锁定 24 小时”的首版承诺。
- [x] 在 `docs/TECH.md` 将后端目标改为 Supabase Cloud，并更新邮件、短信、推送、Storage 与区域说明。
- [x] 更新 `docs/DATAMODEL.md` 中仍将手机号视为登录主键的旧蓝图描述。
- [x] 明确 App Store 仅选择海外 storefront，不选择中国大陆。
- [x] 选择路径 A 或 B；若选 B，确定维护窗口、公告和仅手机号用户过渡方案。

阶段 0 执行记录（2026-08-31）：

- 路径 A 已由用户确认；现有账号和数据均为测试用途，不迁入 Cloud production。
- 已更新 `PRD.md`、`TECH.md`、`DATAMODEL.md`，并同步校准 `MVP.md`、`IA.md`、`DESIGN.md`、`REMAINING.md` 与 TestFlight 清单。
- 敏感操作目标规则为邮箱密码/邮箱 OTP/fresh Apple 的近期重新认证；当前客户端尚未完成该服务端校验，列入阶段 7 实现范围。
- App Store 海外 storefront 是发布目标；本阶段只冻结决策，尚未改动 App Store Connect 外部状态。

退出条件：产品范围、迁移路径和用户影响均已书面确认。

### 阶段 1：路径 A 本地基线与源端保留边界

目标：确认可丢弃测试数据的边界，并建立可重复的本地重建基线。此阶段不得改源库。

- [x] 记录当前 Git commit、工作区状态、44 个 migration 文件列表及校验值。
- [x] 用户确认源端没有真实用户，所有账号、业务记录和 Storage 对象均可丢弃；不执行源端数据迁移、逻辑备份或恢复演练。
- [x] 记录源端公开 Auth/REST 参考状态，确认其不是 Cloud 目标配置的权威来源。
- [x] 确认阿里云实例、三个 FC 与测试数据在 Cloud TestFlight 验证和观察期结束前均不删除、不停用。
- [ ] 可选：仅当 Cloud 重建遇到无法从仓库解释的历史行为时，再从源端只读核对 Auth 私有设置、FC 定时器或数据库对象；不得把此项作为创建 Cloud 项目的阻塞条件。

阶段 1 执行记录（进行中，2026-08-31）：

- 本地基线已记录于 `migration-evidence/2026-08-31/source-baseline.md`；44 个 migration 的 SHA-256 清单位于同目录 `migration-checksums.sha256`，并已逐项校验通过。
- 基线 Git HEAD 为 `002cf10928c396135f0bd38e79def733a1554da5`（`main`）；工作区修改范围已随证据记录，未把当前未提交文档改动误算入 Git 基线。
- 本机 Node.js 为 `v22.22.3`；Supabase CLI 已通过 `npx` 缓存并记录为 `2.116.0`，未写入项目依赖。首次下载曾遇到 npm DNS `ENOTFOUND`，获准联网后重试成功。
- 源端公开 Auth Settings、PostgREST OpenAPI 与 anon Storage 响应已记录于 `migration-evidence/2026-08-31/source-inventory.md`。目前确认源端 Email/Phone 开启、Apple 关闭，且实际公开 20 张表和 17 个 RPC；该信息仅作历史参考，不作为 Cloud 目标配置或 migration 的权威来源。
- 用户于 2026-08-31 确认采用“路径 A 简化版”：不迁测试账号、业务数据、Storage 对象或旧 URL，不执行源端逻辑备份/恢复演练；阿里云源端保留到 Cloud TestFlight 验证和观察期完成后再评估下线。
- 当前 `.env` 只有客户端 URL 与 anon key；无需为路径 A 索取或记录源端数据库密码、AccessKey 或 service-role key。此前准备的 `migration-evidence/2026-08-31/manual/source-audit.sql` 仅保留为可选故障排查工具，结果不再阻塞后续阶段。

路径 B 如需数据迁移时，建议将证据放入不提交 Git 的加密目录，至少包含：

```text
migration-evidence/YYYY-MM-DD/
  source-inventory.md
  roles.sql.enc
  schema.sql.enc
  data.sql.enc
  migration-history.sql.enc
  storage-manifest.json.enc
  checksums.sha256
```

退出条件：本地 migration 基线已校验、路径 A 数据可丢弃边界已书面确认，且阿里云源端保留策略明确。

### 阶段 2：创建 Cloud 目标项目并完成安全基线

目标：得到一个从零重建的 Cloud 目标项目；路径 A 验证通过后可作为生产项目。

- [x] 创建 Cloud 目标项目，区域选择应以主要海外用户所在地的延迟实测为准。
- [x] 记录 project ref、区域、Postgres 版本和创建日期；secret 存密码管理器。
- [ ] Supabase 账户开启 MFA；限制项目管理成员。
- [x] 开启数据库 SSL enforcement；评估数据库 network restrictions。
- [x] 核对 Data API 暴露 schema，并确保每个客户端表/RPC 同时具备所需 grants 与 RLS；新 Cloud 项目不能假定 `public` 表自动暴露。
- [ ] 客户端仅使用 publishable key；服务端才可使用 secret/service-role key。
- [x] 配置允许的 Site URL 和 redirect URL，只加入实际需要的 `homebook` scheme/域名。
- [x] 开启邮箱密码与 Apple provider；保持手机号 provider 关闭。
- [ ] 暂不接入生产 Apple 私钥或生产邮件域名时，使用专门测试凭据。

阶段 2 执行记录（进行中，2026-09-01）：

- 已创建干净的 Supabase Cloud 目标项目：project ref `ygbfvzmomeobkgjzmzla`，区域为 Southeast Asia (Singapore) / `ap-southeast-1`。
- 创建时已保留 Data API，且未启用“Automatically expose new tables”或“Enable automatic RLS”；后续须通过版本化 migration 显式管理 grants、RLS 与 policy。
- 项目服务版本：Postgres `17.6.1.166`、PostgREST `14.5`、Auth `2.196.0`；创建日期为 `2026-09-01`。数据库密码仅由项目创建者保存在密码管理器，未进入仓库或本手册。
- 用户明确暂缓 Supabase 管理账户 MFA；该项不阻断路径 A 的技术迁移，但应在正式上线前重新评估并完成。
- 已开启 Database SSL enforcement，项目重启后为 Healthy。Network restrictions 已评估：目前不设置 IP 白名单，数据库仍允许所有 IP 连接；待本机/CI/受信服务端的固定出口 IP 明确后再收窄。
- 已核对 Data API 项目级设置：Data API 已启用，默认 exposed schemas 为 `public` 与 Supabase 内置的 `graphql_public`，自动暴露新表关闭；目标项目尚无可配置的业务表或函数。`graphql_public` 不是 HomeBook 业务 schema，无须移除。
- 已在 Cloud Authentication → URL Configuration 配置 Site URL 为 `homebook://`，并只允许 `homebook://**` 作为 Redirect URL；与 `app.json` 的 Expo scheme 一致。未保留 `localhost` 或宽泛 Web URL。Auth provider 和客户端密钥边界仍未配置或验证，因此其余阶段 2 项仍未完成。
- 已核对 Sign In / Providers：Email provider 已开启、Confirm email 已开启、Email OTP 有效期为 `3600` 秒且长度已由默认 `8` 调整为与客户端一致的 `6`；Phone provider 保持关闭，未配置 Twilio。Secure email change 保持开启，但当前客户端仅实现新邮箱的一次 OTP 校验，尚不能完成旧邮箱与新邮箱的双确认；在阶段 7 补齐该流程前不得将“换绑邮箱”视为验收通过。Secure password change 与 Require current password 保持关闭，避免在客户端尚未实现重新认证/旧密码输入时造成不可用。
- 已启用 Apple provider，Client ID 为原生 iOS Bundle ID `com.raochen.homebook-app`，OAuth secret 留空，且不允许无邮箱身份；Apple Developer provisioning profile 已确认包含 Sign in with Apple capability。已开启 Allow manual linking，以支持客户端现有 `linkIdentity` / `unlinkIdentity` 的 Apple 绑定与解绑。该配置仅覆盖原生 `signInWithIdToken`；首次/重复登录、隐藏邮箱、绑定、解绑和注销后的重新登录仍须在 Cloud 构建真机验证。
- 已从实际 `src` 调用扫描出 15 张客户端直连表和 17 个客户端 RPC，逐项核对 Cloud 的表级 grant、函数 EXECUTE 权限与 RLS 开启状态。发现 `family_hidden_categories` 有 RLS policy 但缺少 `authenticated` Data API grant；已新建并应用 `20260901045743_grant_family_hidden_categories_data_api_access.sql`，仅授予该角色所需的 SELECT/INSERT/UPDATE/DELETE，`anon` 继续无访问。17 个业务 RPC 均仅对 `authenticated` 可执行；其行级允许/拒绝行为仍须在阶段 3/8 的真实身份矩阵中验证。

Free 方案在 2026-08-30 的规划基线如下；执行当天仍需重新核对官方定价：

| 项目          | Free 基线                          | HomeBook 对策                                              |
| ------------- | ---------------------------------- | ---------------------------------------------------------- |
| 数据库        | 500 MB/项目                        | 每周记录数据库占用，达到 60% 开始评估 Pro                  |
| Storage       | 1 GB                               | 统计原图大小与月增长，达到 60% 预警                        |
| Egress        | 5 GB/月                            | 重点监控公开头像/背景和反馈图下载                          |
| MAU           | 50,000                             | 首版足够，按实际增长升级                                   |
| Edge Function | 500,000 次/月                      | 定时任务必须有调用量预算和幂等性                           |
| 日志保留      | 1 天                               | 关键错误需应用侧/外部监控留存                              |
| 低活跃项目    | 可能在 7 天低活跃后暂停            | 目标项目若有暂停风险，按上线前实际活跃度与业务需求评估 Pro |
| 备份          | Free 不提供可下载的 Dashboard 备份 | 自行维护加密逻辑备份；上线前必须验证恢复                   |

退出条件：Cloud 项目安全基线完成，且任何客户端包中都不存在高权限 secret。

### 阶段 3：在 Cloud 重建并校验数据库

目标：把仓库 migration 变成唯一可重复的业务 schema 来源。

#### 路径 A

- [x] 将 Cloud 目标项目 link 到本地 Supabase CLI。
- [x] 从空项目按文件名顺序执行全部 migration，不在 Dashboard 手工补 DDL。
- [x] 追加新的版本化 migration，创建/校准此前由阿里云 Studio 手工创建的 `homebook-user-avatars` 与 `homebook-family-covers` bucket；不得修改历史 migration。
- [x] 生成 Cloud 数据库类型并与 `src/lib/database.types.ts` 比较。
- [ ] 运行数据库 lint/advisor，并处理与 Cloud 托管角色、扩展、权限相关的差异。

#### 路径 B

- [ ] 先在可丢弃项目完整演练官方 CLI logical backup/restore 流程。
- [ ] 对 `auth`、`storage` 的版本差异单独审查，禁止未经演练直接覆盖 Cloud 管理 schema。
- [ ] 恢复时关闭触发器或按官方流程避免 `handle_new_user()` 重复创建 profile。
- [ ] 单独保存/恢复 migration history，并确认之后的 `db push` 不会重放历史 migration。
- [ ] 任何为 Cloud 兼容性所需的调整都追加新 migration，不回写旧文件。

两条路径都必须验证：

- [ ] 表、列、PK/FK、unique/check、索引数量与预期一致。
- [ ] 所有 SECURITY DEFINER 函数固定安全的 `search_path`，执行权限最小化。
- [ ] 所有暴露给客户端的表/视图/RPC 都有明确 RLS/grant。
- [ ] 至少用两个家庭、户主/成员/非成员三个身份做允许与拒绝矩阵。
- [ ] 系统分类种子幂等，不产生重复行。
- [ ] Realtime publication 只包含实际需要的表。

阶段 3 执行记录（进行中，2026-08-31）：

- 已通过 Supabase CLI 创建 `20260831124018_create_legacy_public_storage_buckets.sql`；它幂等创建/校准两个公开 bucket，复用既有 `storage.objects` policy，不修改任何历史 migration。
- 当前仓库目标 migration 总数为 47（历史基线 44 + Cloud Storage 兼容 migration + 安全修复 migration + Data API grant migration）。已完成静态审查与本地基线 44 个 migration 的 SHA-256 复核。
- `2026-09-01` 已成功 link 到 `ygbfvzmomeobkgjzmzla`；先以 `supabase db push --dry-run` 核对 45 条基线待应用，再执行 `supabase db push` 成功应用全部 45 条。之后分别预演并应用两条追加 migration；最终以只读 `supabase migration list --linked` 核对，本地与 Cloud 的 47 条 migration 编号完全一致。
- Cloud Advisor 与 `db lint` 发现：三个内部 `SECURITY DEFINER` trigger 函数被默认 `PUBLIC` 执行权限暴露，三个旧 trigger 函数未固定 `search_path`，且 `submit_feedback` 将 HTTP `429` 作为无效的 PostgreSQL SQLSTATE。已新建并成功应用 `20260901045243_harden_trigger_functions_and_feedback_rate_limit.sql`：撤销三个内部 trigger 函数的公共执行权限、固定三个 `search_path`，并将反馈限流异常码改为有效的 `P0001`。复核确认这些内部函数均不再对 `anon` 或 `authenticated` 可执行，`submit_feedback` lint 错误消失。
- 当前远端与本地已一致为 46 条 migration；远端结构只读核验结果为 22 张 `public` 表、全部开启 RLS、45 条 RLS policy，四个目标 Storage bucket 均存在且可见性符合目标。Advisor 仍提示 16 个供已登录用户调用的业务 `SECURITY DEFINER` RPC；它们须在后续两家庭、三身份的允许/拒绝矩阵中证明调用者身份校验与最小授权，故本阶段的完整 advisor/RLS 验证任务尚未勾选。`db lint` 仅余 `create_invitation` 的三个既有 warning，未再出现 error。
- 已从 linked Cloud 的 `public` schema 生成类型并替换 `src/lib/database.types.ts` 的手写定义；生成文件已按项目 Prettier 格式化，TypeScript `tsc --noEmit` 已通过。

退出条件：数据库可从仓库重建，RLS 越权用例全部被拒绝，业务 RPC 正常。

### 阶段 4：迁移和重配 Auth

目标：完成邮箱 + Apple 的生产级认证链路。

#### 邮箱密码与 SMTP

- [x] 选择支持海外投递的 SMTP 服务商及套餐：首版采用 Resend Free（截至 2026-09-01：3,000 封/月、100 封/日）；其费用独立于 Supabase。
- [x] 使用 `homebook-app.com` 的认证专用发件子域名，配置 SPF、DKIM；根域已有 DMARC 保持不变。
- [x] 在 Cloud Auth 配置自定义 SMTP，不使用默认 SMTP 发送生产邮件。
- [x] 自定义注册确认、找回密码、更换邮箱等模板；中英文内容与 App 文案一致。
- [ ] 测试 Gmail、Outlook、iCloud 等主要邮箱的收件、垃圾箱、链接/验证码有效性。
- [ ] 记录发信限额、退信处理和供应商故障时的应对方式。

阶段 4 邮件服务执行记录（进行中，2026-09-01）：

- 已选定 Resend Free 作为首版海外认证邮件 SMTP 服务商；尚未生成 SMTP 专用 API key 或写入 Cloud，故不视为 SMTP 已配置完成。
- 使用认证专用发件地址 `no-reply@auth.homebook-app.com`，将认证发信信誉与未来营销邮件隔离。
- `2026-09-01`：`auth.homebook-app.com` 在 Resend 东京区域的状态为 `Verified`；DKIM TXT 与两条发信 CNAME 均已验证，收信能力保持关闭。根域现有 SPF、DKIM 与 DMARC 未改动。
- `2026-09-01`：Cloud Auth 已启用自定义 SMTP，使用 `no-reply@auth.homebook-app.com` / `HomeBook`、`smtp.resend.com:465` 与 Resend 的域名受限发送权限凭据。凭据未记录到仓库或本运行手册。
- 模板兼容性审计：注册页面没有输入邮箱 OTP，故 Confirm sign up 保留 `{{ .ConfirmationURL }}`；找回密码客户端以 `verifyOtp(type=recovery)` 消费 6 位 OTP，故 Reset password 包含 `{{ .Token }}`；Cloud Secure email change 开启，Change email address 通过 `{{ .ConfirmationURL }}` 分别向旧、新邮箱确认，客户端不再消费 `email_change` OTP。
- `2026-09-01`：已保存“Confirm sign up”双语模板（`{{ .ConfirmationURL }}`）、“Reset password”双语模板（`{{ .Token }}`）及“Change email address”双语模板（`{{ .ConfirmationURL }}`）。模板与当前 App 流程匹配；端到端收件与链接有效性仍待阶段 8 真机/邮箱矩阵验证。

#### Apple ID

- [ ] 在 Apple Developer 与 Supabase Cloud 按官方 Apple Auth 指南配置 provider。
- [ ] 保持现有 Bundle ID `com.raochen.homebook-app` 和 App 身份不变。
- [ ] 将 Apple 私钥、Key ID、Team ID 等存入安全位置，不提交仓库。
- [ ] 记录 Apple client secret/密钥的轮换或到期日期，并设置提前提醒。
- [ ] 真机验证首次登录、重复登录、隐藏邮箱、绑定、解绑和账号注销后重新登录。

#### 手机号与密码锁定

- [ ] Cloud 关闭 phone provider；App 登录页和账号管理页不再暴露手机号入口。
- [ ] 移除依赖“原手机号 OTP”的二次验证分支，设计并实现邮箱/原密码/Apple 可用的替代流程。
- [ ] 路径 B：关闭短信前确认所有真实用户至少有邮箱或 Apple identity。
- [ ] `password_verification_attempt` migration 可以暂时保留为未启用兼容代码，但 UI、PRD 和客服口径不得声称 5 次锁定已生效。
- [ ] 若未来必须恢复精确的“五次锁定 24 小时”，将升级 Team 作为前置条件，再启用 Password Verification Attempt Hook 并回归。

#### 专项阻断：账号注销

现有 [`20260703120024_delete_account_rpc.sql`](../supabase/migrations/20260703120024_delete_account_rpc.sql) 直接修改 Cloud 托管的 `auth.identities`、`auth.sessions` 和 `auth.users`。必须：

- [ ] 在 Cloud 目标项目验证函数能否创建、授权和执行。
- [ ] 验证身份凭据被释放、既有 session 失效、匿名化 `profiles` 墓碑及历史账务引用仍符合 PRD。
- [ ] 若 Cloud 拒绝直接操作管理表，改为受信 Edge Function 调用 Auth Admin API，并用新 migration 收窄/替代原 RPC。
- [ ] 同一邮箱与 Apple 身份在注销后重新登录应成为全新账号，且不得恢复旧家庭数据。

退出条件：邮箱、Apple、身份绑定/解绑、找回/更换和注销真机回归全部通过。

### 阶段 5：重建 Storage 并验证目标配置

目标：由可重放 migration 建立四个 bucket 和策略；路径 A 不复制源端测试对象或重写旧 URL。

- [ ] 由 migration 创建/校准 bucket 与 policy，不在 Dashboard 留下无法复现的手工状态。
- [ ] 验证三个 public bucket 可读但不可越权写；私有反馈图只能由授权用户/运营服务端读取。
- [ ] 在目标项目新建测试账号和测试图片，完成 App 上传、覆盖、读取、删除、反馈图片提交与运营读取回归。
- [ ] 验证路径 A 新产生的业务记录不保存阿里云 Storage host；此项目无须执行源端 URL 重写。

路径 B 才额外执行：对象分页复制、路径/元数据保留、对象数/字节/内容哈希核对、旧 URL 搜索与精确前缀重写。

退出条件：四个 bucket 可由 migration 重建，目标测试对象的权限和完整读写链路均通过。

### 阶段 6：邮件、短信与计算任务迁移

目标：明确哪些阿里云服务立即退出，哪些分阶段退出。

| 现有服务                 | 首版处理                               | 目标状态                                                |
| ------------------------ | -------------------------------------- | ------------------------------------------------------- |
| `services/email-hook-fc` | 不再进入生产 Auth 主链路               | Cloud Auth 自定义 SMTP；确认稳定后停用 FC               |
| `services/sms-hook-fc`   | 首版不迁移、不启用                     | 保留代码归档，移除触发器与 secret；未来国际短信另行立项 |
| `services/push-fc`       | 可短期继续读取 Cloud，降低一次切换变量 | 行为等价迁到 Edge Function + Cron 后停用 FC             |

推送迁移推荐采用两步法：

1. **Cloud 核心切换期**：若现有 FC 已稳定，可仅在路径 A 验证通过后替换其 Supabase URL 与服务端 key，并完整回归；这只是过渡，不把 key 放客户端。
2. **Cloud 稳定后**：将 Node/FC 逻辑按 Edge Runtime 能力重写到 `supabase/functions/`，由 Supabase Cron 调用，再做并行影子验证和切换。

若保留 FC 过渡，先把运行时升级到 Node 22，并验证当前 Supabase JS/依赖锁文件；Node 20 已不再是新版本 Supabase JS 的支持目标。

Edge Function + Cron 验收：

- [ ] 函数只读取待投递通知，遵守 `notification_preferences`。
- [ ] 具有幂等键/原子领取机制，两个 worker 并发也不会重复推送。
- [ ] Expo 接收成功后才更新 `pushed_at`；临时错误继续指数退避。
- [ ] `DeviceNotRegistered` 等失效 token 会清理，单个坏 token 不阻塞批次。
- [ ] Cron 频率以 PRD 和调用预算为准；记录每日理论调用量和 Free 额度占比。
- [ ] 在 24 小时影子期比较 FC 与新函数的待处理数、成功数、重试数，但影子函数不得真正重复发送。
- [ ] Cloud secrets 中保存 Expo/服务端凭据；日志不得输出 token、JWT、邮件或财务数据。
- [ ] 切换后删除旧 FC 定时触发器，再观察至少 24 小时调用量。

退出条件：认证邮件不依赖邮件 FC，短信不在首版链路，推送仅有一个有效生产投递者。

### 阶段 7：客户端、文档与 EAS 配置改造

目标：让 App 的真实功能和 Cloud 配置一致。

- [x] 登录页保留邮箱和 Apple，移除/隐藏手机号 OTP 标签、页面和错误文案。
  - [x] 已按 Supabase Auth 错误码区分“邮箱未确认”；不得将其回退为注册，也不得把防枚举伪用户提示为注册成功。
- [ ] 账号安全页移除手机号管理入口，重新实现“至少一种登录方式”和敏感操作验证。
  - [x] 已移除手机号管理入口与 `/account/phone` 页面；换绑邮箱改用 Cloud 的旧/新邮箱确认链接，并在回到页面时刷新会话。
  - [ ] 仍需补齐“至少一种登录方式”与敏感操作的近期重新认证。
- [ ] 检查通知、反馈、协议/隐私文案中对手机号、阿里云、数据区域的描述。
- [ ] 更新 `docs/PRD.md`、`docs/TECH.md`、`docs/DATAMODEL.md`、发布和测试文档，使其描述真实实现。
- [ ] 从目标 Cloud 重新生成 `src/lib/database.types.ts`。
- [ ] 保持 `src/lib/supabase.ts` 的环境变量边界；`EXPO_PUBLIC_SUPABASE_KEY` 可继续作为变量名，但值只能是目标项目 publishable key。
- [x] EAS preview 与 production 均显式绑定到目标 Cloud 的 `production` 环境；当前没有独立 preview 后端。
- [ ] 不把 secret/service-role key、SMTP 密码或 Apple 私钥写入任何 `EXPO_PUBLIC_*`。
- [ ] 保持 Bundle ID、scheme、EAS project ID 和 App Store Connect App 不变。
- [ ] 为旧项目 JWT/session 切换提供一次明确的重新登录体验；不得让旧缓存 session 造成循环或墓碑用户页面。

生产变量目标：

```text
EXPO_PUBLIC_SUPABASE_URL=https://<production-project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_KEY=<production-publishable-key>
```

> 这两个值会被打入二进制。更换后端 URL/key 需要新的 EAS/TestFlight/App Store 构建，不能依赖 OTA 更新。

退出条件：静态检查与本地功能回归通过，preview/production 环境不会串项目。

### 阶段 8：完整验证与 TestFlight

#### 自动检查

- [ ] Prettier、ESLint、TypeScript、相关单元/集成测试通过。
- [ ] `supabase db lint` 或 Cloud database advisor 无未解释的高风险项。
- [ ] 新 migration 在空数据库完整重放通过。
- [ ] RLS 自动化用例覆盖户主、家庭成员、非成员、匿名用户和 service role。

#### Auth 真机矩阵

- [ ] 邮箱注册/确认、登录、错误密码、退出、重新登录。
  - [x] `2026-09-02`：iOS 模拟器已用可收信邮箱完成“首次登录自动注册 → 收到 Resend 确认邮件 → 点击确认 → 使用相同邮箱密码登录进入应用”。桌面浏览器无法将 `homebook://` 交给模拟器而显示空白页，但确认后的登录成功已证明服务端确认完成。
- [ ] 找回密码、修改密码、更换邮箱。
- [ ] Apple 首次/重复登录、隐藏邮箱、绑定/解绑。
- [ ] 删除账号、旧 session 失效、同身份重新注册。
- [ ] 网络中断、邮件延迟、重复点击、验证码/链接过期。

#### 业务与数据矩阵

- [ ] 新建/加入/退出/转让/解散家庭及五人上限。
- [ ] 流水、分类、预算、储蓄目标、周期账单和报表。
- [ ] 头像、家庭头像/背景、反馈图片上传/读/删。
- [ ] 通知生成、偏好、推送、重试、失效 token 清理。
- [ ] 弱网、离线、冷启动、后台恢复和 session 刷新。

#### TestFlight 与发布

- [ ] 用 EAS `production` profile 生成新的 iOS 二进制并上传 TestFlight。
- [ ] 在构建日志/运行时诊断中证明该二进制连接 Cloud，而不是旧域名。
- [ ] 内部 TestFlight 至少完成一轮真机全流程；必要时再做外部 Beta Review。
- [ ] App Store Connect 只选择目标海外地区，不选择中国大陆。
- [ ] 更新 App Privacy、隐私政策和支持页中的处理方、数据区域与联系信息。
- [ ] 保持同一 App 记录和 Bundle ID；迁移不要求新建 App。

退出条件：测试报告签字，所有 No-Go 项清零，已有回滚包/回滚构建步骤。

### 阶段 9：生产切换

#### 路径 A：无真实生产数据

1. 在同一 Cloud 目标项目再次从空 schema 复核最终 migration，或在确认已有验证通过后将其作为生产项目；应用已验证的 Auth/SMTP/Apple/Storage/Function 配置。
2. 用该目标项目重新跑完整冒烟测试。
3. 设置 EAS production Cloud 变量并构建最终 TestFlight/App Store 包。
4. 发布海外 storefront；旧后端只保留作短期技术回退，不再接收新用户。路径 A 没有待合并的源端生产写入。

#### 路径 B：有真实生产数据

1. 提前公告维护窗口，停止新注册和业务写入。
2. 生成源端最终加密备份、Storage manifest 和校验值。
3. 按已演练流程恢复 Auth 与业务数据；复制最终新增/变更对象。
4. 执行行数、主键集合、关键金额汇总、对象数/字节/哈希核对。
5. 重写并复核旧 Storage URL。
6. 运行 Auth、RLS、家庭、账务、Storage、推送和注销冒烟测试。
7. 确认 only-phone 用户已完成登录方式过渡。
8. Go/No-Go 通过后启用 Cloud 写入，并保持旧库只读。
9. 发布已验证的新二进制；所有用户重新登录。

切换记录：

| 字段                   | 记录 |
| ---------------------- | ---- |
| 维护窗口               |      |
| 源端最后写入时间       |      |
| 最终备份 SHA-256       |      |
| 目标行数核对结果       |      |
| Storage 核对结果       |      |
| TestFlight build       |      |
| Go/No-Go 决策人        |      |
| Cloud 开始接收写入时间 |      |

退出条件：Cloud 成为唯一生产写入端，新发布包稳定，旧端保持只读。

### 阶段 10：观察、回滚与升级门槛

#### 观察期

切换后至少观察 14 天；旧后端建议保留 30 天再评估下线。

每日监控：

- Auth 登录成功率、SMTP 退信/延迟、Apple 错误。
- API 4xx/5xx、慢 SQL、连接数、数据库和 Storage 用量。
- Edge/Cron 调用数、失败数、执行时长和重试队列。
- Expo Push 成功/错误、重复推送、失效 token 数。
- 客服反馈中的无法登录、图片丢失、家庭数据越权或缺失。

#### 回滚边界

- 路径 A 的 Cloud 尚未对外发布：可丢弃并重建 Cloud 目标项目，或继续使用旧后端测试环境。
- Cloud 尚未接收生产写入：可停止切换并继续使用旧后端。
- Cloud 已接收生产写入：不得直接把用户切回旧库，否则会丢失新写入；必须先做反向数据合并或进入维护窗口。
- 因 URL/key 已打入二进制，已分发的 Cloud 版本无法靠简单 OTA 改回旧后端；需要新的 EAS/TestFlight/App Store 二进制。
- 旧后端恢复生产前，必须验证 schema 兼容、数据完整、Auth 与 Storage 引用一致。

#### 从 Free 升级

出现任一情况即评估升级：

- 数据库、Storage、egress 或 Edge 调用达到 Free 配额 60%，或增长预测一个月内会超限。
- 生产项目有因低活跃暂停的不可接受风险。
- 需要更长日志、平台备份、支持或更高可用保障。
- 需要稳定的生产容量与恢复目标：优先 Pro。
- “五次密码错误锁定 24 小时”重新成为硬需求：必须评估 Team，因为该 Password Verification Attempt Hook 不属于 Free/Pro。

退出条件：观察期无重大回归，升级判断有数据依据，回滚需求解除。

### 阶段 11：旧资源下线

仅在观察期结束且负责人批准后执行；路径 B 还须完成最终备份验证：

- [ ] 停止并删除阿里云短信、邮件、推送 FC 的触发器；确认无残余调用。
- [ ] 撤销旧 service-role、SMTP、短信、Apple/Hook 等凭据。
- [ ] 路径 A：确认无真实用户或需保留数据后，将旧 Supabase 设为只读并按保留政策下线实例；路径 B：生成最终归档后再下线。
- [ ] 路径 A：保留 migration 校验值、迁移日志和恢复说明；路径 B：额外保留加密备份、Storage manifest 与校验值。
- [ ] 清理 EAS、CI、密码管理器中的旧 URL/key，但保留审计记录。
- [ ] 更新 `docs/SUPABASE_PROVISIONING.md`：标记为阿里云历史恢复文档或替换为 Cloud provisioning 文档。
- [ ] 完成 PRD、TECH、DATAMODEL、测试、发布及隐私文档的最终一致性检查。

## 7. 推荐执行批次

为了降低一次性变更风险，建议按以下批次实施：

| 批次 | 内容                                                                        | 是否改变生产 |
| ---- | --------------------------------------------------------------------------- | ------------ |
| 1    | 路径 A：本地 migration 基线与数据可丢弃确认；路径 B：源端审计、备份恢复演练 | 否           |
| 2    | Cloud 目标项目、migration/RLS/Storage/Auth 兼容性                           | 否           |
| 3    | PRD/TECH 更新、客户端移除手机号、邮箱 + Apple 完整化                        | 否           |
| 4    | 推送 FC 临时对接 Cloud，或 Edge + Cron 等价实现                             | 否           |
| 5    | Cloud production、TestFlight 全回归                                         | 仅测试       |
| 6    | 最终数据切换与海外 App Store 发布                                           | 是           |
| 7    | 14 天观察、30 天后评估旧资源下线                                            | 是           |

每个批次单独提交、单独验收；不要把数据库兼容修复、登录产品改造、推送重写和生产切换混成一个不可回滚的大提交。

## 8. 执行证据模板

每完成一个阶段复制一份：

```markdown
### 阶段 N 执行记录

- 日期：
- 执行人：
- 源 Git commit：
- 目标 Cloud project ref：
- 使用路径：A / B
- 本阶段改动：
- 执行命令/控制台设置记录：
- 验证结果：
- 证据文件或截图：
- 遗留风险：
- 回滚验证：
- 结论：Go / No-Go
```

## 9. 官方参考

执行时优先以官方文档的当前版本为准：

- [Supabase：项目间迁移概览](https://supabase.com/docs/guides/platform/migrating-within-supabase)
- [Supabase：CLI 备份与恢复](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase：Auth 用户迁移注意事项](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
- [Supabase：Storage 对象迁移](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore#migrating-storage-objects)
- [Supabase：数据库 migration 工作流](https://supabase.com/docs/guides/deployment/database-migrations)
- [Supabase：Apple 登录](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Supabase：自定义 SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
- [Supabase：Auth Hooks 与套餐](https://supabase.com/docs/guides/auth/auth-hooks)
- [Supabase：Edge Functions 定价](https://supabase.com/docs/guides/functions/pricing)
- [Supabase：Edge Functions 限制](https://supabase.com/docs/guides/functions/limits)
- [Supabase：Cron](https://supabase.com/docs/guides/cron)
- [Supabase：生产检查清单](https://supabase.com/docs/guides/deployment/going-into-prod)
- [Supabase：计费说明](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Expo：EAS 环境变量](https://docs.expo.dev/eas/environment-variables/manage/)
- [Apple：TestFlight 概览](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview)

> 套餐额度、功能归属和控制台入口会变化。凡涉及费用、Auth Hook 套餐、Free 配额和 Apple 配置的步骤，执行当天必须重新查阅官方文档并将核对日期写入执行记录。
