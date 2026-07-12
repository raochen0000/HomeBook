-- 0028 · 通知推送投递支持：notifications 加 pushed_at（供 push-fc 定时轮询标记已推）（PRD §18.3.3 层级二 / 流程 13 §15）
-- ----------------------------------------------------------------------------
-- 数据库端口被防火墙拦截，请在 Supabase Studio → SQL Editor 执行本文件（不要走 psql/CLI）。
--
-- 语义（产品定稿）：push-fc（阿里云 FC 定时轮询，见 services/push-fc/）每 ~1min 拉取
-- channel='in_app' 且 pushed_at is null 的通知，按 notification_preferences 决定后经 Expo Push
-- 发出，随即把这些行标记 pushed_at（含被偏好跳过 / 无令牌的，避免反复处理）。
-- 现有历史通知一次性回填为已推——只推本迁移之后新产生的通知，防首次轮询把旧通知全推一遍。

alter table public.notifications add column if not exists pushed_at timestamptz;

-- 回填：现有行视为已推（pushed_at 刚加为 null，这里全部落定为 now()）
update public.notifications set pushed_at = now() where pushed_at is null;

-- 轮询查询用的部分索引（只索引「待推的 in_app 行」，回填后集合很小、写入开销可忽略）
create index if not exists notifications_push_pending_idx
  on public.notifications (created_at)
  where pushed_at is null and channel = 'in_app';
