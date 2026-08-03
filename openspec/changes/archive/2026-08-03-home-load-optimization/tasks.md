## 1. 测试基础与纯数据契约

- [x] 1.1 使用 pnpm 添加 Vitest 开发依赖、`test` 脚本和 Node 测试配置，保持 Expo 运行时依赖不变
- [x] 1.2 为首页流水游标的同时间戳排序、下一页游标和页结果扁平化编写并验证失败的单元测试
- [x] 1.3 实现可测试的首页流水游标与页结果工具，使测试通过
- [x] 1.4 为首页 dashboard 响应到 Hero 数据模型的映射及空预算场景编写并验证失败的单元测试
- [x] 1.5 实现 dashboard 数据模型与映射工具，使测试通过

## 2. 服务端首页概览

- [x] 2.1 新建 Supabase migration，创建仅对 authenticated 授权的 `get_home_dashboard(p_period text)` 安全聚合 RPC
- [x] 2.2 在 migration 中以家庭时区计算账期范围，并聚合完整账期的收入、支出、结余、普通支出预算已用额和预算总额
- [x] 2.3 更新手写 Supabase `Database` 函数类型，并在 `src/api` 中暴露类型化 dashboard 查询 Hook
- [x] 2.4 用边界账期、软删除和非普通支出样例审阅 migration SQL，并运行类型检查

## 3. 首页流水游标数据层

- [x] 3.1 在 `src/api/transactions.ts` 新增以家庭 ID 启用的 `useHomeTransactionFeed` 无限查询，首屏大小固定为 30
- [x] 3.2 实现 `occurred_at DESC, id DESC` 的复合游标请求条件，并将新 query key 置于 `transactions` 失效前缀下
- [x] 3.3 保留 `useTransactions()` 及报表、搜索、记账等既有消费者的行为不变
- [x] 3.4 运行 Vitest，确认同时间戳、追加页和变更失效行为保持正确

## 4. 渐进式首页渲染

- [x] 4.1 将首页 Hero 改为使用 dashboard Hook 和独立局部骨架，移除以完整流水计算 Hero 的路径
- [x] 4.2 将首页列表改为消费 paginated feed，并在末尾使用 SDK 56 已确认的 `onAppear` 触发下一页加载与加载中提示
- [x] 4.3 使分类、成员和头像加载不再阻塞 Hero 或首个流水页，并保持分类、昵称和头像的回退展示
- [x] 4.4 将 Hero 使用的预算、户主信息改为 dashboard 返回值，移除首页无用的分类预算请求

## 5. 后台竞争与缓存

- [x] 5.1 使头像预取仅覆盖已加载流水涉及的成员，并在列表出现后异步执行
- [x] 5.2 为成员和分类配置长于交易的 React Query `staleTime`，保留流水 mutation 的即时失效
- [x] 5.3 将首次定时收支补记调度到首屏可交互渲染之后，并在补记写入后同时刷新 dashboard 与首页流水

## 6. 验证与交付

- [x] 6.1 安装工作树依赖并运行 `pnpm test`、`pnpm exec tsc --noEmit` 与 `pnpm lint`
- [x] 6.2 在 iOS 模拟器验证冷启动、无家庭、无流水、超过 30 条流水、同时间戳流水、追加页、保存/编辑/删除和定时补记后的刷新
- [x] 6.3 审阅 OpenSpec tasks、design 和 specs，确认所有已完成任务与实现一致

### 6.1 结果（2026-08-03）

- `pnpm test`：2 files / 6 tests passed
- `tsc --noEmit`：通过
- `pnpm lint`：0 errors；既有 `search-sheet.tsx` hooks warnings（与本 change 无关）

### 6.3 审阅备注

- 实现与 design/specs 一致：`get_home_dashboard`、游标 feed 30、渐进 Hero、分类/成员长 staleTime、补记延后。
- 本轮补强：PostgREST 游标时间戳加引号；补记改为 `InteractionManager` + 1.5s；预算/储蓄/定时补记 mutation 同步失效 `home_dashboard`。
- 6.2 需在 worktree 目录启动的 App 上人工点验（主仓 `pnpm dev` 不会加载本分支代码）。
