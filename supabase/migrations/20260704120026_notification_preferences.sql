-- 0026 · 通知偏好：notification_preferences 表（每用户一行、六列布尔） + 本人 RLS（PRD §18.3.3 / DATAMODEL §5.6）
-- ----------------------------------------------------------------------------
-- 数据库端口被防火墙拦截，请在 Supabase Studio → SQL Editor 执行本文件（不要走 psql/CLI）。
--
-- 语义（产品定稿）：通知设置页的六类分类开关持久化。客户端直读 + upsert（onConflict = user_id），
-- RLS 仅本人可读写；行不存在（老用户 / 从未改过）→ 客户端回落「全开」默认。本表只落用户
-- 「愿不愿收该类系统推送」的意愿——App 内通知中心（流程 13）不受影响、始终可见；系统推送
-- （expo-notifications + APNs）落地后由投递侧读取本表决定是否推送对应分类。

-- ── NOTIFICATION_PREFERENCES（通知偏好）────────────────────────────────────────
create table public.notification_preferences (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  family_activity   boolean not null default true,   -- 家庭动态（被移出 / 户主变更等，见流程 13 §15）
  budget_alert      boolean not null default true,   -- 预算超支预警
  savings_progress  boolean not null default true,   -- 储蓄目标进展
  monthly_summary   boolean not null default true,   -- 月度总结提醒
  member_change     boolean not null default true,   -- 成员与邀请变动
  account_security  boolean not null default true,   -- 账号安全
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger set_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- 表权限：0008 的「grant ... on all tables」只覆盖当时已存在的表，本表建于其后，故此处显式补授
-- （GRANT 负责「能否访问该表」，RLS 负责「哪些行」）。无 delete：行随账号级联清理，不给客户端删权。
grant select, insert, update on public.notification_preferences to authenticated;

-- ── RLS：仅本人可读写（select / insert / update；无 delete，随账号级联清理）──────────
alter table public.notification_preferences enable row level security;

create policy "notification_prefs_select_self" on public.notification_preferences
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "notification_prefs_insert_self" on public.notification_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "notification_prefs_update_self" on public.notification_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
