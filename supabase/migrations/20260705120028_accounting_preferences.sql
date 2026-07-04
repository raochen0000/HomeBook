-- 0028 · 记账偏好：accounting_preferences 表（每用户一行） + 本人 RLS（PRD §18.3.1 / DATAMODEL §5.8）
-- ----------------------------------------------------------------------------
-- 数据库端口被防火墙拦截，请在 Supabase Studio → SQL Editor 执行本文件（不要走 psql/CLI）。
--
-- 语义（产品定稿）：「我的 → 记账设置」的个人级偏好持久化。客户端直读 + 整行 upsert
-- （onConflict = user_id），RLS 仅本人可读写；行不存在（老用户 / 从未改过）→ 客户端回落默认。
-- 仅影响本人视角（默认记账类型、记一笔后行为、金额隐私、报表卡片显隐 / 排序），不涉及全家共享数据。

-- ── ACCOUNTING_PREFERENCES（记账偏好）──────────────────────────────────────────
create table public.accounting_preferences (
  user_id               uuid primary key references public.profiles(id) on delete cascade,
  default_txn_type      text not null default 'expense'
                          check (default_txn_type in ('expense','income')),  -- 打开记账面板默认选中
  after_record_behavior text not null default 'close'
                          check (after_record_behavior in ('close','continue')),  -- 保存即关 / 继续记下一笔
  amount_privacy        boolean not null default false,   -- 开启后首页 / 报表金额显示 ****（防窥屏）
  report_card_order     text[]  not null default '{}',    -- 报表卡片用户排序（卡 id 序；空 = 用默认序）
  report_card_hidden    text[]  not null default '{}',    -- 报表隐藏卡片 id 集合（概览恒不入此列，见客户端 report-cards 注册表）
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger set_updated_at before update on public.accounting_preferences
  for each row execute function public.set_updated_at();

-- 表权限：0008 的「grant ... on all tables」只覆盖当时已存在的表，本表建于其后，故此处显式补授
-- （GRANT 负责「能否访问该表」，RLS 负责「哪些行」）。无 delete：行随账号级联清理，不给客户端删权。
grant select, insert, update on public.accounting_preferences to authenticated;

-- ── RLS：仅本人可读写（select / insert / update；无 delete，随账号级联清理）──────────
alter table public.accounting_preferences enable row level security;

create policy "accounting_prefs_select_self" on public.accounting_preferences
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "accounting_prefs_insert_self" on public.accounting_preferences
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "accounting_prefs_update_self" on public.accounting_preferences
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
