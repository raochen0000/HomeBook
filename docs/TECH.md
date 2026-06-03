# 家账 · 技术选型与开发方案（TECH）

> 文档版本：v0.1
> 最后更新：2026-05-31
> 关联文档：PRD.md（v0.1，对应 §23）、DESIGN.md（v0.1）、IA.md（v0.1）、MVP.md（v0.1）、DATAMODEL.md（v0.1）
> 负责人：产品组 / 研发
> 用途：作为「家账」客户端技术实现的单一事实来源（Single Source of Truth），记录技术选型、开发环境、调试流程、里程碑排期与上架盈利路径。后续可基于本文档持续补充。

---

## 1. 技术决策背景

- **目标平台**：iOS（iOS 26+），后续可扩展 Android。
- **核心约束**：离线优先记账、家庭多端协作、数据归家防串账（见 PRD §2.3、DATAMODEL §6）。
- **团队背景**：个人开发者，前端 React + TypeScript 为主，会用 Node 写 CRUD 后端，以 Cursor 为主要编程工具。
- **关键取舍**：不采用 iOS 26 Liquid Glass（液态玻璃）视觉，换取**最大化复用 React/TS 技能 + 跨平台潜力 + JS 层 OTA 热更新**。视觉采用**实心材质 + Light / Night 两种模式**（见 DESIGN.md）。

> 结论：客户端采用 **React Native（Expo）+ TypeScript**。

---

## 2. 技术选型总览

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 框架 | **Expo（React Native）+ TypeScript** | 对 React + TS 背景最友好，工具链成熟 |
| 路由 / 导航 | **expo-router** + **NativeTabs** | 文件式路由；原生 Tab Bar，对齐 IA §2 的「3 Tab + 独立 ➕」 |
| 状态管理 | **Zustand**（本地 UI 态）+ **TanStack Query**（服务端态/缓存） | 轻量，契合中小型应用 |
| 本地存储 / 离线 | **WatermelonDB** 或 **op-sqlite + Drizzle ORM** | 离线优先：本地 DB + 同步队列（见 §6） |
| 网络 | **fetch + TanStack Query** | 熟悉的请求/缓存模式 |
| 二维码 | 扫码 **expo-camera**；生成 **react-native-qrcode-svg** | 流程 3 / 4 |
| 动画 / 手势 | **react-native-reanimated** + **react-native-gesture-handler** | 滑动确认控件、庆祝动效 |
| 图表 | **Victory Native (XL)**（见 §3） | 报表环形 / 条形 / 折线 / 双柱图 |
| 安全存储 | **expo-secure-store** | Token / 登录态 |
| 推送（P1） | **expo-notifications** + APNs | MVP 仅做 App 内兜底通知 |
| OTA 热更新 | **EAS Update（expo-updates）** | JS 层 bug 免审核直推 |
| 后端 | **Node（自建 CRUD）** | 登录 / 家庭 / 流水同步 / 邀请码校验等 |

> 备注：当前不引入任何玻璃 / 半透明 / 模糊材质（见 DESIGN.md §1、§6）。若未来想要磨砂质感，可评估 `expo-blur` 的 `BlurView`；若想恢复 iOS 26 玻璃，可评估 `@callstack/liquid-glass` / `expo-glass-effect`（仅 iOS 26+、需 Dev Build）。

---

## 3. 报表图表方案

报表需求见 PRD §11.5、DESIGN §8.5：环形图（P0）、横向条形图 / 折线图 / 双柱图（P1）。

| 库 | 渲染 | 优点 | 代价 | 适合 |
| --- | --- | --- | --- | --- |
| **Victory Native (XL, v40+)** | Skia（GPU） | 性能强、组合式 API 像 React、TS 优先、饼/环/柱/折线全覆盖 | 需 Dev Build（Skia 原生模块） | 一套库覆盖现在 + 将来全部图表（**推荐**） |
| react-native-gifted-charts | SVG | props 式、上手快、可在 Expo Go 跑、含环形/柱/折线 | 大数据量性能一般 | 仅 MVP 环形图、想最快出活 |

**决策**：选 **Victory Native (XL)**，一步到位覆盖 P0 + P1，避免后期换库。

安装（一次装齐 peer 依赖）：

```bash
npx expo install victory-native @shopify/react-native-skia react-native-reanimated react-native-gesture-handler
```

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

# 6. Git（确认存在）
git --version
```

### 4.2 图形界面 / 账号

| 工具 | 说明 |
| --- | --- |
| **Xcode 26**（Mac App Store） | 约 12GB+；装完打开一次接受协议，再执行 `xcode-select --install` 与 `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer`；在 Xcode 内下载 **iOS 26 模拟器** |
| **Cursor** | 已在用。建议扩展：ESLint、Prettier、React Native Tools（可选） |
| **Apple Developer Program** | 99 美元/年。**仅在需要真机调试或上架时购买**，模拟器阶段无需 |
| Android Studio / JDK | **iOS-only 阶段无需安装**，未来做 Android 再装 |

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

1. **本地为唯一数据源**：所有读取走本地 DB，UI 先读本地、立即响应。
2. **流水创建即绑定 `family_id`**：本地写入时即写死当前家庭 `family_id`，不可变（防串账核心）。
3. **同步队列**：每条本地写操作（增 / 改 / 删）标记 `sync_status = pending` 入队，联网后按**原 `family_id`** 提交；即便用户期间已退出该家庭，服务端仍按原 `family_id` 入账。
4. **冲突处理**：储蓄目标用 `version` 乐观锁（DATAMODEL §4.1），冲突则刷新重试。
5. **同步态 UI**：离线用 `state/info` 轻提示「已保存，稍后同步」（DESIGN §8.6）。
6. **金额精度**：全程以「分」（bigint）传输，仅展示层做分↔元换算（DATAMODEL §1.2）。

---

## 7. 后端依赖

家庭协作、邀请码校验、户主唯一性、跨设备同步、家庭解散物理删除均依赖服务端事务，需与客户端并行推进。

- **接口范围**：登录（手机验证码 + Apple）、家庭 CRUD、成员关系流转、邀请码生成 / 校验、流水同步（增量 pull + 队列 push）、报表聚合、通知。
- **服务端须保证的约束**（DATAMODEL §6）：一人一家、户主唯一、成员上限 8、`TRANSACTION.family_id` 不可变、储蓄类流水口径、继任异议期单条 pending。
- **过渡策略**：后端未就绪时，先用本地 Mock 的 `RemoteAPI` 协议跑通客户端，接口契约对齐后替换。

---

## 8. 工程结构建议

```
app/                      # expo-router 路由（文件即页面）
  (tabs)/                 # 首页 / 报表 / 家庭
  modal/                  # 记账面板等模态
src/
  features/               # 按 PRD 流程切：auth / ledger / family / report / savings / budget / notification / settings
  components/             # 通用组件（<Money/>、SlideToConfirm、EmptyState…）
  theme/                  # 设计令牌（Light / Night 两套映射，对齐 DESIGN §3/§13）
  data/                   # 本地 DB 模型 + Repository + SyncEngine
  api/                    # RemoteAPI（含 Mock 实现）
  store/                  # Zustand stores
  lib/                    # 工具（金额换算、时区归月…）
```

---

## 9. 里程碑排期（对齐 MVP.md M0–M4）

> 与 MVP.md §4 的 M0–M4 批次一一对应。

| 批次 | 内容 | 客户端关键交付 |
| --- | --- | --- |
| **M0 地基** | 脚手架 + 设计令牌主题 + 本地 DB + API 层骨架 | TS 主题（Light/Night）、NativeTabs（3 Tab + 独立 ➕）、`<Money/>` 金额组件、空状态 |
| **M1 账号 + 记账** | 流程 1 登录（手机 / Apple）、流程 2 记一笔、流程 10 编辑 / 删除 | 记账 Sheet（大金额输入）、流水列表（按日分组 + 左滑）、离线同步队列 |
| **M2 家庭协作** | 流程 3 邀请二维码、流程 4 扫码加入、流程 5 转让 / 退出 / 解散、流程 13 关键通知 | expo-camera 扫码、qrcode-svg 生成、滑动确认控件、被移除全屏兜底 |
| **M3 基础报表** | 流程 9 基础版（本月收支结余 + 分类占比环形图） | Victory Native 环形图 + 分类明细下钻 |
| **M4 增值（P1）** | 分类管理 → 预算 → 储蓄目标 → 完整报表 / 月度总结 → 移除成员 → 通知体系 | 进度条 / 目标卡 / 庆祝动效、Banner、条形 / 折线 / 双柱图、APNs 推送 |

每批结束应可独立验收（与 MVP §4 一致）。

---

## 10. 上架与盈利路径

| 项目 | 事实（2026） |
| --- | --- |
| 开发者账号 | Apple Developer Program 个人版，**99 美元/年**，自动续费；以本人法定姓名上架，无需 D-U-N-S |
| 标准分成 | Apple 抽成 **30%** |
| 小企业计划 | 年收入 < 100 万美元 → 抽成降为 **15%**（App Store Small Business Program），新开发者亦可申请 |
| 订阅 | 即使不入计划，订阅满 1 年后自动降至 15%；入计划则第一天即 15% |
| 建议 | 上架后**第一时间申请小企业计划**，在 App Store Connect 接受最新 Paid Apps 协议并申报关联账号 |

> 上架与分成机制与具体技术栈无关（RN / 原生一致），不构成选型差异。

---

## 11. 技术风险与注意点

1. **离线编辑 / 删除的串账边界**：编辑跨家庭归属时必须按原 `family_id`（PRD §12.5），重点测试。
2. **被移除者实时踢出**：网络层统一拦截 401 / 踢出码，触发全屏提示（PRD §8.5）。
3. **账期时区**：归月 / 归日按 `FAMILY.timezone` 计算（PRD §2.5），不随成员所在地变化。
4. **可访问性**：Dynamic Type、VoiceOver、减弱动态、Light/Night 两套对比度（DESIGN §10），从组件层内建。
5. **图表性能**：Victory Native（Skia）需 Dev Build；大数据量时注意 Reanimated 共享值更新频率。
6. **OTA 边界**：EAS Update 仅能热更新 JS 层；改动原生模块仍需重新提审。

---

## 12. 待补充 / 后续迭代

- §13 后端接口契约（DTO / 错误码 / 同步协议）—— 与后端对齐后补充
- §14 本地 DB Schema 与 Repository 设计明细
- §15 CI/CD（EAS Build 自动化、版本号策略、灰度发布）
- §16 测试策略（单元 / 组件 / E2E：Jest + React Native Testing Library + Maestro）
- §17 性能与包体积优化
