## Why

首页冷启动需要同时加载多份数据，并下载最多 200 条完整流水后在客户端计算 Hero。数据量增大时，首屏等待、原生列表创建和头像预取会相互竞争；同时，单月流水超过 200 条时，本月汇总可能不完整。

## What Changes

- 为首页 Hero 提供服务端聚合的本月概览数据，避免以最近流水列表作为汇总数据源。
- 将首页流水改为稳定游标分页，首屏只请求和渲染有限数量的最近流水。
- 将 Hero 与流水列表改为独立加载，Hero 不再等待分类、成员头像和列表映射完成。
- 为首页使用轻量预算查询、按可见流水预取头像，并延后定时收支补记，降低首屏网络和主线程竞争。
- 按数据更新频率细化首页相关 React Query 的缓存策略。

## Capabilities

### New Capabilities

- `home-dashboard-summary`: 为当前家庭提供准确、轻量的本月 Hero 概览。
- `home-transaction-feed`: 为首页提供稳定游标分页的最近流水列表。
- `home-progressive-loading`: 让首页 Hero、流水和非关键资源按首屏优先级独立呈现。

### Modified Capabilities

- 无。

## Impact

- 受影响的客户端代码包括 `src/app/(tabs)/index.tsx`、`src/api/transactions.ts`、`src/api/budgets.ts`、`src/features/home/use-avatar-files.ts`、`src/features/record/use-recurring-catchup.ts` 以及 React Query 配置。
- 新增 Supabase SQL migration 和受 RLS 保护的首页聚合 RPC。
- 新增 Vitest 开发依赖，为游标边界和首页数据映射提供自动化回归测试；运行时代码继续使用 Expo SDK 56、Supabase JS 和 TanStack Query。
