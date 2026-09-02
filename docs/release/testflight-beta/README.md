# HomeBook TestFlight Beta 真机测试

这份文档用于把 HomeBook 的 iOS Beta 版本安装到真实 iPhone 上测试，并在修复或优化后，把新版本持续推送给同一批测试者。

## 适用范围

- iOS App：HomeBook（App Store Connect 中显示为“家账·家庭记账”）
- Bundle Identifier：`com.raochen.homebook-app`
- 构建方式：EAS production profile
- 分发方式：App Store Connect → TestFlight → 内部测试组 `Team (Expo)`

> TestFlight 是 Beta 分发渠道，不是 App Store 正式上架。测试构建会在上传后 90 天过期。

## 核心概念

| 名称       | 用途                                                            |
| ---------- | --------------------------------------------------------------- |
| EAS Build  | 在云端生成已签名的 `.ipa` 安装包。                              |
| EAS Submit | 把已有 `.ipa` 上传到 App Store Connect；不等于提交 App Review。 |
| TestFlight | 将 App Store Connect 中的构建分发给测试者，并收集崩溃与反馈。   |
| 公开版本   | 面向所有 App Store 用户的版本，必须另行提交 App Review。        |

EAS 构建详情页提供的 `.ipa` 链接只用于下载归档或手动上传的备用方案；不要把它当作普通用户安装链接传播。

## 首次 Beta 构建与分发

### 1. 构建生产候选包

在项目根目录执行：

```bash
pnpm exec eas build --platform ios --profile production
```

生产 profile 已开启 `autoIncrement`，EAS 会自动递增 iOS 构建号。

### 2. 上传至 App Store Connect

构建完成后执行：

```bash
pnpm exec eas submit --platform ios
```

按提示选择刚构建完成的 iOS Build。首次提交时：

- 若 EAS 询问是否生成 App Store Connect API Key，首次配置选择 **Yes**；
- 如果询问是否复用刚生成的 Key，选择 **Yes**；
- 不要下载、提交或粘贴 API Key 的 `.p8` 私钥。

上传成功后，等待 Apple 处理完成，再在 App Store Connect → HomeBook → **TestFlight** 中查看构建。

### 3. 分配给内部测试组

进入 App Store Connect → HomeBook → TestFlight → **Team (Expo)**：

1. 确认测试者已在该组内；
2. 确认最新构建已分配给该组；
3. 如果未自动分配，点击 **添加构建（Add Builds）**，选择最新构建；
4. 填写“测试内容”，明确本次希望验证的修复或功能。

内部测试不需要 TestFlight Beta App Review。外部测试者才可能需要 Apple 的 Beta 审核。

### 4. 在 iPhone 安装

1. 在 iPhone 安装 Apple 的 **TestFlight** App；
2. 使用收到邀请的 Apple Account 登录；
3. 接受邀请后，安装“家账·家庭记账”；
4. 在 TestFlight 中记录本次测试的 `版本号（构建号）`，例如 `1.0.0 (1)`。

## 每轮 Beta 真机测试清单

每个新构建至少完成以下检查，并记录构建号、设备型号和 iOS 版本。

### 登录与网络

- [ ] 邮箱注册确认与登录；
- [ ] 找回密码、换绑邮箱及验证码/链接流程正常；
- [ ] 生产构建访问目标 `https://<project-ref>.supabase.co`，不能访问旧 `api.homebook-app.com`、裸 IP 或 HTTP；
- [ ] 弱网、断网、恢复网络后数据状态符合预期；
- [ ] Apple 登录、绑定与解绑；

### 核心功能与系统能力

- [ ] 新增、编辑、删除账目，数据同步正常；
- [ ] 图片/相机权限与上传流程正常；
- [ ] 推送权限申请、通知接收和点击跳转正常；
- [ ] 账户删除流程可完成；
- [ ] 冷启动、前后台切换及登录状态恢复正常；
- [ ] 不出现明显崩溃、白屏、阻断操作或数据错误。

### Bug 记录模板

每个问题至少记录：

```text
构建：1.0.0 (2)
设备 / iOS：iPhone 15 Pro / iOS 26.x
前置条件：
复现步骤：
期望结果：
实际结果：
截图或录屏：
是否可稳定复现：
```

## 修复或优化后的更新流程

Beta 阶段每次修复都发布为**同一公开版本号下的新构建**：

```text
1.0.0 (1) → 1.0.0 (2) → 1.0.0 (3)
```

操作顺序：

1. 修复 Bug 或完成优化；
2. 在本地完成针对性验证；
3. 重新执行：

   ```bash
   pnpm exec eas build --platform ios --profile production
   pnpm exec eas submit --platform ios
   ```

4. 等待 Apple 处理完成；
5. 在 TestFlight 的 `Team (Expo)` 中确认新构建已分配：
   - 已启用自动分发：测试者通常会看到新版本；
   - 未启用自动分发：手动点击 **添加构建（Add Builds）** 选择新构建；
6. 测试者打开 iPhone 的 TestFlight，点击 **更新**；无需卸载旧 Beta，也无需重新创建测试组或重新邀请同一位测试者；
7. 填写本轮“测试内容”，重复执行真机测试清单。

> 当前项目没有将 EAS Update 作为已验证的发布路径。即使未来配置了 EAS Update，涉及原生代码、权限、App 配置或 `EXPO_PUBLIC_*` 环境变量的改动仍必须重新构建并经 TestFlight 分发。Beta 阶段默认采用完整 EAS 构建最稳妥。

## 版本号策略

- **正式发布前**：保持公开版本号 `1.0.0`，让 EAS 自动递增构建号；
- **`1.0.0` 正式上架后**：下一次面向 App Store 的公开更新改为 `1.0.1`，并再创建新的构建；
- 不要尝试用同一个“版本号 + 构建号”覆盖已经上传到 App Store Connect 的构建。

## 发布前安全检查

- 不在 App、`EXPO_PUBLIC_*` 环境变量、Git 仓库或截图中放入 Supabase `service_role`；
- secret/service-role key 仅可存在于可信服务端环境（例如过渡期 FC 或 Supabase Edge Function secrets）；
- SMTP 密码、Apple API Key 私钥、FC AccessKey 同样不得粘贴进文档、Issue 或聊天截图；
- 若轮换了 anon/public Supabase key，需同步更新 EAS production 环境变量并重新构建；仅轮换 server-side `service_role` 或 SMTP 密码，不会改变已构建 App 中的客户端配置。

## 从 Beta 到正式上架

所有 Beta 测试通过后，再在 App Store Connect 完成：

1. App Store 截图、描述、关键词和分类；
2. 隐私问卷、隐私政策 URL、支持 URL；
3. 审核说明和必要的测试账号/测试步骤；
4. 选择通过验证的构建，并提交 App Review。

当前第一版保持免费；不要创建尚未实现的订阅或 App 内购买项目。

## 官方参考

- [Expo：Submit to the Apple App Store with EAS Submit](https://docs.expo.dev/submit/ios/)
- [Expo：Distribute an iOS app with TestFlight](https://docs.expo.dev/submit/testflight/)
- [Apple：Add internal testers](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers)
- [Apple：App build statuses](https://developer.apple.com/help/app-store-connect/reference/app-build-statuses/)
