# 家账 · 视觉设计规范 & 设计系统（DESIGN）

> 文档版本：v0.4.0（导航重构为 iOS 26 标准四 Tab + 记一笔浮钮 + 顶栏搜索；收支语义色按大陆惯例互换；Light 背景层级反转）
> 最后更新：2026-06-06
> 关联文档：PRD.md（v0.1.1，对应 §22）、IA.md、MVP.md、DATAMODEL.md、TECH.md
> 负责人：产品组 / 设计 / 客户端
> 用途：作为「家账」App 视觉与组件实现的单一事实来源（Single Source of Truth）。

---

## v0.4.0 变更摘要（相对 v0.3.1）

1. **底部导航重构**（§5.2）：废弃「药丸 + Search 独立圆 + 记一笔 BottomAccessory 三栏条 + 三状态」方案，改为 **iOS 26 标准四 Tab（首页 / 报表 / 家庭 / 我的）+「➕ 记一笔」悬浮圆钮**（Tab Bar 右上方，提醒事项式，全 Tab 常驻、语义统一为记账）。
2. **搜索入口**（§5.2）：移到**顶栏右上角图标**，点击进入搜索页；搜索页承接日期范围 / 分类 / 成员 / 关键词等筛选。
3. **今日格言**（§5.2 / §5.3）：随三栏条取消，**仅在记账面板顶部展示**。
4. **收支语义色互换**（§4.2.2）：按中国大陆惯例 **红=收入、绿=支出**；令牌名不变仅值映射，全球化按地区换值。
5. **背景层级反转**（§4.2.3 / §4.3）：Light 改为**纯白页面底 + 浅灰卡**（Night 不变）。
6. **顶栏标题规则**：左上显示当前 Tab 名（「我的」页除外，顶部为个人资料头）。

---

## v0.3.1 变更摘要（相对 v0.3）

1. **底部 Tab Bar 定稿**（§5.2）：药丸（首页/报表/家庭）+ 右侧独立 **Search 圆**（`role="search"`）；**记一笔 = `BottomAccessory` 三栏条**（今日配图 / 今日格言 marquee / ➕），整条可点弹记账面板。完全对齐最新版 Apple 播客的三状态：常态两行 / 搜索激活（药丸变搜索框、记一笔条隐藏）/ 滚动合并一行。
2. **搜索功能**：随独立 Search 圆一并确立；**搜索内容页先占位 ToDo**，首发简单支持「搜流水 / 分类 / 成员」，后续迭代增强。
3. **记账面板呈现定稿**（§5.3）：升级为 **大号 `.large` detent Sheet**（保留抓手 / 下滑关，非 `fullScreenCover`）+ **中性背景（不上分类色）** + **底部「今日格言」条**（与小条同源）。
4. **远期**（§16）：「格言从小条位移展开进全屏」共享元素转场列入远期，首发用同源 + 淡入。

---

## v0.3 变更摘要（相对 v0.2）

1. **确立实现策略**：UI 以 `@expo/ui/swift-ui`（原生 SwiftUI primitives）为默认实现方式；库无法满足时才退回自定义 RN / Skia / Reanimated（见 §1、§5）。
2. **材质规则重写**：原「全部实心、无玻璃」改为分层规则——**内容层保持实心（不主动施加 `glassEffect`）；系统 chrome（导航 / Tab / 原生 Sheet）顺应 iOS 26 系统材质（含 Liquid Glass）**，不与框架对抗（见 §3）。
3. **新增令牌可达性矩阵**：明确每个设计令牌如何通过 `@expo/ui/swift-ui/modifiers` 落到原生件，哪些只在自定义画布生效（见 §4.4）。
4. **新增组件落地映射表**：每个界面元素 → 优先用哪个 `@expo/ui` 组件 / 何时退回自定义（见 §5，本版核心）。
5. **平台范围收敛**：v1 为纯 iOS（`@expo/ui/swift-ui` 暂不支持 Android / Web）；移除 v0.2 的 Android 兜底色表，相关需求转远期（见 §2.1）。
6. **保留** v0.2 全部设计意图与令牌数值（色值 / 间距 / 圆角 / 金额规范 / 可访问性 / 庆祝规范），仅改变「如何落地」。

---

## 1. 设计语言与实现策略基线

### 1.1 实现策略：Native-First

- **平台基线**：iOS App，**React Native（Expo SDK 56）+ TypeScript**，UI 主体由 `@expo/ui/swift-ui` 渲染**真实原生 SwiftUI 视图**，视觉对齐 **iOS 26 设计规范（HIG）**。
- **核心原则（优先级从高到低）**：
  1. **能用 `@expo/ui/swift-ui` 原生件实现的，一律用原生件**（Button、List、Form、Section、TabView、BottomSheet、Picker、DatePicker、Toggle、Slider、ProgressView、Gauge、Text、Image 等）。
  2. 原生件能渲染但需要调样式的，**通过 `modifiers`（`@expo/ui/swift-ui/modifiers`）调整**，不绕过框架。
  3. **库确实做不到的**（自定义数字键盘、报表图表、礼花/庆祝粒子、滑动确认控件等），才退回**自定义 RN 组件 / `react-native-skia` / `react-native-reanimated`**，并经 `RNHostView` / `Host` 边界与原生界面拼接。
- **判定顺序**：做任一界面前，先问「`@expo/ui/swift-ui` 有没有对应组件？」→ 有则用 → 样式不够则加 modifier →（仅在）确实不行 → 自定义并在 §5 登记。

### 1.2 三类实现层（设计与工程的共同语言）

| 层                    | 渲染方式                             | 设计令牌如何作用                              | 典型界面                                                                       |
| --------------------- | ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------ |
| **L-Native 原生层**   | `@expo/ui/swift-ui` 原生 SwiftUI 件  | 通过 `modifiers` 传入（见 §4.4 矩阵）         | 设置 / 家庭 / 成员列表（Form/List）、按钮、开关、选择器、进度、原生 Sheet 外壳 |
| **L-Bridge 桥接层**   | 原生件包裹自定义内容（`RNHostView`） | 外壳令牌走原生 modifier，内部令牌走自定义画布 | 记账 BottomSheet（原生壳 + 自定义键盘）                                        |
| **L-Custom 自定义层** | RN `View`/`Text` / Skia / Reanimated | 令牌**全量生效**（直接读 theme 对象）         | 报表图表、礼花庆祝、滑动确认、金额大数键盘                                     |

> **工程纪律**：进入 `Host` 内部后**没有 flexbox / Yoga**，布局只能用 `HStack` / `VStack` / `Spacer`；自定义层才回到 RN 的 flexbox。两层切换必须显式跨 `Host` 边界。

### 1.3 品牌气质与核心张力

- **关键词**：温暖（Warm）、克制（Calm）、归属感（Belonging）。
- **核心张力与解法**：金融数据要「理性、精确、可信」，家庭场景要「柔软、有温度」。
  解法 = **结构理性（原生 iOS 组件骨架、8pt 节奏、等宽数字、清晰层级）+ 表皮柔软（中性留白、圆角、暖色手绘插画、收支柔和语义色）**。
- 原生件天然带来一致的 iOS 观感、Dynamic Type、VoiceOver、Light/Night、同心圆角，这些是 native-first 的「免费红利」，设计上应主动借力而非重造（见 §13、§15）。

### 1.4 与流程图配色的关系

PRD §2.4 的配色仅用于**流程图（Mermaid）绘制**，与界面视觉无关；本规范定义的是**产品界面视觉**，两者相互独立，不得混用。

---

## 2. 平台范围与读法

### 2.1 平台范围

- **v1：纯 iOS（iOS 26+）**。`@expo/ui/swift-ui` 当前仅支持 iOS / tvOS，Android（Jetpack Compose 映射）与 Web（DOM）在 Expo UI roadmap 上尚未到位。
- **Android / 多端**：列入远期。届时走 `@expo/ui/jetpack-compose` 平行映射，需另立一份组件映射表，本规范的「设计意图层」（色彩语义、金额规范、可访问性）可复用，「组件落地层」需重做。
- v0.2 的「Android 兜底色值」表在本版**作废**（纯 iOS 阶段优先用系统语义色，见 §4）。

### 2.2 三层令牌结构（沿用 v0.2，落地方式见 §4.4）

| 层  | 名称                   | 作用                                                          | 示例                                          |
| --- | ---------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| L1  | **原始令牌 Primitive** | 与语义无关的原始数值（调色板、刻度）                          | `gray/100`、`space/4`、`radius/lg`            |
| L2  | **语义令牌 Semantic**  | 表达「意图」，按 Light/Night 各映射一组 L1                    | `text/primary`、`bg/base`、`semantic/expense` |
| L3  | **组件意图 Component** | 描述某组件该用哪些 L2；落地时翻译为原生 modifier 或自定义样式 | `button.primary.bg → accent/primary`          |

> v0.3 中 L3 不再是「直接写给 RN style 的裸值」，而是「**组件应消费哪些语义令牌**」的说明；真正落地见 §4.4 与 §5。

---

## 3. 材质与 Liquid Glass 决策（本版重写）

### 3.1 背景

iOS 26 的系统材质是 **Liquid Glass**。原生 SwiftUI 的系统 chrome（`NavigationStack` 导航栏、`TabView` 标签栏、原生 `BottomSheet` / sheet、toolbar）**在系统层默认采用 Liquid Glass**，这是框架行为，强行全部抹掉等于放弃使用 `@expo/ui` 的价值。而 `glassEffect` 对**内容视图**是**显式 opt-in 的 modifier**（需 Xcode 26+ / iOS 26+）——不加就是实心。

### 3.2 决策：分层材质

| 区域                                                            | 材质规则                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **系统 chrome**（导航栏 / Tab Bar / 原生 Sheet 外壳 / toolbar） | **顺应 iOS 26 系统材质**（可含 Liquid Glass），不主动覆盖、不强制实心                    |
| **内容层**（卡片、流水行、报表、金额区、表单分组）              | **保持实心**：**不主动施加 `glassEffect`**，保证金额数字清晰可读、跨设备稳定             |
| **庆祝 / 特殊视觉**                                             | 可在插画背景上**点状使用** `glassEffect`（如目标达成卡），属克制的「温度释放点」，非默认 |

> 一句话：**系统外壳交给系统（含玻璃），内容主体保持实心，玻璃只在庆祝时刻按需点缀。**

### 3.3 海拔与分层（实心内容层如何不平淡）

- 内容层靠**三级灰阶 + 分隔线（`Divider` / `separator`）+ 极轻柔阴影（`shadow` modifier）**区分海拔（见 §10）。
- **Night 模式不靠阴影分层**：深底上阴影几乎不可见，改用**更亮一档的表面色**（`bg/card` < `bg/elevated`）+ 分隔线表达海拔（iOS 深色标准做法）。
- 原生 `Form` / `List` 自带分组背景与分隔，**优先使用其默认分层**，不重复造卡片。

---

## 4. 色彩系统（L1 原始 → L2 语义）

> 落地优先级：**iOS 系统语义色（原生件默认 / `color="secondary"` 等）> 经 modifier 传入的本表 hex 值**。系统语义色能自动适配 Light/Night 与对比度，应优先采用；需要品牌化或精确控制时再用 hex。

### 4.1 中性灰阶 ramp（L1，对齐 iOS systemGray）

| 原始令牌    | Light     | Night     | 对应 iOS 语义         |
| ----------- | --------- | --------- | --------------------- |
| `gray/0`    | `#FFFFFF` | `#000000` | systemBackground 反极 |
| `gray/50`   | `#F2F2F7` | `#1C1C1E` | systemGray6           |
| `gray/100`  | `#E5E5EA` | `#2C2C2E` | systemGray5           |
| `gray/200`  | `#D1D1D6` | `#3A3A3C` | systemGray4           |
| `gray/300`  | `#C7C7CC` | `#48484A` | systemGray3           |
| `gray/400`  | `#AEAEB2` | `#636366` | systemGray2           |
| `gray/500`  | `#8E8E93` | `#8E8E93` | systemGray            |
| `gray/900`  | `#1C1C1E` | `#F2F2F7` | label 近极            |
| `gray/1000` | `#000000` | `#FFFFFF` | label 纯极            |

> 原生件优先用 SwiftUI 语义色（如 `Image color="secondary"`、`foregroundStyle({type:'hierarchical', style:'secondary'})`）；上表为自定义画布与精确控制时的等价参考值。

### 4.2 语义令牌（L2）

#### 4.2.1 强调色（替代品牌色）

| 角色                 | 令牌               | Light             | Night             | 用途                                   |
| -------------------- | ------------------ | ----------------- | ----------------- | -------------------------------------- |
| 主强调               | `accent/primary`   | `#1C1C1E`（近黑） | `#F2F2F7`（近白） | 主 CTA、选中态、激活态、➕（若自定义） |
| 强调反色（按钮文字） | `accent/onPrimary` | `#FFFFFF`         | `#1C1C1E`         | 主按钮上的文字 / 图标                  |
| 浅强调底             | `accent/tint`      | `gray/50`         | `gray/100`        | 选中行 / 浅底 / 分段选中               |

> 落地：主按钮用原生 `Button` + `buttonStyle` + `background(accent/primary)` + `foregroundColor(accent/onPrimary)`；中性件用 `buttonStyle('plain')` 去掉系统默认蓝，再按需着色（见 §5.4）。

#### 4.2.2 收支语义色（柔和方案 · 核心）

| 语义         | 令牌               | Light               | Night     | 规则                   |
| ------------ | ------------------ | ------------------- | --------- | ---------------------- |
| 收入 Income  | `semantic/income`  | `#E2563D`（喜庆红） | `#FF7461` | 金额带 `+` 前缀 + 文案 |
| 支出 Expense | `semantic/expense` | `#2FA36B`（沉静绿） | `#46C98A` | 金额带 `-` 前缀 + 文案 |
| 结余 / 中性  | `text/primary`     | 主文本色            | 主文本色  | 不喜不忧               |

> ⚠️ **不能只靠颜色区分收支**（色盲可访问性）：必须同时用 `+/-` 符号与文案标签（见 §13）。金额文本经 `foregroundColor(semantic/*)` 着色。
> 中国大陆惯例：红=收入、绿=支出（红涨绿跌）。**令牌名不变**（`semantic/income`/`semantic/expense`），仅按地区映射色值；全球化时按地区换值（与区域适配层一致）。⚠️ `semantic/income` 现与 `state/danger` 同色系，同屏靠 `+/-` 号、图标与文案语境区分。

#### 4.2.3 中性色（映射 §4.1 / iOS 语义色）

| 令牌             | iOS 语义对应               | Light                 | Night                   | 用途                                  |
| ---------------- | -------------------------- | --------------------- | ----------------------- | ------------------------------------- |
| `text/primary`   | label                      | `#1C1C1E`             | `#FFFFFF`               | 主文本、金额                          |
| `text/secondary` | secondaryLabel             | `rgba(60,60,67,0.6)`  | `rgba(235,235,245,0.6)` | 备注、时间                            |
| `text/tertiary`  | tertiaryLabel              | `rgba(60,60,67,0.3)`  | `rgba(235,235,245,0.3)` | 占位、辅助                            |
| `bg/base`        | （见下注，非默认 grouped） | `#FFFFFF`             | `#000000`               | 页面底（Light 纯白 / Night 纯黑）     |
| `bg/card`        | （见下注）                 | `#F2F2F7`             | `#1C1C1E`               | 卡片 / 列表行（Light 浅灰卡浮于白底） |
| `bg/elevated`    | （见下注）                 | `#FFFFFF`             | `#2C2C2E`               | 浮层 / Sheet 内分组                   |
| `separator`      | separator                  | `rgba(60,60,67,0.29)` | `rgba(84,84,88,0.6)`    | 分隔线                                |

> ⚠️ 反转后 Light = 「白底 + 浅灰卡」，对应 iOS plain/inset 风格而非默认 grouped（默认 grouped 是灰底白卡，与此相反）。原生 `Form`/`List(.grouped)` 自动套用的是灰底白卡，**要达到白底灰卡需 `.listStyle(.plain)` 或自定义 `ScrollView` 背景 + 自绘卡片**（属 §4.4 可达性受限项）。次要文本仍优先用 `foregroundStyle` 的 hierarchical `secondary`。

#### 4.2.4 功能状态色

| 状态                  | 令牌            | Light             | Night     | 用途                                 |
| --------------------- | --------------- | ----------------- | --------- | ------------------------------------ |
| 警示（80% 预警）      | `state/warning` | `#F5A623`（琥珀） | `#FFB84D` | 预算预警条幅、临界提示               |
| 危险（超支 / 破坏性） | `state/danger`  | `#E2563D`         | `#FF7461` | 超支红条、解散 / 移除 / 注销二次确认 |
| 成功                  | `state/success` | `#2FA36B`         | `#46C98A` | 保存成功、目标达成                   |
| 信息                  | `state/info`    | `#4A90D9`         | `#5AA7F0` | 同步中、离线提示                     |

> 破坏性操作用「危险红」表达严重性，但**文案保持温和**（PRD §1.5）。原生 `ConfirmationDialog` 的破坏性项用 SwiftUI `role: 'destructive'`，颜色由系统给到红，与本令牌语义一致。

### 4.3 画布变体：Cool（默认）/ Warm（可选）

| 令牌        | Cool（默认）Light     | Warm（可选）Light     | Night                |
| ----------- | --------------------- | --------------------- | -------------------- |
| `bg/base`   | `#FFFFFF`             | `#FBFAF8`             | `#000000`            |
| `bg/card`   | `#F2F2F7`             | `#FFFFFF`             | `#1C1C1E`            |
| `separator` | `rgba(60,60,67,0.29)` | `rgba(70,60,50,0.22)` | `rgba(84,84,88,0.6)` |

> **v1 首发固定 Cool**（iOS 原生观感）。注意：原生 `Form`/`List` 的分组底色由系统语义色驱动，Warm 变体在原生件上**只能整体覆盖 `bg/base`（如用自定义 `ScrollView` 背景）**，对系统 grouped 背景的改写有限；故 Warm 暂定仅作用于自定义层与可控背景，作为远期完善项。（Warm 反转后其 card 需重新校准为暖灰，首发只用 Cool。）

### 4.4 令牌可达性矩阵（L1/L2 → `@expo/ui/swift-ui/modifiers`）

> 本表是 v0.3 的工程契约核心：说明每类令牌**在原生层如何落地**。modifiers 从 `@expo/ui/swift-ui/modifiers` 导入，以数组传入组件 `modifiers` prop。

| 设计令牌类别                  | 原生层落地方式（modifier / prop）                                       | 原生可达性   | 备注                                                                     |
| ----------------------------- | ----------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------ |
| 背景色 `bg/*`、`accent/*` 底  | `background('#hex')`                                                    | ✅ 完全      | 也可优先让 `Form`/`List` 用系统默认                                      |
| 文本色 `text/*`、`semantic/*` | `foregroundColor('#hex')` 或 `foregroundStyle({type:'color'...})`       | ✅ 完全      | 次要文本优先 `foregroundStyle({type:'hierarchical', style:'secondary'})` |
| 圆角 `radius/*`               | `cornerRadius(n)` / `clipShape('roundedRectangle')`                     | ✅ 完全      | iOS 26 同心圆角可用 containerConcentric（见 §6）                         |
| 间距 `space/*`                | `padding({all/horizontal/vertical/top/...})` + `HStack/VStack spacing`  | ✅ 完全      | 内部布局靠 stack spacing，无 flexbox                                     |
| 海拔 `elevation/*`            | `shadow({ radius, x, y, color })`                                       | ✅ 完全      | Night 降 opacity（见 §10）                                               |
| 尺寸 `frame`                  | `frame({ width, height })`                                              | ✅ 完全      | 图标圆底、固定尺寸元素                                                   |
| 字阶 `type/*`                 | `font({ size, weight, design })` + Dynamic Type                         | ✅ 大部分    | 等宽数字需 `design:'monospaced'` 或 monospacedDigit（见 §7）             |
| 描边 `border/*`               | `overlay` + 自定义边 / 自定义 modifier                                  | ⚠️ 部分      | 复杂描边可经「Extending with SwiftUI」自定义 modifier                    |
| 按钮样式                      | `buttonStyle('plain' / 'bordered' / 'borderedProminent' / 'glass' ...)` | ✅ 完全      | `'plain'` 去除系统默认蓝；glass 系需 iOS 26                              |
| 不透明度 `opacity/*`          | `opacity(n)`                                                            | ✅ 完全      | 禁用 / 遮罩 / 骨架；**禁止用来做玻璃**（见 §3）                          |
| 动效 `motion/*`               | `animation(Animation.spring/..., dep)`                                  | ✅ 部分      | 复杂庆祝动效走自定义层（Reanimated/Skia）                                |
| 分类彩色圆底                  | `frame` + `background('#hex')` + `clipShape`                            | ✅ 完全      | 见 §5 设置示例同款写法                                                   |
| 玻璃 `glassEffect`            | `glassEffect({ glass: { variant } })`                                   | ✅（限场景） | 仅庆祝 / 特殊点缀，内容层默认不加（§3）                                  |

> **不可达 / 走自定义层的**：报表图表、自定义数字键盘、礼花粒子、滑动确认、复杂自绘进度——见 §5 对应行。

---

## 5. 组件落地映射表（本版核心）

> 规则：**默认列首选 `@expo/ui/swift-ui` 组件**；「自定义」列仅在原生确实做不到时启用，且需在此表登记原因。

### 5.1 导航与容器

| 界面元素     | 首选原生件                             | 关键 modifier / prop            | 何时自定义                                             |
| ------------ | -------------------------------------- | ------------------------------- | ------------------------------------------------------ |
| 页面导航     | Expo Router Stack（`NavigationStack`） | 标题、large title 由系统给      | —                                                      |
| 顶栏头像入口 | toolbar item + `Image`（圆形头像）     | `clipShape('circle')` + `frame` | —                                                      |
| 分组容器     | `Form` / `Section`（带 header/footer） | 系统 grouped 背景 + 分隔线      | —                                                      |
| 列表容器     | `List` / `ScrollView` + `LazyVStack`   | 长列表用 Lazy\*                 | 超大流水列表性能可换 `@shopify/flash-list`（自定义层） |

### 5.2 底部导航（定稿：iOS 26 标准四 Tab + 悬浮记一笔钮）

**形态**

```
顶栏      ：左上＝当前 Tab 名标题（「我的」除外）；右上＝🔍 搜索图标 → 搜索页
Tab Bar  ：首页(house) 报表(chart.pie) 家庭(person.2) 我的(person.crop.circle) — 4 个导航 Tab
记一笔    ：➕ 悬浮圆钮，固定 Tab Bar 右上方（提醒事项式），全 Tab 常驻；点击 → 弹大号 detent Sheet（§5.3）
```

**视觉**

- Tab Bar 顺应 iOS 26 系统材质（Liquid Glass），系统负责；内容层保持实心。
- ➕ 浮钮：圆形 56×56，强调色 `#FF8A4C` 实底 + 白色 ➕（SF Symbols `plus`），轻柔投影；右边距 16。
- 搜索图标：顶栏右上 SF Symbols `magnifyingglass`；进入搜索页（流水 / 分类 / 成员 / 日期范围）。
- 顶栏标题：左上显示当前 Tab 名大标题；**「我的」页除外**（顶部为个人资料头，不放标题）。

**落地（实现层）**

| 元素          | 落地方式                                                                     |
| ------------- | ---------------------------------------------------------------------------- |
| 四 Tab        | `NativeTabs`（4 个 `NativeTabs.Trigger` + `Trigger.Icon` + `Trigger.Label`） |
| 顶栏搜索图标  | 导航栏 trailing item（`magnifyingglass`）→ push / present 搜索页             |
| ➕ 记一笔浮钮 | 自定义悬浮层（覆盖于内容与 Tab Bar 之上），`onPress` → 弹 Sheet（§5.3）      |
| 搜索内容页    | MVP 先占位 ToDo：搜流水 / 分类 / 成员 + 日期范围，后续增强（见 §16）         |

> 今日格言不再出现在底部，移入记账面板顶部（§5.3）。原 v0.3.1 的「三栏条 + 三状态 + NativeTabs alpha 联动 spike」随本方案废弃；四 Tab + 悬浮主操作钮为成熟模式，实现风险大幅降低。

### 5.3 记账面板（流程 2，最高频，L-Bridge 桥接层）

**呈现方式（定稿）**：从底部升起的 **大号 detent Sheet**（iOS `.large` detent，顶部留「父页压暗缝」+ 抓手，下滑即关）——**不是 `fullScreenCover`**。几乎占满屏以承载温度与留白，又保留 Sheet 的「快进快出」，契合「金额唯一必填、3 步内完成」（PRD §4）。

**背景**：中性 `bg/base` / `bg/card`（Light/Night），**不使用分类色背景**（已定，回归中性骨架）；温度交给格言、配图与分类图标圆底承载。

| 部位                          | 实现                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| 面板外壳                      | 原生 `BottomSheet`，`.large` detent + 抓手 + 顶部圆角，背后系统遮罩                                     |
| 支出/收入切换                 | 原生 `Picker`（segmented）                                                                              |
| **大号金额 + 自定义数字键盘** | **自定义层**（RN/Skia）经 `RNHostView` 嵌入——原生件无此交互；金额等宽、整数大/小数降一档（§8）          |
| 分类选择                      | 原生 `LazyHStack` + 彩色圆底 `Image`（`frame`+`background`+`clipShape`）                                |
| 时间 / 记账人 / 备注          | `DatePicker` ／ `Picker`·`Menu`（**单人家庭隐藏记账人**，PRD §4.4）／ `TextField`                       |
| 保存按钮                      | 原生 `Button` + `buttonStyle`，金额 > 0 才 enabled                                                      |
| **底部「今日格言」条**        | 今日格言（marquee：减弱动态停滚、可截断、VoiceOver 读全文）。**格言现仅在本面板展示**（底部已无格言条） |

> 区域对应：主内容区＝记账主体（金额/分类/字段/保存）；底部条＝今日格言。这是「原生壳 + 自定义内容」的标杆案例，其它需自定义输入的 Sheet 复用同一模式。
> （v0.4.0：原「格言从小条位移展开」共享元素转场随小条取消而失效，§16 对应远期项可删。）

### 5.4 按钮

| 类型         | 实现                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| 主 CTA       | `Button` + `background(accent/primary)` + `foregroundColor(accent/onPrimary)` + `cornerRadius(radius/md)` |
| 次要按钮     | `Button` + `buttonStyle('plain')` / `'bordered'` + `accent/tint` 底                                       |
| 破坏性       | `Button`（`role: 'destructive'`）/ 文字 `state/danger`                                                    |
| 列表内可点行 | `Button` + `buttonStyle('plain')`（去系统蓝）+ `HStack` 内容 + 末尾 `chevron.right`（见 §5 设置示例同款） |

### 5.5 进度类（预算 / 储蓄目标）

| 元素     | 首选原生件                        | 何时自定义                                                                                            |
| -------- | --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 线性进度 | `LinearProgress` / `ProgressView` | 需「80%→`warning`、100%+→`danger`」精确变色 + 2pt 粗描边时，可先尝试 `color` prop；不足则自定义层自绘 |
| 环形进度 | `CircularProgress` / `Gauge`      | 目标卡封面 + 进度环组合排版复杂时，自定义层（Skia）                                                   |

> **先做技术验证**：原生进度件的 tint / 粗细可控性确认后再定是否自定义。

### 5.6 表单 / 设置 / 家庭管理

| 元素          | 原生件                                       |
| ------------- | -------------------------------------------- |
| 开关          | `Toggle`                                     |
| 单选 / 下拉   | `Picker` / `Menu`                            |
| 日期          | `DatePicker`                                 |
| 折叠分组      | `DisclosureGroup`                            |
| 上下文菜单    | `ContextMenu`（长按成员等）                  |
| 二次确认弹窗  | `ConfirmationDialog`（破坏性项 destructive） |
| 密码/敏感输入 | `SecureField`                                |
| 分隔线        | `Divider`                                    |

### 5.7 图表（报表，L-Custom 自定义层）

`@expo/ui/swift-ui` **未暴露 Swift Charts**，全部图表走自定义层：

| 图表                | 实现                                                       |
| ------------------- | ---------------------------------------------------------- |
| 分类占比环形图      | `@shopify/react-native-skia` 自绘 Donut，中心显示总额      |
| 成员贡献条形图      | Skia / RN 自绘，`accent/tint` 填充 + `text/primary` 数值   |
| 趋势折线 / 收支双柱 | Skia 自绘，支出 `semantic/expense`、收入 `semantic/income` |

> 备选：若需深度原生图表，可经「Extending with SwiftUI」封装一个 Swift Charts 自定义组件并接入 modifiers 体系（远期评估）。**储蓄类流水不进消费占比 / 趋势图**（PRD 口径）。

### 5.8 反馈 / 庆祝 / 滑动确认

| 元素                | 实现                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| 顶部条幅 Banner     | 自定义层（RN）或原生 `Overlay`；预警 `state/warning`、超支 `state/danger`          |
| Toast / 同步态      | 自定义轻提示，`state/info`                                                         |
| **滑动确认控件**    | **自定义层**（Reanimated 手势）——原生无此件；到位触发 `impact` haptic（PRD §7/§8） |
| **礼花 / 庆祝粒子** | **自定义层**（Skia / Reanimated / Lottie）；可叠 `glassEffect` 点缀                |
| 空状态              | 暖色手绘插画（`Image`）+ 一句温暖引导 + 主 `Button`                                |

---

## 6. 间距、网格与圆角（L1 刻度）

- **基础栅格：8pt 网格**（4pt 半步）。原生层经 `padding()` 与 stack `spacing` 落地。

| 令牌       | 数值 | 典型用途                |
| ---------- | ---- | ----------------------- |
| `space/1`  | 4    | 图标-文字间隙           |
| `space/2`  | 8    | 元素内间距              |
| `space/3`  | 12   | 行内分组                |
| `space/4`  | 16   | **页边距 / 卡片内边距** |
| `space/5`  | 20   | 卡片间距                |
| `space/6`  | 24   | 分区间距                |
| `space/8`  | 32   | 大分区                  |
| `space/10` | 40   | 空状态留白              |
| `space/12` | 48   | 顶部 hero 留白          |

| 圆角令牌      | 数值 | 用途                        |
| ------------- | ---- | --------------------------- |
| `radius/sm`   | 8    | 标签、小按钮                |
| `radius/md`   | 12   | 输入框、小卡片、主按钮      |
| `radius/lg`   | 16   | 内容卡片（默认）            |
| `radius/lg+`  | 20   | 大内容卡片 / 目标卡         |
| `radius/xl`   | 28   | 模态面板（BottomSheet）顶部 |
| `radius/full` | 9999 | 头像、进度环、圆形元素      |

- **列表行高 ≥ 44pt；最小可点击区域 44×44pt**（原生件默认满足）。
- **同心圆角（iOS 26）**：原生容器可用 `containerConcentric`，嵌套圆角自动对齐——**用原生件即免费获得**，无需手算内圆角。

---

## 7. 字体与排版

- **字体**：中文 PingFang SC，英文 / 数字 SF Pro；**全程 Dynamic Type**（原生件默认支持）。
- **金额必须等宽数字**（Tabular / monospaced digit）——记账 App 硬规则。原生层经 `font({ design: 'monospaced' })` 或 SwiftUI `monospacedDigit()`（必要时自定义 modifier）实现；自定义层用等宽字体设置。

| 令牌               | 用途                     | 字号 | 行高 | 字重               |
| ------------------ | ------------------------ | ---- | ---- | ------------------ |
| `type/largeTitle`  | 大金额（结余、目标进度） | 34   | 41   | Bold（数字）       |
| `type/title1`      | 页面标题                 | 28   | 34   | Bold               |
| `type/headline`    | 卡片标题 / 分组头        | 17   | 22   | Semibold           |
| `type/body`        | 正文 / 流水主信息        | 17   | 22   | Regular            |
| `type/subheadline` | 备注 / 次要信息          | 15   | 20   | Regular            |
| `type/footnote`    | 时间 / 标签 / 辅助       | 13   | 18   | Regular            |
| `type/caption`     | 角标 / 最小辅助          | 12   | 16   | Regular            |
| `type/amountHero`  | 记账面板主金额           | 40   | 48   | Bold + Tabular     |
| `type/amountRow`   | 流水行金额               | 17   | 22   | Semibold + Tabular |

---

## 8. 金额展示规范

记账 App 的「主角」，原生层与自定义层统一一套：

- **符号**：支出 `-`、收入 `+`，取语义色；结余 / 中性取 `text/primary`。
- **整数 / 小数分级**：整数部分主字号主字重；**小数部分（含小数点）降一档字号 + 字重**（hero 40→28、Bold→Regular）。原生层可用两段 `Text`（不同 `font`）拼 `HStack`；自定义层直接排版。
- **千分位**：每三位加分隔；**等宽数字必开**。
- **币种位预留**：货币符号在金额左侧独立槽位（多币种远期）。

---

## 9. 图标系统

- **系统 / 功能图标**：一律 **SF Symbols**（原生 `Image systemName="..."`，自动适配粗细 / 深浅色）。
- **分类图标**：统一描边、单色可着色图标族 + §5.1 低饱和彩色圆底（`frame` + `background('#hex')` + `clipShape('roundedRectangle' / 'circle')`）。
- **品牌 / 庆祝插画**：暖色调手绘风格（家、屋檐、存钱罐、一家人），作为温度集中释放点。

| 令牌        | 数值 | 用途           |
| ----------- | ---- | -------------- |
| `icon/sm`   | 16   | 行内角标、辅助 |
| `icon/md`   | 20   | 列表次要图标   |
| `icon/base` | 24   | Tab、通用图标  |
| `icon/lg`   | 28   | 分类圆底内图标 |

### 9.1 分类识别色（功能识别色，非品牌色）

| 分类 | 令牌           | Light（圆底） | Night（降明度） |
| ---- | -------------- | ------------- | --------------- |
| 餐饮 | `cat/food`     | `#F4B183`     | `#C77E4F`       |
| 交通 | `cat/transit`  | `#8FB7E0`     | `#5E84AD`       |
| 购物 | `cat/shopping` | `#E6A0B8`     | `#B36E86`       |
| 居家 | `cat/home`     | `#A8C8A0`     | `#74976E`       |
| 医疗 | `cat/medical`  | `#9AB0E0`     | `#6A80AD`       |
| 储蓄 | `cat/saving`   | `#C7B299`     | `#94806A`       |
| 其他 | `cat/other`    | `gray/300`    | `gray/300`      |

### 9.2 头像规则

- 无自定义头像时用**系统默认头像占位**，**不取用户名首字生成字符头像**。
- 圆形（`clipShape('circle')`），用于顶栏入口、记账人标记、成员列表、成员贡献图。
- 多人家庭显示记账人头像；**单人家庭隐藏记账人字段**（PRD §4.4）。

---

## 10. 海拔与阴影（克制）

| 令牌          | 阴影规格                         | 用途                   |
| ------------- | -------------------------------- | ---------------------- |
| `elevation/0` | 无阴影，仅 `Divider`             | 内容层卡片默认（贴底） |
| `elevation/1` | `shadow(radius:8, y:1, 黑 8%)`   | 列表浮起卡、轻浮层     |
| `elevation/2` | `shadow(radius:16, y:2, 黑 10%)` | 强浮起元素             |

> 系统 chrome 的海拔由系统材质负责，不手动加阴影。**Night 模式**把阴影 opacity 降到 ≤ 4%，改用更亮表面色（`bg/card` < `bg/elevated`）表达海拔。

---

## 11. 不透明度、层级、动效

### 11.1 不透明度（仅状态 / 遮罩 / 骨架，**禁止做玻璃**）

| 令牌               | 值        | 用途              |
| ------------------ | --------- | ----------------- |
| `opacity/disabled` | 0.35      | 禁用态控件        |
| `opacity/pressed`  | 0.12      | 按压叠加层        |
| `opacity/scrim`    | 0.40      | 弹窗 / Sheet 遮罩 |
| `opacity/skeleton` | 0.08–0.16 | 骨架屏闪烁        |

### 11.2 动效（原生优先 `animation`，复杂走自定义）

| 令牌                 | 值       | 用途                  |
| -------------------- | -------- | --------------------- |
| `motion/tap`         | 100ms    | 按压反馈              |
| `motion/micro`       | 150ms    | 小元素出现 / 选中     |
| `motion/base`        | 250ms    | 标准过渡 / Sheet 切换 |
| `motion/emphasized`  | 350ms    | 页面 / Sheet 转场     |
| `motion/celebration` | ≤ 1500ms | 庆祝动效上限          |

- 系统转场（Sheet 上滑、Push）用原生默认；原生件内动效用 `animation(Animation.spring(...), dep)`。
- **Haptics**：保存成功 `success`、达成目标 `success` 重、删除 `warning`、滑动确认到位 `impact`（经 `expo-haptics`）。
- **减弱动态（Reduce Motion）**：所有 `motion/*` 退化为即时 / 淡入；庆祝粒子改静态文案，时长归零。

---

## 12. 暖心时刻 Celebration（统一规范）

| 触发点（PRD）       | 视觉                                               | 文案来源                    | 实现层   |
| ------------------- | -------------------------------------------------- | --------------------------- | -------- |
| 首次记账（§4.3）    | 面板内轻量缩放 + 礼花                              | 固定欢迎文案                | 自定义层 |
| 储蓄目标达成（§9）  | 进度环高亮 + 礼花 + 暖色插画（可叠 `glassEffect`） | 目标相关文案                | 自定义层 |
| 月度总结生成（§11） | 首页条幅 + 进入总结卡                              | 暖心文案池随机（PRD §11.8） | 自定义层 |

- 统一规格：暖色手绘插画 + 克制粒子，时长 ≤ `motion/celebration`，`success` haptic。
- **尊重减弱动态**：粒子退化为静态插画 + 文案。
- 度的把握：点到为止，不阻断主流程、不强制全屏停留。

---

## 13. 可访问性（强约束）

- 文本对比度 ≥ WCAG AA（正文 4.5:1，大字 3:1）；Light / Night 各自验证。
- **收支不只靠颜色**：必带 `+/-` 与文案。分类色为辅助识别，必带名称。
- **Dynamic Type、VoiceOver、减弱动态、Light/Night** 全面支持——原生件默认提供，**自定义层须自行补齐 VoiceOver 标签与 Dynamic Type 适配**（这是 native-first 下自定义层的额外义务）。
- 触控目标 ≥ 44×44pt。

---

## 14. UI 模式（Light / Night）

- 统一提供 **Light / Night**，跟随系统或手动切换；原生件自动适配，自定义层读 `theme.light / theme.dark`。
- 主强调色自动反相（Light 近黑 / Night 近白）。
- Night：用系统深色语义底；分类色降明度保低饱和；海拔以更亮表面色表达；阴影 opacity ≤ 4%。

---

## 15. Native-First 的红利与义务（落地提醒）

| 免费红利（用原生件即得）                       | 自定义层的额外义务                         |
| ---------------------------------------------- | ------------------------------------------ |
| Dynamic Type、VoiceOver、Light/Night、同心圆角 | 须自行补齐无障碍标签、字号适配、深浅色切换 |
| iOS 26 一致材质与系统转场                      | 须自管材质一致性，勿与系统 chrome 风格脱节 |
| 系统语义色自动对比度达标                       | 须自测对比度（含 Warm 变体）               |
| `Form`/`List` 自带分组背景与分隔               | 自绘卡片须自管分隔与海拔                   |

---

## 16. 远期可扩展性预案

| 远期能力        | 预留                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 引入品牌色      | 将 `accent/primary` 语义令牌重映射为品牌橙（如 `#FF8A4C`），`accent/onPrimary` 设白；原生层只改传给 modifier 的色值，全局生效             |
| Android / 多端  | 走 `@expo/ui/jetpack-compose` 平行映射，复用本规范设计意图层                                                                              |
| 格言位移转场    | 记一笔小条的「今日格言」原地位移展开进全屏弹层（共享元素转场）；首发用「同源 + 淡入」，待 Reanimated 跨 RN↔原生模态转场稳定后再做（§5.3） |
| NativeTabs 退路 | 若 `unstable-native-tabs` alpha 阶段不稳，临时退回自定义 RN Tab Bar（自定义层，牺牲原生玻璃），登记为「过渡例外」                         |
| 原生图表        | 经「Extending with SwiftUI」封装 Swift Charts 接入 modifiers                                                                              |
| 账单导入        | 流水行预留「来源标签」（复用 `icon/sm`）                                                                                                  |
| 多币种          | 金额组件已预留币种符号位（§8）                                                                                                            |

---

## 17. 设计令牌速查表（摘要）

```
// —— L1 原始 ——
gray: 0/50/100/200/300/400/500/900/1000   （Light↔Night 见 §4.1）
space: 1=4 2=8 3=12 4=16 5=20 6=24 8=32 10=40 12=48
radius: sm8 / md12 / lg16 / lg+20 / xl28 / full
icon: sm16 / md20 / base24 / lg28 ；touchTarget 44
elevation: 0(无) / 1(r8 y1 黑8%) / 2(r16 y2 黑10%)
opacity: disabled .35 / pressed .12 / scrim .40 / skeleton .08–.16
motion: tap100 micro150 base250 emphasized350 celebration≤1500
font: PingFang SC + SF Pro；金额=Tabular 等宽

// —— L2 语义（浅 / 深）——
accent/primary    #1C1C1E / #F2F2F7      accent/onPrimary #FFFFFF / #1C1C1E
accent/tint       gray/50 / gray/100
semantic/expense  #E2563D / #FF7461 （带 -）   semantic/income #2FA36B / #46C98A （带 +）
state/warning #F5A623 / #FFB84D   state/danger #E2563D / #FF7461
state/success #2FA36B / #46C98A   state/info   #4A90D9 / #5AA7F0
text / bg / separator → §4.2.3 ；cat/* → §9.1 ；头像 → §9.2（系统默认，不取首字）

// —— 实现策略 ——
default: @expo/ui/swift-ui 原生件 + modifiers（§4.4 矩阵）；底部 Tab Bar 用 expo-router NativeTabs（iOS 26 Liquid Glass）
fallback: 自定义 RN / Skia / Reanimated（图表 / 数字键盘 / 礼花 / 滑动确认 / NativeTabs alpha 不稳时退自定义 Tab Bar）
Tab Bar: 药丸（首页/报表/家庭）+ 右独立 Search 圆（role="search"）；记一笔 = BottomAccessory 三栏条（配图/格言↔/➕，常驻，搜索激活时隐藏）；三状态见 §5.2
记账面板: 大号 detent Sheet（.large，非 fullScreenCover）+ 中性背景 + 底部格言条（§5.3）
材质: 系统 chrome 顺应 iOS 26（含 Liquid Glass）；内容层实心，不主动加 glassEffect
平台: v1 纯 iOS（iOS 26+）；UI 模式 Light / Night；画布 v1 固定 Cool
```

---

## 18. 关键 modifier 速记（工程参考）

> 全部从 `@expo/ui/swift-ui/modifiers` 导入，传给组件 `modifiers={[...]}`。

```
background('#hex')                              背景色
foregroundColor('#hex')                         文本/图标色
foregroundStyle({type:'hierarchical', style:'secondary'})  次要文本（推荐）
cornerRadius(n) / clipShape('roundedRectangle'|'circle')   圆角/裁形
padding({ all|horizontal|vertical|top|bottom|leading|trailing })  内边距
frame({ width, height })                        固定尺寸
shadow({ radius, x, y, color })                 阴影（海拔）
font({ size, weight, design:'monospaced' })     字阶 / 等宽数字
buttonStyle('plain'|'bordered'|'borderedProminent'|'glass')  按钮样式
opacity(n)                                      不透明度（禁做玻璃）
glassEffect({ glass:{ variant:'clear'|'regular' } })  仅庆祝/点缀，需 iOS 26
animation(Animation.spring({duration}), dep)    原生动效
```

> 布局：进入 `Host` 后无 flexbox，用 `HStack`/`VStack`/`Spacer` + `spacing`；跨回 RN 自定义内容需经 `RNHostView` 或重新包 `Host`。
