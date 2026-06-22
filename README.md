# 家账 HomeBook

家庭协作记账 iOS App（Expo SDK 56 + React Native + TypeScript，后端 Supabase）。
产品 / 技术文档见 [`docs/`](docs/)（PRD / MVP / IA / DESIGN / DATAMODEL / TECH）。

## 本地开发与构建

> 平台：iOS（模拟器开发）。首次需安装依赖：`pnpm install`（项目用 pnpm）。

### 日常开发（改 JS / TSX）

```bash
npm run dev        # 启动 Metro（dev-client 模式）
```

App 已装在模拟器上时，改 `.tsx` 走 Fast Refresh 自动刷新，**无需重编原生**。

### 重新编译原生 App（加了原生模块 / 模拟器崩溃或被重置时）

```bash
npm run ios:sim        # 编译（模拟器，免签名）+ 安装 + 启动到「已启动的模拟器」
npm run ios:sim:clean  # 救援版：重装 Pod（源码模式）+ 清构建缓存 + 重编。pod/codegen 乱了时用
```

### ⚠️ 重要约束

- **不要用 `npm run ios`（`expo run:ios`）**：在当前 Xcode 26 / iOS 26 模拟器上，`@expo/cli` 会把模拟器误判成真机、索要签名证书而失败。统一用 `npm run ios:sim`。
- **`ExpoModulesCore` 必须从源码编译**：`ios/Podfile.properties.json` 里的 `"EXPO_USE_PRECOMPILED_MODULES": "false"` 不能丢，否则启动会 dyld 崩溃（`Symbol not found: ExpoModulesCore.Record.from`）。`npx expo prebuild --clean` 会冲掉这行——若跑了它，需补回该行并执行 `npm run ios:sim:clean`。
- **改了 `app.json` 的 `plugins` / 任何原生配置后，必须先 `npx expo prebuild -p ios` 再 `npm run ios:sim`**：config 插件（权限文案、原生模块配置等）只在 prebuild 阶段写进 `ios/`；`npm run ios:sim` 是纯 `xcodebuild`，**不会跑插件**，直接重编会出现「代码看着对、原生没生效」。典型坑：加了 `expo-image-picker` 但只跑 `ios:sim`，`Info.plist` 缺 `NSPhotoLibraryUsageDescription`，一选图就被系统按隐私违规 `SIGABRT` 闪退（TCC 崩溃）。⚠️ prebuild **不要带 `--clean`**（见上一条，会冲掉 precompiled 配置）。
- 后端迁移（`supabase/migrations/`）数据库端口被墙，**用 Supabase Studio SQL Editor 按编号顺序粘贴执行**，不要用 CLI 直推。

App 源码在 **`src/app`**（[expo-router](https://docs.expo.dev/router/introduction) 文件式路由）+ **`src/features`** / **`src/api`** / **`src/lib`**。

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

### Other setup steps

- To set up ESLint for linting, run `npx expo lint`, or follow our guide on ["Using ESLint and Prettier"](https://docs.expo.dev/guides/using-eslint/)
- If you'd like to set up unit testing, follow our guide on ["Unit Testing with Jest"](https://docs.expo.dev/develop/unit-testing/)
- Learn more about the TypeScript setup in this template in our guide on ["Using TypeScript"](https://docs.expo.dev/guides/typescript/)

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
