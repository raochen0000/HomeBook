## Why

家账的「我的 → 语言」已有简体中文 / English 交互壳，但选 English 只 Toast「暂仅支持简体中文」。产品要对非中文用户可用，且系统推送、法律文案也要跟界面语言一致。现在补上真正的中英双语，完成 PRD §18.3.5 后置的 i18n。

## What Changes

- 接入 `expo-localization` + `i18next` + `react-i18next`，把界面壳、主路径文案、日期人性化标签、系统分类显示名、FAQ、用户协议与隐私政策改为按当前语言渲染。
- 「我的 → 语言」真正切换并持久化；首次无存档时：设备语言为中文（`zh*`）用简体中文，其余用 English。
- 系统分类库内中文名不变；英文 UI 显示 Dining / Salary 等翻译名；搜索同时命中存库名与显示名。
- `device_tokens` 增加 `locale`；注册/切语言时上报；`push-fc` 按设备语言发中文或英文系统推送。
- `app.json` 声明 `zh-Hans` / `en` 的显示名与权限说明；开发方案单独放在 `src/i18n/开发方案.md`。
- 同步更新 PRD / DESIGN / IA / TECH / DATAMODEL，去掉「语言仅占位」口径。

## Capabilities

### New Capabilities

- `app-locale`: 语言解析、本机持久化、设置内切换，以及原生 Tab / 权限文案如何跟随语言。
- `ui-copy-i18n`: 主路径 UI、日期标签、系统分类显示名、搜索双语命中、FAQ 与法律文案的中英资源。
- `push-locale`: 设备令牌携带 locale，系统推送按该语言投递。

### Modified Capabilities

- 无。现有 `home-*` 规格不改需求，只换文案来源。

## Impact

- 客户端：`src/i18n/`、根布局 Provider、「我的」语言行、Tab 标签、主路径页面/Sheet、`format.ts`、分类显示与搜索、法律 Sheet、FAQ、`app.json` locales。
- 后端：`device_tokens.locale` migration、`register_device_token` 增加 `p_locale`、手写 `database.types.ts`、`services/push-fc` 双语模板。
- 依赖：`npx expo install expo-localization`；纯 JS 的 `i18next` / `react-i18next`。`expo-localization` config plugin 需要新的原生构建。
- 文档：`docs/PRD.md`、`DESIGN.md`、`IA.md`、`TECH.md`、`DATAMODEL.md`。
