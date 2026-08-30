## 1. 基建与开发方案

- [x] 1.1 在 `src/i18n/开发方案.md` 写入经拍板的多语言开发方案（与 OpenSpec design 对齐，供实现对照）
- [x] 1.2 使用 `npx expo install expo-localization`，并安装 `i18next`、`react-i18next`
- [x] 1.3 配置 `app.json`：`expo-localization` plugin（`supportedLocales`、`supportsRTL: false`）以及 `locales` 中英显示名与权限说明
- [x] 1.4 建立 `src/i18n` 初始化、短码 ↔ `zh-Hans`/`en` 映射、JSON 命名空间与 TypeScript 资源类型

## 2. 语言偏好与设置开关

- [x] 2.1 实现 `LocalePreferenceProvider`（AsyncStorage、设备语言默认、`changeLanguage`）
- [x] 2.2 挂到根布局，并使 NativeTabs 使用当前语言标签（`useLocalePreference` 订阅重渲染；不加 `key={locale}` 以免 remount）
- [x] 2.3 将「我的 → 语言」改为真实切换，移除 Toast 占位

## 3. 文案、分类、日期与法律

- [x] 3.1 补齐 `zh-Hans` / `en` 资源（common、tabs、home、record、report、family、settings、auth、help、legal、notifications、categories）
- [x] 3.2 主路径页面/Sheet 改为 `t()`，保留用户生成内容原文
- [x] 3.3 系统分类显示名映射；搜索同时命中存库名与显示名
- [x] 3.4 `format.ts` 问候语与人性化日期跟随语言；金额仍为 `¥`
- [x] 3.5 帮助 FAQ 与用户协议 / 隐私政策英文进包

## 4. 推送语言

- [x] 4.1 新增 migration：`device_tokens.locale`，并扩展 `register_device_token(p_locale)`
- [x] 4.2 更新手写 `database.types.ts` 与客户端注册，切语言时重报 locale
- [x] 4.3 `push-fc` 按令牌 locale 选择中英模板，非法值回落中文
- [x] 4.4 App 内通知中心 `describe()` 走客户端 i18n

## 5. 文档与验证

- [x] 5.1 更新 PRD / DESIGN / IA / TECH / DATAMODEL 中语言与推送口径
- [x] 5.2 为 locale 解析、分类显示名、搜索双语命中补充单元测试
- [x] 5.3 运行 `pnpm test`、`pnpm exec tsc --noEmit` 与相关 lint
- [x] 5.4 缓存数据密集页面的分类显示名与日期 formatter，降低语言切换的重算成本
