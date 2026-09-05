# 家账 · 技术选型与开发方案（TECH）

> 文档版本：v0.2.4（**海外首版后端迁移**：目标切换为 Supabase Cloud Free，认证为邮箱密码 + Apple，手机号 OTP 暂停；推送 FC 分阶段迁往 Edge Functions + Cron）
> 最后更新：2026-08-31
> 关联文档：PRD.md（§23；流程 3/4、§3.5）、DESIGN.md（§5.6）、IA.md、MVP.md、DATAMODEL.md（§3.2、§5.1）、AGENTS.md（AI 编码业务铁律，根目录）
> 负责人：产品组 / 研发
> 用途：作为「家账」客户端与后端技术实现的单一事实来源（Single Source of Truth），记录技术选型、后端架构、开发环境、调试流程、里程碑排期与上架盈利路径。后续可基于本文档持续补充。

---

## 1. 技术决策背景

- **目标平台**：iOS（iOS 26+），后续可扩展 Android。
- **用户与区域**：首版仅面向海外用户；App Store 不选择中国大陆 storefront，不再把中国大陆网络可达性作为产品目标。
- **核心约束**：离线优先记账、家庭多端协作、数据归家防串账（见 PRD §2.3、DATAMODEL §6）、海外数据处理披露与可恢复性（见 §7.6）。
- **团队背景**：个人开发者，前端 React + TypeScript 为主，会用 Node/TS 写服务端逻辑，以 Cursor 为主要编程工具，重度依赖 AI 辅助（规则见根目录 AGENTS.md）。
- **关键取舍**：
  - 客户端选 RN 换取**最大化复用 React/TS 技能 + 跨平台潜力 + JS 层 OTA 热更新**；视觉走 **native-first**（`@expo/ui/swift-ui` 原生件）。
  - 后端选 **Supabase Cloud（Postgres + RLS + RPC + Auth + Storage + Edge Functions）**，保留既有数据模型与安全边界，并获得 Apple Auth、托管计算与 Cron 能力（见 §7）。

> 结论：客户端 **React Native（Expo）+ TypeScript**；后端 **Supabase Cloud + 第三方生产 SMTP + Expo Push/APNs**。阿里云自托管 Supabase 仅作为迁移源端与短期回退资源。

---

## 2. 技术选型总览

| 层              | 选型                                                           | 说明                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 框架            | **Expo（React Native）+ TypeScript**                           | 对 React + TS 背景最友好，工具链成熟                                                                                                                                                                              |
| 路由 / 导航     | **expo-router** + **NativeTabs**（`unstable-native-tabs`）     | 文件式路由；原生 Tab Bar，对齐 IA §2 / DESIGN §5.2：iOS 26 标准四 Tab（首页 / 报表 / 家庭 / 我的）+「➕ 记一笔」悬浮圆钮（Tab Bar 右上方，全 Tab 常驻）+ 顶栏右上搜索图标（系统 chrome 顺应 iOS 26 Liquid Glass） |
| 状态管理        | **Zustand**（本地 UI 态）+ **TanStack Query**（服务端态/缓存） | 轻量，契合中小型应用                                                                                                                                                                                              |
| 本地存储 / 离线 | **WatermelonDB**（本地 DB + 自建同步）                         | 离线优先：本地 DB + 同步队列，经 Supabase RPC 同步（见 §6）                                                                                                                                                       |
| 网络            | **fetch + TanStack Query** + **Supabase JS SDK**               | 客户端用 publishable key 直连 Supabase Cloud，API 暴露与行级权限分别由 Data API grants 和 RLS 控制                                                                                                                |
| 二维码          | 扫码 **expo-camera**；生成 **react-native-qrcode-svg**         | 流程 3 / 4                                                                                                                                                                                                        |
| 动画 / 手势     | **react-native-reanimated** + **react-native-gesture-handler** | 滑动确认控件、庆祝动效                                                                                                                                                                                            |
| 图表            | **react-native-svg 自绘**（见 §3）                             | 报表环形 / 条形 / 折线 / 双柱 / 瀑布 / 热力图，全部手绘覆盖                                                                                                                                                       |
| 安全存储        | **expo-secure-store**                                          | Token / 登录态                                                                                                                                                                                                    |
| 推送            | **Expo Push → APNs**                                           | 第一版仅保障 iOS；迁移期可短暂保留 FC，目标为 Edge Function + Cron（见 §7.5）                                                                                                                                     |
| 界面语言        | **expo-localization + i18next + react-i18next**                | 简体中文 / English；本机偏好对齐深色模式；缺 key 回落中文。`expo-localization` plugin 需新二进制                                                                                                                  |
| OTA 热更新      | **EAS Update（expo-updates）**                                 | JS 层 bug 免审核直推                                                                                                                                                                                              |
| 后端基座        | **Supabase Cloud Free**                                        | Postgres + Auth + Data API + Realtime + Storage + Edge Functions + Cron；达到容量、备份、日志或可用性门槛后升级 Pro/Team（见 §7）                                                                                 |
| 外部服务        | **自定义 SMTP + Expo Push/APNs**                               | 认证邮件费用由 SMTP 服务商承担；首版不接短信；现有 FC 仅作迁移过渡                                                                                                                                                |

> 备注：内容层不主动施加 `glassEffect`（保持实心，保金额清晰）；系统 chrome（导航 / Tab / 原生 Sheet）顺应 iOS 26 系统材质（含 Liquid Glass），由 NativeTabs / 原生件自动获得（见 DESIGN.md §3）。NativeTabs 为 alpha/unstable API，上线前需 spike 验证（见 DESIGN §5.2）。

---

## 3. 报表图表方案

报表需求见 PRD §11.5、DESIGN §5.7 / 附录 A.5：环形、横向条形、折线、面积、双柱（双轴）、结余瀑布、记账热力图，且当前未结束周期须有「进行中」斜纹语义。设计稿远超标准单序列图表，需要逐像素可控的自绘能力。

**决策（2026-07-20 定稿）**：报表图表统一用 **`react-native-svg` 手绘**，不引入任何新原生图表库。`react-native-svg` 已因二维码（`react-native-qrcode-svg`）在依赖里，**零新增原生模块、零额外 Dev Build 触发**，且能 100% 还原设计稿的所有样式与交互。

被评估但放弃的方案：

| 方案                               | 渲染        | 为何不选 / 选用                                                                                      |
| ---------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| **react-native-svg 自绘（选用）**  | SVG         | 已装（qrcode 依赖）、零新原生模块、逐像素可控，双轴 / 堆叠 / 瀑布 / 热力 / 斜纹预计柱全能画          |
| Victory Native (XL, v40+)          | Skia（GPU） | 需引入 Skia 原生模块 → 又一次 Dev Build 重编（本项目刻意规避）；瀑布 / 热力仍要自拼，收益不抵成本    |
| react-native-gifted-charts         | SVG         | 覆盖标准柱 / 线 / 饼，但瀑布 / 热力 / 双轴 / 斜纹 / 自定义标注仍得落回 svg，多养一个依赖只换部分覆盖 |
| `@expo/ui` `Chart`（Swift Charts） | 原生        | SDK 56 已内置，但仅单序列、无分组 / 堆叠 / 双轴 / 瀑布 / 热力 / 扇区回调，表达不了报表设计           |

**落地现状**：环形图（`donut.tsx`：`Circle`+`strokeDasharray`、点按扇区取值）、收支双柱 + 结余折线、结余瀑布、斜纹「进行中」预计柱（`Defs`+`Pattern`）、记账热力图、储蓄率面积趋势均已用 `react-native-svg` 落地（见 `src/features/report/`、`src/app/(tabs)/report.tsx`）。手势 / 动效复用已装的 `react-native-reanimated` + `react-native-gesture-handler`，不新增依赖。原「待解分歧」（TECH §3 Victory/Skia ↔ DESIGN 自绘）**至此对齐关闭**。

> 口径提醒：储蓄类流水（`source != normal`）计入收支/结余，但**不进**分类占比与消费趋势图（见 PRD §11.6、DATAMODEL §3.4）。

**统计数据访问（2026-09-05）**：报表、月度总结、预算和家庭活跃度不从客户端最近流水缓存累计。服务端 RPC 依据当前认证用户的家庭、家庭时区及完整目标范围完成聚合，仅返回数值、分桶、分组与展示需要的 Top N；流水详情、分类下钻、搜索结果使用 `(occurred_at, id)` 复合游标分页。这样统计全集不受页面大小影响，同时避免把大批原始流水传输、保存在 JS 内存或在渲染期反复遍历。索引按真实查询的 `EXPLAIN ANALYZE` 与 Query Performance / Index Advisor 证据演进；不为猜测的筛选条件预先堆叠索引，避免增加记账写入成本。

---

## 4. 开发工具链（macOS / Apple Silicon · Cursor）

设备：MacBook Pro M4，编程以 Cursor 为主。以下工具 M 系列芯片均原生支持。

### 4.1 命令行工具（按顺序安装）

```bash
# 1. Homebrew（若未安装）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Node（建议用 nvm 管理，装 Node 22 LTS）
brew install nvm
nvm install 22 && nvm use 22

# 3. Watchman（文件监听，RN 必备）
brew install watchman

# 4. CocoaPods（iOS 原生依赖管理）
brew install cocoapods

# 5. EAS CLI（云构建 / OTA / 提交商店）
npm install -g eas-cli

# 6. Supabase CLI（迁移 / 本地栈 / 类型生成 / Edge Functions）
brew install supabase/tap/supabase

# 7. Git（确认存在）
git --version
```

### 4.2 图形界面 / 账号

| 工具                           | 说明                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Xcode 26**（Mac App Store）  | 约 12GB+；装完打开一次接受协议，再执行 `xcode-select --install` 与 `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`；在 Xcode 内下载 **iOS 26 模拟器** |
| **Cursor**                     | 已在用。建议扩展：ESLint、Prettier；接 Supabase MCP（仅连开发库，生产加 `?read_only=true`）；装 supabase / postgres-best-practices agent-skills                               |
| **Supabase + SMTP 服务商账号** | Cloud 项目、Auth、Storage、Edge/Cron 与生产认证邮件；两者均启用 MFA，凭据存密码管理器，不写入仓库                                                                             |
| **Apple Developer Program**    | 99 美元/年。**仅在需要真机调试或上架时购买**，模拟器阶段无需                                                                                                                  |
| Android Studio / JDK           | **iOS-only 阶段无需安装**，未来做 Android 再装                                                                                                                                |

> Expo CLI 无需全局安装：项目内 `npx expo` 自动使用项目版本。

---

## 5. 调试流程

```
① 创建项目
   npx create-expo-app@latest jiazhang
   cd jiazhang

② 安装开发客户端（使用相机等原生模块需要）
   npx expo install expo-dev-client

③ 首次构建 Dev Build（二选一）
   本地（免费，用本机 Xcode）：  npx expo run:ios
   云端（不依赖本地环境）：      eas build --profile development --platform ios

④ 日常开发循环（与写 React 网页体验基本一致）
   npx expo start --dev-client
   - 改 .tsx 代码 → Fast Refresh 自动热刷新
   - 终端按 J → React Native DevTools（Console / Network / Components / Profiler）
   - 终端按 M → Developer Menu（reload 等）
   - 仅当「新增 / 改动原生模块」时才需重跑第 ③ 步

⑤ 真机测试
   连接 iPhone（iOS 26）→ npx expo run:ios --device（需 Apple 账号签名）

⑥ 发版
   eas build --profile production --platform ios   # 正式包
   eas submit -p ios                               # 提交 App Store
   eas update                                       # 后续 JS 层 OTA 热修复（免审核）
```

调试体验小结：**首次编译一次原生壳，之后日常改 TS 代码热刷新 + RN DevTools，和写 React 网页几乎无差别。**

---

## 6. 离线优先与同步架构（核心难点）

对应 PRD §2.3、§4.6、§12.5 与 DATAMODEL §6。

1. **本地为唯一数据源**：所有读取走本地 DB（WatermelonDB），UI 先读本地、立即响应。
2. **流水创建即绑定 `family_id`**：本地写入时即写死当前家庭 `family_id`，不可变（防串账核心）。
3. **同步队列**：每条本地写操作（增 / 改 / 删）标记 `sync_status = pending` 入队，联网后按**原 `family_id`** 提交；即便用户期间已退出该家庭，服务端仍按原 `family_id` 入账。
4. **冲突处理**：
   - **普通流水** → 行级 **LWW（按 UTC `updated_at` 取最后修改为准）**；比较的是 `updated_at`（编辑动作时间）而非 `occurred_at`（消费发生时间），排序时间戳优先由服务端入库时盖，降低客户端时钟漂移影响。
   - **删除** → 以软删除字段（`is_deleted`）表达，使其能被 LWW 正常排序，不真删行。
   - **储蓄目标** → `version` 乐观锁（DATAMODEL §4.1），冲突则刷新重试。
5. **同步范围边界**：离线 LWW 队列**只覆盖普通流水（增/改/删）与分类**；以下操作**必须在线**，不进队列：户主转让/移除成员/解散/加入家庭（带不变式）、储蓄存入/取出（带「取出 ≤ 已存」约束 + 乐观锁）。
6. **同步引擎选型**：用 **WatermelonDB + 自建同步**（两个 Postgres 函数做 pull/push，经 Supabase RPC），配合 Realtime 触发即时同步。
   - 当前不引入 PowerSync；先复用现有 RPC 与同步规划，避免在后端迁移时同时替换同步引擎。
7. **储蓄累计值不可 LWW**：`SAVINGS_GOAL.saved_amount` 是派生值（存入合计 − 取出合计），同步**储蓄事件**（`SAVINGS_ENTRY`）后由服务端重算，禁止把累计值当字段直接 LWW（否则并发存入丢钱）。
8. **同步态 UI**：离线用 `state/info` 轻提示「已保存，稍后同步」（DESIGN §5.8）。
9. **金额精度**：全程以「分」（bigint）传输，仅展示层做分↔元换算（DATAMODEL §1.2）。

---

## 7. 后端架构（Supabase Cloud · 海外首版）

### 7.0 决策背景

- **市场范围**：只服务海外用户，不要求中国大陆无 VPN 可达。
- **迁移路径**：当前无真实用户，选择 `SUPABASE_CLOUD_MIGRATION_RUNBOOK.md` 的路径 A；从 Cloud 空项目重放 migration，不迁移测试账号、测试业务数据和测试图片。
- **套餐基线**：先使用 Free。Free 的容量、日志、备份与低活跃暂停风险必须监控，不能把免费套餐视为生产 SLA。
- **兼容原则**：数据库业务结构仍以标准 Postgres + RLS + RPC 为核心；Cloud 管理的 `auth`、`storage`、`realtime` schema 不得按自托管方式盲目覆盖。

### 7.1 目标部署

- **测试项目**：可丢弃的 Cloud 项目，用于 migration、Auth、Storage、RLS、账号注销和 Edge/Cron 演练。
- **生产项目**：测试项目所有步骤可重复后再创建/配置；只接受正式 EAS production 二进制。
- **客户端凭据**：只使用 publishable key（旧 anon key 仅兼容）；`secret` / `service_role` 只进入受信服务端 Secret。
- **连接地址**：App 使用 Supabase 默认 HTTPS URL；不购买 Cloud 自定义域名或证书。`homebook-app.com` 继续承载隐私政策、支持页和 SMTP 域名验证。
- **发布身份**：保留 Bundle ID `com.raochen.homebook-app`、scheme `homebook`、现有 EAS project ID 和 App Store Connect App。

### 7.2 能力映射

| 能力        | 首版实现                                       | 迁移说明                                                             |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------- |
| 数据库      | Supabase Cloud Postgres                        | 45 个版本化 migration（含 Cloud Storage 兼容 migration）从空项目重放 |
| 鉴权        | Supabase Auth：邮箱密码 + Apple                | 生产邮件走自定义 SMTP；phone provider 关闭                           |
| 行级安全    | RLS + grants                                   | Data API 暴露与 RLS 分别验收，不能只验证其中一个                     |
| 服务端逻辑  | Postgres RPC + Edge Functions                  | 事务不变式留在 RPC；外部网络调用放 Edge Function                     |
| 定时任务    | Supabase Cron → Edge Function                  | 推送投递从 FC 分阶段迁移                                             |
| 实时        | Supabase Realtime                              | 只为实际订阅表启用 publication                                       |
| 对象存储    | Supabase Storage                               | 三个公开媒体桶 + 一个私有反馈桶                                      |
| 认证邮件    | 第三方 SMTP                                    | 发信费用、额度与投递由 SMTP 服务商承担                               |
| 短信验证码  | 首版不提供                                     | 阿里云 SMS Hook/FC 不进入生产链路                                    |
| 推送        | `notifications` + Expo Push → APNs             | App 内通知始终兜底；系统推送可关闭                                   |
| 备份 / 恢复 | 自维护加密逻辑备份；达到恢复目标要求后升级套餐 | Free 不依赖 Dashboard 可下载备份                                     |
| 日志 / 监控 | Cloud 日志 + 客户端/外部错误监控               | Free 日志保留短，关键错误需另行留存                                  |

### 7.3 鉴权与认证邮件

- **用户模型**：`auth.users` 托管邮箱、Apple identity、密码与 session；`public.profiles` 只存业务资料，不冗余登录凭据。新用户由 `handle_new_user()` 创建 profile。
- **邮箱密码**：登录页保持“登录即注册、无独立注册页”，但 Cloud 生产项目必须完成邮箱确认；找回密码、换绑和确认邮件均走自定义 SMTP。
- **Apple**：iOS 原生 `identityToken` → `signInWithIdToken`；账号绑定使用 manual linking。Apple provider、Bundle ID 与密钥轮换必须在 Cloud 测试项目真机验证。
- **手机号**：首版关闭 Cloud phone provider，并在客户端移除手机号登录/管理入口。`services/sms-hook-fc` 与现有手机号代码在迁移完成前保留历史参考，但不得进入 production 路径。
- **密码防爆破**：`…0036_password_login_lockout.sql` 的函数/表可暂时保留为未启用兼容代码。Free/Pro 无法启用 Password Verification Attempt Hook，因此首版只使用 Cloud 基础限流与风控，不声称精确“五次锁定 24 小时”已生效；恢复该规则前先升级 Team 并回归。
- **敏感操作**：换绑邮箱、解绑 Apple、改密、注销前要求近期重新认证；邮箱使用当前密码或邮箱 OTP，仅 Apple 账号重新完成 Apple 授权。认证新鲜度必须由服务端验证。
- **风控**：认证邮件遵守 Cloud rate limit 与 SMTP 供应商额度；邀请码仍为 6 位大写字母数字、24h 有效，`preview_family_by_code` 必须限频防枚举。
- **密钥边界**：客户端只持 publishable key；secret/service-role key 绝不进入客户端、仓库、日志或 `EXPO_PUBLIC_*`。

### 7.4 服务端必须强制的约束

与 AGENTS.md §4/§5 与 DATAMODEL §6 一致，**在数据库层用 RLS + 唯一约束 + RPC 事务真正强制**（规则文件管「AI 别写错」，DB 约束管「写错也拦得住」）：

- 一人一家、户主唯一、成员上限 5、储蓄目标 ≤5、继任异议期单条 pending（唯一约束/部分索引）。
- `TRANSACTION.family_id` 创建后不可变（规则/触发器拒绝 UPDATE）。
- 储蓄存取、户主转让、解散、加入家庭、删除目标余额回吐 → **单事务 RPC**（见 AGENTS.md §7）。
- 每条 RLS / RPC 配 pgTAP 测试。
- 新 Cloud 项目可能不会自动把 `public` 表暴露给 Data API；必须同时核对 Data API schema 设置、`anon`/`authenticated` grants 与 RLS。RLS 正确不代表 API 已授权，API 可达也不代表行级安全正确。

> 落地状态：上述约束已在 `supabase/migrations/` 实现（建表 + 部分唯一索引 + 触发器 + RLS + 核心 RPC），清单见 §7.8。

### 7.5 推送通道（第一版 iOS）

- **当前实现**：客户端获取 Expo Push Token；阿里云 FC 定时轮询待投递通知并调用 Expo Push，由 Expo 转交 APNs。
- **迁移目标**：Cloud 核心切换期可暂时让 FC 读取 Cloud；稳定后将等价逻辑改写为 Edge Function 并由 Cron 调用，再停用 FC。现有 Node/FC 代码不能原样当作 Edge Function 部署。
- **运行时要求**：若过渡期继续运行 FC，升级到供应商与 Supabase JS 当前支持的 Node 22，并重新验证锁文件和行为；Node 20 不再作为新版本 Supabase JS 的支持目标。
- **范围**：第一版只保障 iOS。Android 厂商渠道、通知渠道配置及适配均不在本期范围。
- **可靠性**：授权后立即登记 token（含当前界面 `locale`），前台恢复、token 轮换与切语言会同步；FC 按令牌 `locale` 选中/英模板，仅在 Expo 接受后写 `pushed_at`，临时失败按 1 分钟至 1 小时退避重试。推送点按（含冷启动）仅跳转 App 内白名单路由。
- **上线验收**：发布前验证 Apple Push Key、Bundle ID、Expo 项目、FC 环境变量和真机端到端到达；未完成验收前，不将远程推送视为已上线能力。

### 7.6 合规（需专业确认，非法律意见）

> 以下为产品/工程检查项，不构成法律意见；发布前应按目标 storefront 与运营主体取得专业确认。

- 隐私政策与 App Store App Privacy 需披露 Supabase、SMTP、Expo/APNs 等处理方、用途和数据区域。
- 生产邮件使用已验证域名，配置 SPF/DKIM/DMARC，并提供可用的隐私与支持联系地址。
- 用户可在 App 内自助注销；删除、匿名化、共享家庭历史数据的边界必须与 PRD 一致。
- App Store 首版仅选择海外 storefront，不选择中国大陆；TestFlight 仍使用同一 Bundle ID 与 App 记录。

### 7.7 迁移与演进路径

- 按 `SUPABASE_CLOUD_MIGRATION_RUNBOOK.md` 逐阶段执行，只有完成证据与退出条件后才勾选。
- 当前路径 A 不迁源端测试数据；目标 Cloud schema 必须能从仓库 migration 独立重建。
- 推送先保持行为等价再迁 Edge/Cron；不要在同一次切换中同时替换数据库、Auth、推送算法和发布流程。
- 未来如恢复国际短信、双区域或多项目数据同步，必须作为新的产品与架构变更评估，不在首版迁移中预埋复杂路由。

### 7.8 数据库迁移与 RLS / RPC 清单（已落地）

> 在 DATAMODEL（v0.1）蓝图基础上，按 Supabase 最佳实践重整后实现。迁移位于 `supabase/migrations/`，按依赖顺序编号。

**关键落地决策（相对初稿的修正）：**

| 项       | 初稿                      | 落地方案                                     | 理由                                 |
| -------- | ------------------------- | -------------------------------------------- | ------------------------------------ |
| 用户主表 | 自建 `USER`，`phone` 主键 | `auth.users` + `public.profiles`（见 §7.3）  | 复用 Supabase Auth，避免手机号冗余   |
| 枚举     | 仅列取值                  | `text` + `CHECK` 约束                        | 比原生 enum 灵活（加值不受事务限制） |
| 时间类型 | `timestamp (UTC)`         | 一律 `timestamptz`                           | 避免时区歧义                         |
| 主键     | UUID                      | `uuid default gen_random_uuid()`             | PG13+ 内置，无需扩展                 |
| 软删除   | 文字约定                  | `status` / `is_deleted` 字段 + 仅开放 update | —                                    |

**RLS 模型：** 全部 `public` 表启用 RLS，策略遵循官方四要点——`(select auth.uid())` 包裹、一律 `TO authenticated`（anon 不授权）、每操作独立策略、跨表归属判断走 `private.*` 的 `SECURITY DEFINER` 辅助函数以避免递归。家庭隔离统一由 `private.is_family_member(family_id)` / `private.is_family_owner(family_id)` 等判定；`profiles` 可见性由 `private.shares_family()` 控制；`notifications` 仅本人可见。

**核心 RPC（单事务，`SECURITY DEFINER` + 内部鉴权）：** `create_family`、`create_invitation`（户主生成邀请码，对应 PRD §5）、`join_family_by_code`、`savings_deposit`、`savings_withdraw`（后两者实现方案 B 资金闭环：一笔流水 + 一条 entry + 更新目标，含 `version` 乐观锁）。`leave / remove / transfer / 解散 / 继任` 等流转 RPC 按流程后续补充。

**迁移文件清单：**

| 文件                               | 内容                                                                                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `…0001_extensions.sql`             | `private` schema、`set_updated_at()` 通用函数                                                                                                                                          |
| `…0002_core_tables.sql`            | `profiles` / `families` / `memberships`（含交叉外键、一人一家 / 户主唯一部分索引）                                                                                                     |
| `…0003_ledger_savings_tables.sql`  | `categories` / `savings_goals` / `transactions` / `savings_entries`                                                                                                                    |
| `…0004_budget_tables.sql`          | `budgets` / `budget_categories`                                                                                                                                                        |
| `…0005_aux_tables.sql`             | `invitations` / `succession_requests` / `notifications` / `monthly_summaries`                                                                                                          |
| `…0006_constraints_triggers.sql`   | `handle_new_user`、`updated_at` 触发器、`family_id` 不可变、成员 / 目标计数触发器                                                                                                      |
| `…0007_rls_helpers.sql`            | `private.*` RLS 辅助函数                                                                                                                                                               |
| `…0008_rls_policies.sql`           | 各表 RLS 策略 + 表权限 GRANT                                                                                                                                                           |
| `…0009_rpc_functions.sql`          | `create_family` / `join_family_by_code` / `savings_deposit` / `savings_withdraw`                                                                                                       |
| `…0010_seed_system_categories.sql` | 系统预设分类种子（含储蓄存入/取出，资金闭环依赖）                                                                                                                                      |
| `…0011_create_invitation_rpc.sql`  | `create_invitation`（户主生成邀请码：仅户主 / 满员拦截 / 24h / 复用或刷新，PRD §5）                                                                                                    |
| `…0012_preview_family_rpc.sql`     | `preview_family_by_code`（只读：校验码同 `join_family_by_code`；返回家庭名 / 封面 / 户主昵称+头像 / 成员头像列表 / 人数 / 对当前用户的加入影响；**不返回成员昵称**；限频，PRD 流程 4） |

**迁移执行方式：** 源端仍通过只读审计与备份留存；目标 Cloud 项目使用 Supabase CLI `link` 后按版本化 migration 执行。禁止只在 Studio 手工补 DDL；若为 Cloud 兼容性修复，创建新的 migration 并提交。客户端 publishable key 无 DDL 权限。

### 7.9 开发期测试登录

> 仅用于开发/调试，**勿用于生产**。测试项目可使用「邮箱注册 + `mailer_autoconfirm=true`」快速创建 A/B 账号，在真实 RLS 下验证接口；生产项目必须启用邮箱确认与自定义 SMTP。

**测试账号**（A、B 两个，便于验证跨家庭隔离）：

|     | 邮箱                  | 密码            |
| --- | --------------------- | --------------- |
| A   | `dev.a@homebook.test` | `devtest123456` |
| B   | `dev.b@homebook.test` | `devtest123456` |

**前端**：`src/app/dev.tsx` 是 `__DEV__` 门控的调试台（首页底部「→ Dev 调试台」入口，生产构建重定向回首页）；可一键登录 A/B、`create_family`、记一笔、读概览。复用逻辑在 `src/lib/dev-auth.ts`（`devSignIn` 不存在则自动注册、`ensureFamily`、`addSampleExpense`、`fetchOverview`）。

**后端 / 接口**：`scripts/dev-token.sh` 从 `.env` 读 URL + anon key，登录拿 `access_token` 并可发起已鉴权请求：

```bash
scripts/dev-token.sh                                  # 打印 access_token
scripts/dev-token.sh GET  /rest/v1/families?select=*  # 已鉴权 GET
scripts/dev-token.sh POST /rest/v1/rpc/create_family '{"p_name":"家","p_timezone":"Asia/Shanghai"}'
DEV_EMAIL=dev.b@homebook.test scripts/dev-token.sh ...  # 切 B 账号
```

> 测试账号不得迁入生产项目；生产验收使用专用测试身份，完成后按保留策略清理。

---

## 8. 工程结构建议

```
app/                      # expo-router 路由（文件即页面）
  (tabs)/                 # 首页 / 报表 / 家庭
  modal/                  # 记账面板等模态
src/
  features/               # 按 PRD 流程切：auth / ledger / family / report / savings / budget / notification / settings
  components/             # 通用组件（<Money/>、SlideToConfirm、EmptyState…）
  theme/                  # 设计令牌（Light / Night 两套映射，对齐 DESIGN §4 色彩 / §14 Light·Night）
  data/                   # 本地 DB 模型（WatermelonDB）+ Repository + SyncEngine
  api/                    # RemoteAPI（Supabase 客户端封装 + Mock 实现）
  adapters/               # 区域适配层：PushAdapter / SmsAdapter / StorageAdapter（见 §7.7）
  store/                  # Zustand stores
  lib/                    # 工具（金额换算、时区归月…）

supabase/                 # 后端工程（与客户端同仓或独立仓）
  migrations/             # 版本化 SQL 迁移（建表 + 约束 + RLS policy）
  functions/              # Edge Functions（Deno/TS）：短信、推送、月度总结、继任判定
  tests/                  # pgTAP（RLS / RPC 测试）
```

---

## 9. 里程碑排期（对齐 MVP.md M0–M4）

> 与 MVP.md §4 的 M0–M4 批次一一对应。

| 批次               | 内容                                                                            | 客户端关键交付                                                                                                                                                                                                                                          | 后端关键交付                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0 地基**        | 脚手架 + 设计令牌主题 + 本地 DB + API 层骨架                                    | TS 主题（Light/Night）、NativeTabs 四 Tab（首页 / 报表 / 家庭 / 我的）+ 记一笔悬浮钮 + 顶栏右上搜索图标、搜索占位页、`<Money/>`、空状态                                                                                                                 | Supabase Cloud 路径 A 重建、迁移骨架 + 核心表 + grants/RLS、CI 跑 pgTAP                                                                                                                  |
| **M1 账号 + 记账** | 流程 1 登录（邮箱密码 + Apple）、流程 2 记一笔、流程 10 编辑 / 删除             | 登录页移除手机号入口；记账 Sheet、流水列表（按日分组 + 左滑）、离线同步队列                                                                                                                                                                             | Supabase Auth（邮箱确认 + Apple + 自定义 SMTP）、流水 RPC、WatermelonDB 同步函数（pull/push）                                                                                            |
| **M2 家庭协作**    | 流程 3 邀请二维码、流程 4 扫码加入、流程 5 转让 / 退出 / 解散、流程 13 关键通知 | expo-camera 扫码、qrcode-svg 生成、滑动确认控件、被移除全屏兜底                                                                                                                                                                                         | 家庭/成员流转 RPC（在线）、邀请码校验、NOTIFICATION + Realtime                                                                                                                           |
| **M3 基础报表**    | 流程 9 基础版（本月收支结余 + 分类占比环形图）                                  | react-native-svg 环形图 + 概览环比角标 + 结余率（值）+ 分类明细下钻                                                                                                                                                                                     | 报表聚合视图 / RPC（排除储蓄类流水口径；输出本期 + 上期对比值供环比）                                                                                                                    |
| **M4 增值（P1）**  | 分类管理 → 预算 → 储蓄目标 → 完整报表 / 月度总结 → 移除成员 → 通知体系          | 进度条 / 目标卡 / 庆祝动效、Banner；报表完整版：成员参与度（原生横向条）/ 发生额折线 / 累计同期双线 / 收支双柱 / 分类环比 / 大额 Top N 列表 / 结余率仪表 / 月度总结卡（**报表图表实现为 react-native-svg 自绘，非 Victory**；月度总结为客户端实时计算） | 储蓄存取 RPC、pg_cron（预算重置/继任判定）、报表聚合扩展（分类环比 / 同期累计 / Top N 聚合）；**iOS 系统推送（Expo Push → APNs）上线验收、月度总结服务端快照 移至发布前（见 MVP §2.4）** |

每批结束应可独立验收（与 MVP §4 一致）。

---

## 10. 上架与盈利路径

| 项目       | 事实（2026）                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------- |
| 开发者账号 | Apple Developer Program 个人版，**99 美元/年**，自动续费；以本人法定姓名上架，无需 D-U-N-S   |
| 标准分成   | Apple 抽成 **30%**                                                                           |
| 小企业计划 | 年收入 < 100 万美元 → 抽成降为 **15%**（App Store Small Business Program），新开发者亦可申请 |
| 订阅       | 即使不入计划，订阅满 1 年后自动降至 15%；入计划则第一天即 15%                                |
| 建议       | 上架后**第一时间申请小企业计划**，在 App Store Connect 接受最新 Paid Apps 协议并申报关联账号 |

> 上架与分成机制与具体技术栈无关（RN / 原生一致），不构成选型差异。首版只选择海外 storefront，不选择中国大陆。

---

## 11. 技术风险与注意点

1. **Cloud Free 生产边界**：容量、短日志保留、无可下载 Dashboard 备份与低活跃暂停风险都需监控；达到运行手册门槛即升级。
2. **Auth 与邮件可用性**：默认 SMTP 不能用于生产；自定义 SMTP 的额度、退信和域名信誉必须在 TestFlight 前验证。
3. **迁移兼容性**：`delete_account` 直接修改 `auth.*`，Storage policy 也曾针对自托管限制调整，必须在 Cloud 测试项目专项验证。
4. **离线编辑 / 删除的串账边界**：编辑跨家庭归属必须按原 `family_id`（PRD §12.5），重点测试。
5. **储蓄累计值守恒**：禁止 LWW 同步 `saved_amount`，只同步事件后服务端重算（§6.7）。
6. **被移除者实时踢出**：网络层统一拦截 401 / 踢出码，触发全屏提示（PRD §8.5）。
7. **账期时区**：归月 / 归日按 `FAMILY.timezone` 计算（PRD §2.5），不随成员所在地变化。
8. **数据备份**：Free 阶段自行生成、加密并试恢复逻辑备份；恢复目标提高后升级并启用合适的平台备份/PITR。
9. **可访问性**：Dynamic Type、VoiceOver、减弱动态、Light/Night 两套对比度（DESIGN §13），组件层内建。
10. **图表性能**：报表图表为 `react-native-svg` 自绘（无 Skia / Victory）；热力图约 365 个 `Rect`、趋势多序列时用 `useMemo` 缓存序列，避免每帧重算。
11. **OTA 边界**：EAS Update 仅能热更新 JS 层；改动原生模块仍需重新提审。
12. **改原生配置须 prebuild，纯 xcodebuild 不应用 config 插件**：`app.json` 的 `plugins` / 权限 / 原生配置改动只在 **`npx expo prebuild`** 阶段写进 `ios/`（如 Info.plist 的权限说明键）。本项目重编命令 `npm run ios:sim` 是**纯 `xcodebuild`，不会跑 config 插件**，单独重编会出现「JS 代码对、原生没生效」。正确顺序：**先 `npx expo prebuild -p ios`（**不要带 `--clean`**，否则会冲掉 `ios/Podfile.properties.json` 的 `EXPO_USE_PRECOMPILED_MODULES=false`，导致启动 dyld 崩溃，详见 README「重要约束」），再 `npm run ios:sim`**。典型事故：接入 `expo-image-picker` 后仅 `ios:sim`，`Info.plist` 缺 `NSPhotoLibraryUsageDescription`，一选图即被 iOS 按隐私违规 `SIGABRT` 闪退（`Namespace TCC`）。亦不可用 `npm run ios`（`expo run:ios`）——当前 Xcode 26 / iOS 26 模拟器会被误判成真机索要签名（见 README「重要约束」）。
13. **@expo/ui（SwiftUI）ScrollView 自动避让安全区**：SwiftUI `ScrollView` 会**自动**按安全区内缩内容（顶部 `insets.top`、底部含悬浮 Tab Bar）。若在其上再手动叠加 `insets.top` / `TabBarInset`，会**双重计入**，表现为三类症状：①标题与主体间多出约一个安全区高度的空隙；②列表末尾留出约一个 Tab Bar 高度的大片空白；③滚动折叠头部出现起始「死区」——`useScrollGeometryChange` 上报的 `contentOffsetY` 在停靠顶部时为 `-insets.top`，需 `+insets.top` 归一化后再驱动折叠。首页已据此处理（[src/app/index.tsx](../src/app/index.tsx)：顶部 padding 减 `insets.top`、底部只留小间距 `Space[6]`；[src/features/shared/use-collapsible-header.ts](../src/features/shared/use-collapsible-header.ts)：折叠偏移量 `+topInset` 归一化）。**RN 的 `ScrollView` 不会自动避让**（报表/家庭页仍需手动 `TabBarInset` 底部 padding 才能让内容滚到悬浮 Tab Bar 上方）——SwiftUI 与 RN 两条滚动链路非对称，勿照搬彼此的留白处理。

---

## 12. 待补充 / 后续迭代

- §13 后端接口契约（DTO / 错误码 / 同步协议：pull 增量 + push 队列）—— 与后端实现对齐后补充
- §14 本地 DB Schema（WatermelonDB）与 Repository / SyncEngine 设计明细
- ~~§15 数据库迁移与 RLS / RPC 清单（建表约束 + policy + 核心 RPC 函数骨架）~~ —— **已落地，见 §7.8 与 `supabase/migrations/`**（流转类 RPC 待补）
- ~~§16 阿里云基座落地细则~~ —— 已由 `SUPABASE_CLOUD_MIGRATION_RUNBOOK.md` 的 Cloud 路径 A 取代；阿里云文档仅保留历史恢复用途
- §17 CI/CD（迁移自动化、Edge Functions 部署、pgTAP、EAS Build、灰度发布）
- §18 测试策略（单元 / 组件 / E2E：Jest + React Native Testing Library + Maestro + pgTAP）
- §19 性能与包体积优化
