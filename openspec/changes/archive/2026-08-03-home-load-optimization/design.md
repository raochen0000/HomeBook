## Context

首页目前并行创建 profile、family、members、categories、transactions、budget 和 accounting preferences 查询。Hero 从最近 200 条完整流水在客户端计算本月金额；预算查询又会在查到总预算后串行查询分类预算。首页骨架同时等待 profile、transactions 和 categories，成员头像预取与根布局的定时收支补记会在首屏期间争用资源。

交易表已有部分索引 `(family_id, occurred_at DESC) WHERE is_deleted = false`，但首页查询未显式按家庭过滤，且没有分页游标。家庭的时区存储在 `families.timezone`，预算已用的既有口径是当期 `type = 'expense' AND source = 'normal'` 的金额。

## Goals / Non-Goals

**Goals:**

- Hero 以服务器聚合的完整账期数据渲染，不受流水首屏页大小限制。
- 首页首个流水页限制为 30 条，后续页以 `(occurred_at, id)` 的降序游标继续加载，不重复或跳过并列时间的记录。
- Hero、流水、分类/成员资源各自加载；不因非 Hero 数据阻塞 Hero。
- 不改变报表、搜索、记账面板及其它页面仍使用的完整 `useTransactions()` 行为。
- 新增 Vitest 作为仅开发期依赖，遵守 Expo SDK 56 与现有 Supabase RLS 模型。

**Non-Goals:**

- 不修改账本的 RLS 策略或记录字段。
- 不引入离线持久化缓存；账本数据不落到未评估安全性的明文存储。
- 不变更 Hero 文案、视觉样式或预算业务口径。
- 不在本次把全部历史流水改造为全应用统一分页。

## Decisions

### 1. 使用受限的首页概览 RPC 聚合 Hero

新增 `get_home_dashboard(p_period text)`，返回当前认证用户所在家庭的 `family_id`、`is_owner`、账期预算总额、收入、支出、结余、流水笔数和预算已用额。函数必须：

- 仅接受 `YYYY-MM` 格式的账期；
- 从当前用户的有效 membership 确定家庭，不接受客户端传入 family id；
- 按该家庭时区计算账期半开区间；
- 排除软删除流水；预算已用额仅聚合普通支出；
- 以 `SECURITY INVOKER`、固定 `search_path` 和现有家庭 RLS 策略执行，避免聚合接口绕开行级授权。

选择 RPC 而非把所有流水下载后在客户端汇总，因为它会传输固定大小的摘要并保证账期数据完整。选择单独的概览请求而非与流水首屏合并，允许 Hero 在列表或类别尚未完成时独立出现，且接口可被日后其它概览入口复用。

### 2. 为首页新增独立的游标流水 Hook

保留现有 `useTransactions()` 给报表、搜索、记账与家庭页。新增 `useHomeTransactionFeed(familyId)`，使用 `useInfiniteQuery` 和直接表查询：

- 请求显式 `.eq('family_id', familyId)`，同时保留 RLS 防护并匹配现有索引的前导列；
- 每页 30 条，按 `occurred_at DESC, id DESC` 排序；
- 下一页条件为 `occurred_at < cursor.occurredAt OR (occurred_at = cursor.occurredAt AND id < cursor.id)`；
- 仅在确认存在家庭后启用；
- 新 query key 位于 `transactions` 前缀下，使现有新增、编辑、删除的失效逻辑同时刷新首页流水。

选择客户端 PostgREST keyset 查询而非第二个列表 RPC：列表仍受现有 RLS 保护，改动范围更小，同时可以直接复用完整 `Transaction` 行类型。选择游标而非 offset，避免新流水插入时翻页重复或跳项。

### 3. 将首页改为分层加载与受控增量渲染

Hero 只依赖 dashboard、accounting preferences 和本地日期；Hero 用自己的骨架处理 dashboard 未完成状态。流水列表独立等待 transaction feed；分类和成员数据加载后再补全行中的分类与头像。列表末尾使用 SDK 56 已确认的 SwiftUI `onAppear(handler)` 修饰符请求下一页，并以 `hasNextPage`、`isFetchingNextPage` 防止重复请求。

页面仍在无流水时显示原有空状态，但不再把 `categoriesQ.isLoading` 作为全屏骨架条件。家庭尚未建立时不启用流水 feed，并维持“记一笔”时自动建家庭的现有行为。

### 4. 仅加载首屏需要的预算和头像资源

新增只读取 `budgets.total_amount` 的首页预算摘要查询，或使 dashboard 成为 Hero 唯一预算数据源；首页不再调用包含分类预算的 `useBudget()`。头像预取以当前已加载流水中出现的记录人/编辑人为集合，而不是全量家庭成员集合，并在列表已经出现后触发。

缓存时间按变更频率覆盖：类别和成员数据使用较长 `staleTime`，交易 feed 与 dashboard 保持短期缓存并由现有 mutation 失效立即刷新。

### 5. 将定时收支补记移出关键渲染路径

保留补记的“每天首次激活时执行、成功后失效流水查询”的业务语义，但将初次执行排在首次可交互渲染之后。这样新生成的流水仍会自动刷新页面，不与首屏 dashboard/feed 请求争抢网络。

## Risks / Trade-offs

- [RPC 的时区和聚合口径与既有前端不一致] → 以现有 `expenseUsedInPeriod` 的普通支出口径为契约，并在 SQL migration 中为边界日期和软删除数据添加验证查询。
- [游标 SQL 过滤写错导致漏项或重复] → 为相同 `occurred_at` 的记录增加单元测试，且采用二级 `id` 排序与相同的二级游标条件。
- [分类/成员延后到达导致行文本暂时回退] → 使用现有“未分类”和昵称回退值；数据到达后以 React Query 重新计算行模型。
- [概览 RPC 扩大数据访问面] → 使用 `SECURITY INVOKER` 保持现有 RLS 生效，不接收 family id，并只 `GRANT EXECUTE` 给 `authenticated`。
- [延后补记会让刚到期的定时流水稍后出现] → 在首屏后立即调度，成功后立即失效相关查询；不会丢失或重复流水。

## Migration Plan

1. 部署数据库 migration：创建 dashboard RPC、执行权限和必要的函数注释。
2. 发布客户端：新版本会读取 RPC 与分页流水；旧版本仍可使用原表查询，不受 schema 变更影响。
3. 监控 RPC 错误率、概览与报表当期汇总差异、首个 feed 页耗时和追加页重复率。
4. 如需回滚客户端，保留 RPC 不会影响旧版本；如需回滚数据库，先撤销 authenticated 的 execute 权限再删除函数。
