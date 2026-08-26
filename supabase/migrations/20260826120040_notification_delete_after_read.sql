-- 0040 · 通知中心第一版：阅读或确认后物理删除，不保留已读记录。
-- 通知中心只读取最新 100 条；删除策略只允许用户删除自己的通知。

-- 清理历史已读记录，并移除不再使用的已读状态字段。
delete from public.notifications where read_at is not null;

-- 第一版没有通知更新场景；移除旧的“标记已读”权限，只保留本人删除权限。
drop policy if exists "notifications_update_self" on public.notifications;

drop index if exists public.notifications_user_idx;
alter table public.notifications drop column if exists read_at;
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create policy "notifications_delete_self" on public.notifications
  for delete to authenticated
  using (user_id = (select auth.uid()));
