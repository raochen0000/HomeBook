# 家账 · 技术选型与开发方案（TECH）

> 文档版本：v0.2.1（导航说明同步 DESIGN v0.4.0：四 Tab + 记一笔浮钮 + 顶栏搜索，废弃药丸 / Search 圆 / BottomAccessory 三栏条旧描述；里程碑同步 PRD §11 报表扩充：M3 增概览环比 / 结余率，M4 报表完整版图表清单细化、横向条形优先原生件）
> 最后更新：2026-06-19
> 关联文档：PRD.md（v0.1.2，对应 §23）、DESIGN.md（v0.4.0）、IA.md（v0.2.0）、MVP.md（v0.1.3）、DATAMODEL.md（v0.1）、AGENTS.md（AI 编码业务铁律，根目录）
> 负责人：产品组 / 研发
> 用途：作为「家账」客户端与后端技术实现的单一事实来源（Single Source of Truth），记录技术选型、后端架构、开发环境、调试流程、里程碑排期与上架盈利路径。后续可基于本文档持续补充。

---

## 1. 技术决策背景

- **目标平台**：iOS（iOS 26+），后续可扩展 Android。
- **用户与区域**：**前期以中国大陆用户为主，后期面向全球**。这直接决定后端落地境内（阿里云）、短信/推送走境内通道、并需满足国内合规（见 §7）。
- **核心约束**：离线优先记账、家庭多端协作、数据归家防串账（见 PRD §2.3、DATAMODEL §6）、数据本地化与合规（见 §7.6）。
- **团队背景**：个人开发者，前端 React + TypeScript 为主，会用 Node/TS 写服务端逻辑，以 Cursor 为主要编程工具，重度依赖 AI 辅助（规则见根目录 AGENTS.md）。
- **关键取舍**：
  - 客户端选 RN 换取**最大化复用 React/TS 技能 + 跨平台潜力 + JS 层 OTA 热更新**；视觉走 **native-first**（`@expo/ui/swift-ui` 原生件）。
  - 后端选 **Supabase（Postgres + RLS + RPC + Realtime + Storage）但托管于阿里云境内**，换取「保留 RLS/RPC 等已有架构投入」与「国内可达性 + 合规」的平衡（见 §7）。

> 结论：客户端 **React Native（Expo）+ TypeScript**；后端 **阿里云境内托管的 Supabase（含 Postgres）+ 区域服务适配层**。

---

## 2. 技术选型总览

| 层              | 选型                                                           | 说明                                                                                                                                                                                                              |
| --------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 框架            | **Expo（React Native）+ TypeScript**                           | 对 React + TS 背景最友好，工具链成熟                                                                                                                                                                              |
| 路由 / 导航     | **expo-router** + **NativeTabs**（`unstable-native-tabs`）     | 文件式路由；原生 Tab Bar，对齐 IA §2 / DESIGN §5.2：iOS 26 标准四 Tab（首页 / 报表 / 家庭 / 我的）+「➕ 记一笔」悬浮圆钮（Tab Bar 右上方，全 Tab 常驻）+ 顶栏右上搜索图标（系统 chrome 顺应 iOS 26 Liquid Glass） |
| 状态管理        | **Zustand**（本地 UI 态）+ **TanStack Query**（服务端态/缓存） | 轻量，契合中小型应用                                                                                                                                                                                              |
| 本地存储 / 离线 | **WatermelonDB**（本地 DB + 自建同步）                         | 离线优先：本地 DB + 同步队列，同步走自有境内后端（见 §6，国内优先下不选海外托管的 PowerSync）                                                                                                                     |
| 网络            | **fetch + TanStack Query** + **Supabase JS SDK**               | 客户端用 anon key 直连 Supabase，安全由 RLS 兜底                                                                                                                                                                  |
| 二维码          | 扫码 **expo-camera**；生成 **react-native-qrcode-svg**         | 流程 3 / 4                                                                                                                                                                                                        |
| 动画 / 手势     | **react-native-reanimated** + **react-native-gesture-handler** | 滑动确认控件、庆祝动效                                                                                                                                                                                            |
| 图表            | **Victory Native (XL)**（见 §3）                               | 报表环形 / 条形 / 折线 / 双柱图                                                                                                                                                                                   |
| 安全存储        | **expo-secure-store**                                          | Token / 登录态                                                                                                                                                                                                    |
| 推送            | **阿里云移动推送 EMAS**（厂商通道 + APNs）                     | **国内 FCM/Expo Push 不可用**，安卓走华为/小米/OPPO/vivo/魅族厂商通道，iOS 走 APNs（见 §7.5）                                                                                                                     |
| OTA 热更新      | **EAS Update（expo-updates）**                                 | JS 层 bug 免审核直推                                                                                                                                                                                              |
| 后端基座        | **阿里云境内托管的 Supabase**（RDS 内置 / 自建）               | Postgres + Auth + Realtime + Storage + Edge Functions + pg_cron（见 §7）                                                                                                                                          |
| 后端区域服务    | **阿里云短信 / 移动推送 / OSS / CDN / SLS**                    | 短信验证码、推送、对象存储、加速、日志（见 §7.2）                                                                                                                                                                 |

> 备注：内容层不主动施加 `glassEffect`（保持实心，保金额清晰）；系统 chrome（导航 / Tab / 原生 Sheet）顺应 iOS 26 系统材质（含 Liquid Glass），由 NativeTabs / 原生件自动获得（见 DESIGN.md §3）。NativeTabs 为 alpha/unstable API，上线前需 spike 验证（见 DESIGN §5.2）。

---

## 3. 报表图表方案

报表需求见 PRD §11.5、DESIGN §5.7：环形图（P0）、横向条形图 / 折线图 / 双柱图（P1）。

| 库                            | 渲染        | 优点                                                      | 代价                          | 适合                                      |
| ----------------------------- | ----------- | --------------------------------------------------------- | ----------------------------- | ----------------------------------------- |
| **Victory Native (XL, v40+)** | Skia（GPU） | 性能强、组合式 API 像 React、TS 优先、饼/环/柱/折线全覆盖 | 需 Dev Build（Skia 原生模块） | 一套库覆盖现在 + 将来全部图表（**推荐**） |
| react-native-gifted-charts    | SVG         | props 式、上手快、可在 Expo Go 跑、含环形/柱/折线         | 大数据量性能一般              | 仅 MVP 环形图、想最快出活                 |

**决策**：选 **Victory Native (XL)**，一步到位覆盖 P0 + P1，避免后期换库。

安装（一次装齐 peer 依赖）：

```bash
npx expo install victory-native @shopify/react-native-skia react-native-reanimated react-native-gesture-handler
```

> 待解分歧（既有）：TECH §3（Victory Native / Skia）与 DESIGN §5.7（Skia 自绘）口径需对齐，单独处理，与本次后端更新无关。
> 口径提醒：储蓄类流水（`source != normal`）计入收支/结余，但**不进**分类占比与消费趋势图（见 PRD §11.6、DATAMODEL §3.4）。

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

| 工具                          | 说明                                                                                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Xcode 26**（Mac App Store） | 约 12GB+；装完打开一次接受协议，再执行 `xcode-select --install` 与 `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`；在 Xcode 内下载 **iOS 26 模拟器** |
| **Cursor**                    | 已在用。建议扩展：ESLint、Prettier；接 Supabase MCP（仅连开发库，生产加 `?read_only=true`）；装 supabase / postgres-best-practices agent-skills                               |
| **阿里云账号 + 企业实名**     | 短信签名/模板报备、ICP 备案、移动推送均需**企业主体实名**，需提前办理（见 §7.6）                                                                                              |
| **Apple Developer Program**   | 99 美元/年。**仅在需要真机调试或上架时购买**，模拟器阶段无需                                                                                                                  |
| Android Studio / JDK          | **iOS-only 阶段无需安装**，未来做 Android 再装                                                                                                                                |

> Expo CLI 无需全局安装：项目内 `npx expo` 自动使用项目版本。

---

## 5. 调试流程

```
① 创建项目
   npx create-expo-app@latest jiazhang
   cd jiazhang

② 安装开发客户端（使用 Skia / 相机等原生模块需要）
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
   - **国内优先下不选 PowerSync 托管云**（海外托管，大陆可达性风险）；若要用 PowerSync，须自建部署于境内。
7. **储蓄累计值不可 LWW**：`SAVINGS_GOAL.saved_amount` 是派生值（存入合计 − 取出合计），同步**储蓄事件**（`SAVINGS_ENTRY`）后由服务端重算，禁止把累计值当字段直接 LWW（否则并发存入丢钱）。
8. **同步态 UI**：离线用 `state/info` 轻提示「已保存，稍后同步」（DESIGN §5.8）。
9. **金额精度**：全程以「分」（bigint）传输，仅展示层做分↔元换算（DATAMODEL §1.2）。

---

## 7. 后端架构（阿里云 · 国内优先）

### 7.0 决策背景

- **前期国内优先**：Supabase Cloud **无中国大陆区域**，海外节点经 GFW 访问不稳定（尤其 Realtime websocket），且涉及数据本地化/跨境合规——故后端落地**阿里云境内**。
- **但不放弃 Supabase 架构**：Supabase 开源可自托管，亦有阿里云 RDS 内置形态。把它跑在阿里云境内，可**保留 Postgres + RLS + RPC + Realtime + Storage + Edge Functions** 与已有的 agent-skills / AGENTS.md 投入。
- **区域相关能力**（短信、推送、对象存储、CDN）一律走**阿里云/厂商通道**，并抽象为**可替换适配层**，为后期全球化预留切换空间（见 §7.7）。

### 7.1 后端基座（二选一，推荐 A）

**方案 A（推荐）：阿里云上的 Supabase** —— 保留全部已有架构投入

- **A1｜阿里云 RDS 内置 Supabase（首选，省运维）**：阿里云 RDS 已将 Supabase 作为一方功能提供，相当于境内托管版 Supabase。**需向阿里云直接核实当前可用性、区域、定价与功能完整度**（较新，未核实前不作为唯一依赖）。
- **A2｜自建 Supabase（备用，可控）**：在阿里云 ECS / ACK（K8s）上用 Docker（或 Pigsty / StackGres）自托管 Supabase 各组件，数据库用**阿里云 RDS PostgreSQL** 或 **PolarDB for PostgreSQL**。代价：运维归己（升级、备份、监控）。

**方案 B（备选）：纯阿里云原生** —— 仅当明确要传统 API 层时

- 阿里云 RDS PostgreSQL / PolarDB + 自建 **Node API**（Fastify / NestJS，部署于函数计算 FC 或 SAE）+ 自管鉴权。
- **代价**：RLS / RPC 的安全模型要重写进 API 层，AGENTS.md 中以 RLS 为前提的部分规则失效，AI 编码红利下降。

> 选择建议：**先核实 A1，可用即用 A1**（最省心）；否则走 **A2**；除非团队明确偏好传统 API 层，否则不建议 B。无论哪条，§7.2 的区域服务都一样。

### 7.2 能力 → 阿里云产品映射

| 能力        | 方案 A（阿里云上的 Supabase）                                  | 区域服务（阿里云/厂商）                             |
| ----------- | -------------------------------------------------------------- | --------------------------------------------------- |
| 数据库      | Postgres（阿里云 RDS PostgreSQL / PolarDB）                    | —                                                   |
| 鉴权        | Supabase Auth（GoTrue）：手机 OTP + Apple                      | 手机验证码下发走**阿里云短信服务**                  |
| 行级安全    | **RLS**（家庭隔离、户主专属、记账人本人）                      | —                                                   |
| 服务端逻辑  | **Postgres RPC**（事务/不变式）+ **Edge Functions（Deno/TS）** | 重计算可选**阿里云函数计算 FC**                     |
| 定时任务    | **pg_cron** 触发 Edge Function                                 | 或**阿里云定时触发器**                              |
| 实时        | **Supabase Realtime**（websocket）                             | 自建须确保境内可达                                  |
| 对象存储    | Supabase Storage（S3 兼容，后端可指向 OSS）                    | **阿里云 OSS**（头像、目标封面）                    |
| 短信验证码  | —                                                              | **阿里云短信服务**（签名 + 模板报备，企业实名）     |
| 推送        | NOTIFICATION 表 + Realtime 站内红点                            | **阿里云移动推送 EMAS**（厂商通道 + APNs，见 §7.5） |
| 加速        | —                                                              | **阿里云 CDN**                                      |
| 备份 / 恢复 | RDS 自动备份 + **PITR**（记账数据必须）                        | —                                                   |
| 日志 / 监控 | Supabase 日志                                                  | **阿里云 SLS 日志服务 + ARMS**；RN 端接 Sentry      |

### 7.3 鉴权与短信验证码流程

- **用户主表 = `auth.users`（Supabase Auth 托管）+ `public.profiles`（业务字段）**：DATAMODEL 中的 `USER` 实体落地时拆分——手机号/OTP/session 由 Supabase Auth 的 `auth.users` 持有，**不在业务表冗余 `phone`**；`public.profiles.id` 一对一引用 `auth.users(id)`（`ON DELETE CASCADE`），存 `nickname / avatar_url / current_family_id / last_login_at / status`。新用户注册时由 `handle_new_user()` 触发器自动建 profiles 行。
- **手机号 OTP**：客户端请求验证码 → 后端（Edge Function / RPC）调**阿里云短信服务**下发 → 客户端回填校验 → Supabase Auth 签发 session（JWT），存入 `expo-secure-store`。
- **Apple 登录**：Supabase Auth Apple provider（iOS 必备的第三方登录合规项）。
- **微信登录（后期可选）**：Supabase Auth 无内置，需自实现 OAuth provider。
- **风控**：验证码下发做频率限制与防刷（按手机号/IP/设备）；邀请码 24h 有效且户主权限变更即失效（服务端校验）。
- **客户端只持 anon key**：service role key 绝不进客户端/仓库；权限由 RLS 兜底（见 AGENTS.md §4）。

### 7.4 服务端必须强制的约束

与 AGENTS.md §4/§5 与 DATAMODEL §6 一致，**在数据库层用 RLS + 唯一约束 + RPC 事务真正强制**（规则文件管「AI 别写错」，DB 约束管「写错也拦得住」）：

- 一人一家、户主唯一、成员上限 8、储蓄目标 ≤5、继任异议期单条 pending（唯一约束/部分索引）。
- `TRANSACTION.family_id` 创建后不可变（规则/触发器拒绝 UPDATE）。
- 储蓄存取、户主转让、解散、加入家庭、删除目标余额回吐 → **单事务 RPC**（见 AGENTS.md §7）。
- 每条 RLS / RPC 配 pgTAP 测试。

> 落地状态：上述约束已在 `supabase/migrations/` 实现（建表 + 部分唯一索引 + 触发器 + RLS + 核心 RPC），清单见 §7.8。

### 7.5 推送通道（国内重点）

- **关键事实**：FCM 与依赖 FCM 的 **Expo Push 在中国大陆安卓不可用**（Google 服务被屏蔽）；iOS APNs 在国内正常。
- **方案**：采用**阿里云移动推送 EMAS**，整合华为/小米/OPPO/vivo/魅族**厂商通道**（安卓）与 **APNs**（iOS）；Edge Function / FC 在事件触发时调推送。
- **可移植**：客户端与服务端之间抽象 `PushAdapter` 接口，全球化阶段可切回 Expo Push / FCM（见 §7.7）。

### 7.6 合规（需专业确认，非法律意见）

> 以下为需排期办理/核实的合规项，**应由懂中国监管的专业人士确认**，本节不构成法律意见。

- **ICP 备案**：境内提供服务/域名需备案。
- **个人信息保护法（PIPL）/ 数据安全法 / 网络安全法**：收集手机号 + 财务数据须合法告知与同意；**数据本地化**（数据存境内）正是后端落地阿里云的根本动因；如后期出现跨境传输需走标准合同/安全评估等。
- **短信签名/模板报备**：阿里云短信需企业主体实名 + 签名模板审核。
- **App Store 中国区上架**：需相应资质（如软著等），按 Apple 与监管要求办理。

### 7.7 国内 → 全球演进路径

- **保持底座为标准 Postgres**：表、RLS、RPC、薄客户端数据访问层，不深耦「仅某托管特有」的能力。
- **区域适配层可替换**：短信（阿里云短信 ↔ Twilio）、推送（EMAS ↔ Expo Push/FCM）、存储（OSS ↔ Supabase Storage/S3）、CDN，全部走接口抽象。
- **全球化两种形态**：① 迁/扩到 Supabase Cloud 多区域；② 「境内一套 + 海外一套」双部署，按用户区域路由。
- **结论**：因底座是标准 Postgres + RLS + RPC，扩展到全球是**配置与部署问题，不是重写**。

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

| 文件                               | 内容                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `…0001_extensions.sql`             | `private` schema、`set_updated_at()` 通用函数                                            |
| `…0002_core_tables.sql`            | `profiles` / `families` / `memberships`（含交叉外键、一人一家 / 户主唯一部分索引）       |
| `…0003_ledger_savings_tables.sql`  | `categories` / `savings_goals` / `transactions` / `savings_entries`                      |
| `…0004_budget_tables.sql`          | `budgets` / `budget_categories`                                                          |
| `…0005_aux_tables.sql`             | `invitations` / `succession_requests` / `notifications` / `monthly_summaries`            |
| `…0006_constraints_triggers.sql`   | `handle_new_user`、`updated_at` 触发器、`family_id` 不可变、成员 ≤8 / 目标 ≤5 计数触发器 |
| `…0007_rls_helpers.sql`            | `private.*` RLS 辅助函数                                                                 |
| `…0008_rls_policies.sql`           | 各表 RLS 策略 + 表权限 GRANT                                                             |
| `…0009_rpc_functions.sql`          | `create_family` / `join_family_by_code` / `savings_deposit` / `savings_withdraw`         |
| `…0010_seed_system_categories.sql` | 系统预设分类种子（含储蓄存入/取出，资金闭环依赖）                                        |
| `…0011_create_invitation_rpc.sql`  | `create_invitation`（户主生成邀请码：仅户主 / 满 8 拦截 / 24h / 复用或刷新，PRD §5）     |

**迁移执行方式：** 当前后端为阿里云自托管 Supabase 兼容实例（非 Cloud），CLI 用直连 Postgres 连接串 `supabase db push`（不用 `supabase link`）；或在 Studio SQL Editor 按编号顺序粘贴执行。客户端仅持 anon key，无法执行 DDL。

### 7.9 开发期测试登录（OTP 未配前的临时方案）

> 仅用于开发/调试，**勿用于生产**。手机 OTP 短信尚未接入前，借实例已开启的「邮箱注册 + `mailer_autoconfirm=true`」（注册即确认、无需邮件/短信验证），用邮箱密码拿真实 JWT，在**真实 RLS** 下验证前/后端接口。

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

> 接入手机 OTP（阿里云短信，见 §7.3）后，本方案与测试账号即可下线。

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

| 批次               | 内容                                                                            | 客户端关键交付                                                                                                                                                        | 后端关键交付                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **M0 地基**        | 脚手架 + 设计令牌主题 + 本地 DB + API 层骨架                                    | TS 主题（Light/Night）、NativeTabs 四 Tab（首页 / 报表 / 家庭 / 我的）+ 记一笔悬浮钮 + 顶栏搜索图标、搜索占位页、`<Money/>`、空状态                                   | 阿里云 Supabase 基座搭起（A1/A2 定夺）、迁移骨架 + 核心表 + RLS、CI 跑 pgTAP                                               |
| **M1 账号 + 记账** | 流程 1 登录（MVP = 邮箱 / Apple；**手机 OTP 移至发布前**，见 §7.9 / MVP §2.4）、流程 2 记一笔、流程 10 编辑 / 删除 | 记账 Sheet（大金额输入）、流水列表（按日分组 + 左滑）、离线同步队列                                                                                                   | Supabase Auth（MVP 邮箱 + Apple）、流水 RPC、WatermelonDB 同步函数（pull/push）；**阿里云短信 OTP 发布前接入**             |
| **M2 家庭协作**    | 流程 3 邀请二维码、流程 4 扫码加入、流程 5 转让 / 退出 / 解散、流程 13 关键通知 | expo-camera 扫码、qrcode-svg 生成、滑动确认控件、被移除全屏兜底                                                                                                       | 家庭/成员流转 RPC（在线）、邀请码校验、NOTIFICATION + Realtime                                                             |
| **M3 基础报表**    | 流程 9 基础版（本月收支结余 + 分类占比环形图）                                  | Victory Native XL 环形图 + 概览环比角标 + 结余率（值）+ 分类明细下钻                                                                                                  | 报表聚合视图 / RPC（排除储蓄类流水口径；输出本期 + 上期对比值供环比）                                                      |
| **M4 增值（P1）**  | 分类管理 → 预算 → 储蓄目标 → 完整报表 / 月度总结 → 移除成员 → 通知体系          | 进度条 / 目标卡 / 庆祝动效、Banner；报表完整版：成员参与度（原生横向条）/ 发生额折线 / 累计同期双线 / 收支双柱 / 分类环比 / 大额 Top N 列表 / 结余率仪表 / 月度总结卡（**报表图表实现为 react-native-svg 自绘，非 Victory**；月度总结为客户端实时计算） | 储蓄存取 RPC、pg_cron（预算重置/继任判定）、报表聚合扩展（分类环比 / 同期累计 / Top N 聚合）；**系统推送（阿里云 EMAS）、月度总结服务端快照 移至发布前（见 MVP §2.4）** |

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

> 上架与分成机制与具体技术栈无关（RN / 原生一致），不构成选型差异。中国区上架另需国内资质（见 §7.6）。

---

## 11. 技术风险与注意点

1. **国内网络可达性**：后端必须境内（阿里云），避免 GFW 导致 Realtime/同步不稳；自建 Supabase 须做可用性与延迟实测。
2. **推送通道碎片化**：安卓多厂商通道接入与到达率是重点工作，需逐厂商验证（华为/小米/OPPO/vivo/魅族）。
3. **合规前置**：ICP 备案、企业实名、短信签名报备有审核周期，**提前办理**。手机号 OTP 已移至发布前（MVP 用 邮箱 + Apple，见 §7.9 / MVP §2.4），故不再阻塞 M1；但短信/推送报备仍需在**发布前**完成。
4. **离线编辑 / 删除的串账边界**：编辑跨家庭归属必须按原 `family_id`（PRD §12.5），重点测试。
5. **储蓄累计值守恒**：禁止 LWW 同步 `saved_amount`，只同步事件后服务端重算（§6.7）。
6. **被移除者实时踢出**：网络层统一拦截 401 / 踢出码，触发全屏提示（PRD §8.5）。
7. **账期时区**：归月 / 归日按 `FAMILY.timezone` 计算（PRD §2.5），不随成员所在地变化。
8. **数据备份**：记账数据务必开启 RDS 自动备份 + PITR；自建则自管备份策略。
9. **可访问性**：Dynamic Type、VoiceOver、减弱动态、Light/Night 两套对比度（DESIGN §13），组件层内建。
10. **图表性能**：Victory Native（Skia）需 Dev Build；大数据量时注意 Reanimated 共享值更新频率。
11. **OTA 边界**：EAS Update 仅能热更新 JS 层；改动原生模块仍需重新提审。
12. **@expo/ui（SwiftUI）ScrollView 自动避让安全区**：SwiftUI `ScrollView` 会**自动**按安全区内缩内容（顶部 `insets.top`、底部含悬浮 Tab Bar）。若在其上再手动叠加 `insets.top` / `TabBarInset`，会**双重计入**，表现为三类症状：①标题与主体间多出约一个安全区高度的空隙；②列表末尾留出约一个 Tab Bar 高度的大片空白；③滚动折叠头部出现起始「死区」——`useScrollGeometryChange` 上报的 `contentOffsetY` 在停靠顶部时为 `-insets.top`，需 `+insets.top` 归一化后再驱动折叠。首页已据此处理（[src/app/index.tsx](../src/app/index.tsx)：顶部 padding 减 `insets.top`、底部只留小间距 `Space[6]`；[src/features/shared/use-collapsible-header.ts](../src/features/shared/use-collapsible-header.ts)：折叠偏移量 `+topInset` 归一化）。**RN 的 `ScrollView` 不会自动避让**（报表/家庭页仍需手动 `TabBarInset` 底部 padding 才能让内容滚到悬浮 Tab Bar 上方）——SwiftUI 与 RN 两条滚动链路非对称，勿照搬彼此的留白处理。

---

## 12. 待补充 / 后续迭代

- §13 后端接口契约（DTO / 错误码 / 同步协议：pull 增量 + push 队列）—— 与后端实现对齐后补充
- §14 本地 DB Schema（WatermelonDB）与 Repository / SyncEngine 设计明细
- ~~§15 数据库迁移与 RLS / RPC 清单（建表约束 + policy + 核心 RPC 函数骨架）~~ —— **已落地，见 §7.8 与 `supabase/migrations/`**（流转类 RPC 待补）
- §16 阿里云基座落地细则（A1 内置 Supabase 核实结论 / A2 自建部署拓扑、网络、备份）
- §17 CI/CD（迁移自动化、Edge Functions 部署、pgTAP、EAS Build、灰度发布）
- §18 测试策略（单元 / 组件 / E2E：Jest + React Native Testing Library + Maestro + pgTAP）
- §19 性能与包体积优化
