# 系统推送投递（阿里云 FC 定时轮询）

把「层级二 · 远程推送」的**服务端投递**落到阿里云函数计算 FC：定时器每 ~1min 调用本函数，
它以 `service_role` 拉取待推通知 → 按 `notification_preferences` 决定 → 查 `device_tokens` →
调 **Expo Push API** 发出 → 标记 `pushed_at`。链路与取舍见 [`index.js`](index.js) 顶部注释。

**为什么轮询**：自建 Supabase 出网受限（SMTP 被墙、未启用 `pg_net`），DB 侧没有可靠外发通道；
而 FC 到公网（Supabase REST + Expo）可达，故由 FC 主动拉取，绕开「DB 能否出网」的不确定性。

**语义**：App 内通知中心（流程 13）始终可见，push 只是唤回副本。整体「至多一次、尽力而为」，
优先不重复刷屏而非绝对不丢；漏推一条不影响用户在 App 内看到该通知。

---

## 前置

- 迁移 **0028** 已在 Studio 应用（`notifications` 加 `pushed_at` + 回填 + 部分索引）。
- 客户端 `PUSH_DELIVERY_ENABLED=true`、真机已取到 `ExponentPushToken` 并入 `device_tokens`。
- 拿到自建实例的 **`service_role`** 密钥（Studio → Project Settings → API）。

## 1. 部署 FC 函数（FC 3.0「事件函数」）

本函数零第三方依赖，直接传两个文件即可（也可 `npm run zip` 打包上传）：

1. FC 控制台 → 创建函数 → 选 **事件函数**（不是 Web 函数；由定时器内部调用，无需公网 HTTP 入口）：
   - 运行环境：**Node.js 20**
   - **请求处理程序 / Handler**：`index.handler`
   - 代码：上传 `index.js` + `package.json`（或 `function.zip`）
   - 超时：≥ 30s（一轮批量发送留足时间）
2. **环境变量**（见 [`.env.example`](.env.example)）：
   - `SUPABASE_URL`：实例地址（与客户端 `EXPO_PUBLIC_SUPABASE_URL` 同一个）
   - `SUPABASE_SERVICE_ROLE_KEY`：service_role 密钥（高权限，只放这里）
   - 可选：`PUSH_LOOKBACK_MINUTES` / `PUSH_BATCH_LIMIT` / `EXPO_ACCESS_TOKEN`

## 2. 加定时触发器

函数 → 触发器 → 创建 → **定时触发器**：
- 触发方式：**指定时间间隔**（Rate）`@every 1m`（想更快可 `@every 30s`；或用 Cron）。
- 启用即可。到点平台会以空 event 调用 `index.handler`，跑一轮轮询。

> 建议先设 `@every 1m`：这类通知不追求实时，1 分钟延迟足够；也更省调用次数。

## 3. 验证

**本地**（可选，需先 `cp .env.example .env` 填 URL + service_role）：
```bash
cd services/push-fc
node test-send.mjs      # 先打印 describe 自检，再跑一次真实轮询
```

**端到端**：
1. 真机 A 登录、通知设置里开着「系统推送」，`device_tokens` 有它的令牌。
2. 用另一账号/设备触发一个会给 A 生成通知的事件（如把 A 移出家庭、转让户主给 A、A 的储蓄目标达成）；
   或在 Studio 直接给 A 插一条 `channel='in_app'` 的通知：
   ```sql
   insert into public.notifications (user_id, type, channel, payload)
   values ('<A 的 user_id>', 'transfer', 'in_app', '{"family_name":"调试之家"}');
   ```
3. 等 ≤1min（或本地手动 `node test-send.mjs`）→ 真机 A 应收到系统推送「户主变更 · 你已成为「调试之家」的户主」。
4. Studio 查该通知行的 `pushed_at` 已落定（非 null）即投递流程走通。

## 排障

- **发不出去 / Expo 报错**：确认 `.p8` 已在 Expo Credentials 里配好（`eas credentials`），bundle id、
  Team ID 对得上；Expo 后台若开了 Enhanced Security 要填 `EXPO_ACCESS_TOKEN`。
- **收不到但 `pushed_at` 已落定**：多半是该用户 `notification_preferences` 关了该类，或 `device_tokens`
  没有其令牌（未授权/未登录/令牌失效被清）。
- **令牌被删**：回执 `DeviceNotRegistered`（卸载/关推送/令牌轮换）会自动从 `device_tokens` 删除，属正常。
