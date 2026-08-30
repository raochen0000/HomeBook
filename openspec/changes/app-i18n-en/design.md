## Context

「我的 → 语言」已有简体中文 / English 行内菜单，但 `selection` 写死 `zh`，选 English 只 Toast。界面、FAQ、法律文案、日期标签、系统分类名、系统推送全部硬编码中文。深色模式已用 `ThemePreferenceProvider` + AsyncStorage 做本机个人偏好，语言应对齐这套，不进家庭数据。

约束：Expo SDK 56；系统分类名被储蓄 RPC 按中文查找，不能改库内 `name`；`expo-localization` 带 config plugin，权限与桌面名需要新二进制；用户备注 / 自定义分类 / 家庭名保持原文。

产品拍板：完成标准为 P1 主路径双语；设备非中文默认 English；系统分类显示翻译名；法律英文直接进包；系统推送本期按设备语言投递。详细开发方案见 `src/i18n/开发方案.md`（实现时的单一操作说明，本文件只定架构决策）。

## Goals / Non-Goals

**Goals:**

- 应用内中英切换即时生效，重启后保持。
- 无存档时：设备 `languageCode` 以 `zh` 开头 → `zh`，否则 → `en`。
- 主路径（登录、四 Tab、记一笔、流水、家庭、报表壳、设置/账号、帮助、关于、法律）无硬编码中文壳文案。
- 系统分类仅翻译展示；搜索同时命中存库名与当前语言显示名。
- 系统推送标题/正文按 `device_tokens.locale` 选择中文或英文。

**Non-Goals:**

- 不做繁体、不做「跟随系统」第三选项。
- 不翻译用户生成内容；不改系统分类库内中文名；不改储蓄 RPC。
- 不改红收入 / 绿支出，不改货币符号 `¥`。
- 不把语言偏好同步到云端用户表。
- 不做短信 / 邮件模板双语；不做 App Store 产品页本地化。
- 不把预算预警 `payload.text` 服务端中文句改为结构化 payload（英文推送对该类用通用英文兜底，App 内通知中心标题走客户端模板）。

## Decisions

### 1. i18next + react-i18next + expo-localization

PRD §18.3.5 已定该组合。SDK 56 的 Localization 指南把 `react-i18next` 列为正式可选库。`useTranslation()` 让切语言时 React 树重渲染，不必每次 `Updates.reloadAsync()`。

备选：`i18n-js` 更轻，但缺少 React 订阅与复数；Lingui 抽取更好，但要 compile 流水线。两种语言、现有硬编码量，i18next 足够。

资源放 `src/i18n/{zh-Hans,en}/*.json`，命名空间按域拆分（`common`、`tabs`、`home`、`record`、`report`、`family`、`settings`、`auth`、`help`、`legal`、`notifications`、`categories`）。语言码对 i18next 用 `zh-Hans` / `en`；设置 UI 与 `device_tokens.locale` 用短码 `zh` / `en`。

### 2. 语言偏好对齐深色模式

`LocalePreferenceProvider` 读/写 `homebook.locale-preference.v1`。无存档则用 `getLocales()[0].languageCode`：`zh*` → `zh`，否则 `en`。用户选择后只认存档。不写 Supabase。

切语言：`i18n.changeLanguage()` + `LocalePreferenceProvider` 状态。现有页面仍有全局 `t()` 调用，NativeTabs / SwiftUI Host 不会把新文案写进已挂着的原生树，所以根导航用 `key={locale}` 整棵重挂，再 `replace` 回切语言前所在路由。不默认整包 `Updates.reloadAsync()`。

系统权限弹窗跟 iOS「每 App 语言」，JS 改不了。`expo-localization` plugin 声明 `supportedLocales: { ios: ["zh-Hans", "en"] }`，`supportsRTL: false`。`app.json` `locales` 提供 `CFBundleDisplayName` 与相机/相册用法说明。

### 3. 系统分类只做显示映射

客户端用「中文存库名 → code」表（`food`、`salary`、`savingIn`…），`t('categories.<code>')` 出显示名。`is_system === false` 原样显示。不为分类加 `code` 列（避免本期 migration 扩散）；储蓄 RPC 继续按中文名查找。

搜索 `SearchContext` 对系统分类同时放入存库名与翻译名，关键词打任一即可。

### 4. 日期与金额

`format.ts` 的问候语、今天/昨天、`M月` 改走 `i18n.t` + `Intl.DateTimeFormat`（locale 为 `zh-CN` / `en-US`）。金额仍 `¥` 与两位小数，不跟语言变币种。调用点在 render 中执行，以便切语言后刷新。

### 5. 推送 locale 挂在设备令牌上

`device_tokens` 增 `locale text not null default 'zh' check (locale in ('zh','en'))`。`register_device_token` 增加带默认值的 `p_locale`，旧三参数调用仍合法。客户端注册与切语言时传入当前短码。`push-fc` 读令牌 `locale` 选择中/英模板；未知或空回落 `zh`。同一用户多设备可不同语言。

App 内通知中心 `describe()` 用客户端 `t()`，不依赖推送模板。

### 6. 法律与帮助进同一套资源

FAQ 与用户协议 / 隐私政策的英文译文进 `help.json` / `legal.json`，与中文一并打进包。公开网页 `docs/public-site` 不在本期改（仍中文站点）。

## Risks / Trade-offs

- [英文更长导致 Tab / 列表截断] → 短词（Home / Me / Family）；真机中英各走主路径。
- [NativeTabs / SwiftUI Host 不随 JS 语言刷新] → 根导航 `key={locale}` 重挂，并还原当前路由。不默认整包 reload。
- [权限说明与应用内语言不一致] → 声明 `supportedLocales`；文档写明系统弹窗跟 iOS 每 App 语言。
- [漏网硬编码中文] → P1 文件清单回归；`format` / 分类 / 搜索补单测。
- [旧客户端不传 `p_locale`] → 列默认 `zh`，函数参数有 default。
- [预算预警 payload 仍是中文] → 推送英文用通用句；完整结构化 payload 后置。
- [expo-localization 需新二进制] → 权限与桌面名不能只靠 OTA；提醒用户重编。

## Migration Plan

1. 部署 `device_tokens.locale` migration 与更新后的 `register_device_token`（Studio SQL；旧行得 `zh`）。
2. 发布客户端：新包带 i18n 与 `p_locale`；旧包不传 locale，推送仍中文。
3. 部署 `push-fc` 双语模板。顺序：先 DB，再 FC，再客户端，避免新客户端写入 locale 而旧 FC 忽略。
4. 回滚客户端：旧包忽略新列。回滚 FC：只发中文。回滚 DB：先停新客户端再 drop 列（一般不必）。

## Open Questions

无。五项产品拍板已记录在 `src/i18n/开发方案.md`。
