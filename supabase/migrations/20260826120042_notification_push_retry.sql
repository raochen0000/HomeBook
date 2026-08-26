-- 0042 · 系统推送投递重试状态。
-- pushed_at 只表示 Expo 已接受本次通知；临时失败保留原消息，按 FC 写入的 next_attempt_at 延后重试。

alter table public.notifications
  add column push_attempts smallint not null default 0 check (push_attempts >= 0),
  add column push_next_attempt_at timestamptz;

drop index if exists public.notifications_push_pending_idx;
create index notifications_push_due_idx
  on public.notifications (push_next_attempt_at nulls first, created_at)
  where channel = 'in_app' and pushed_at is null;
