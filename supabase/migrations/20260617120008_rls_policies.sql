-- 0008 · 行级安全（RLS）策略
-- ----------------------------------------------------------------------------
-- 最佳实践（已对 Supabase 官方文档核实）：
--   ① auth.uid() 一律包 (select auth.uid())，让 PG 按语句缓存，避免逐行调用。
--   ② 所有策略指定 TO authenticated（anon 不授予任何访问）。
--   ③ 每操作（select/insert/update/delete）独立策略。
--   ④ 跨表归属判断走 private.* SECURITY DEFINER 辅助函数，避免递归。
-- 写操作中凡涉及成员/家庭流转、资金闭环者，统一走 0009 的 RPC（SECURITY DEFINER），
-- 故这些表此处只给读策略 + 必要的本人写策略。

-- 表权限：RLS 负责「哪些行」，GRANT 负责「能否访问该表」。anon 不授权。
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- 启用 RLS（所有 public 表）
alter table public.profiles            enable row level security;
alter table public.families            enable row level security;
alter table public.memberships         enable row level security;
alter table public.categories          enable row level security;
alter table public.transactions        enable row level security;
alter table public.savings_goals       enable row level security;
alter table public.savings_entries     enable row level security;
alter table public.budgets             enable row level security;
alter table public.budget_categories   enable row level security;
alter table public.invitations         enable row level security;
alter table public.succession_requests enable row level security;
alter table public.notifications       enable row level security;
alter table public.monthly_summaries   enable row level security;

-- ── PROFILES ─────────────────────────────────────────────────────────────────
create policy "profiles_select_self_or_family" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id or private.shares_family(id));

create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
-- 插入由 auth 触发器 handle_new_user（SECURITY DEFINER）完成，无需 insert 策略。

-- ── FAMILIES ─────────────────────────────────────────────────────────────────
create policy "families_select_member" on public.families
  for select to authenticated
  using (private.is_family_member(id));

create policy "families_update_owner" on public.families
  for update to authenticated
  using (private.is_family_owner(id))
  with check (private.is_family_owner(id));
-- 创建走 create_family RPC；解散等走 RPC。

-- ── MEMBERSHIPS ──────────────────────────────────────────────────────────────
create policy "memberships_select_member" on public.memberships
  for select to authenticated
  using (private.is_family_member(family_id));
-- 入伙/退出/移除/转让均走 RPC（SECURITY DEFINER）。

-- ── CATEGORIES ───────────────────────────────────────────────────────────────
create policy "categories_select" on public.categories
  for select to authenticated
  using (family_id is null or private.is_family_member(family_id));

create policy "categories_insert_family" on public.categories
  for insert to authenticated
  with check (family_id is not null and private.is_family_member(family_id));

create policy "categories_update_family" on public.categories
  for update to authenticated
  using (family_id is not null and private.is_family_member(family_id))
  with check (family_id is not null and private.is_family_member(family_id));
-- 系统分类（family_id is null）对所有人只读；删除走软删除（update status）。

-- ── TRANSACTIONS ─────────────────────────────────────────────────────────────
create policy "transactions_select_member" on public.transactions
  for select to authenticated
  using (private.is_family_member(family_id));

create policy "transactions_insert_member" on public.transactions
  for insert to authenticated
  with check (private.is_family_member(family_id)
              and recorder_user_id = (select auth.uid()));

create policy "transactions_update_member" on public.transactions
  for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));
-- 删除走软删除（is_deleted = true，经 update）；不开放物理 delete。

-- ── SAVINGS_GOALS ────────────────────────────────────────────────────────────
create policy "savings_goals_select_member" on public.savings_goals
  for select to authenticated
  using (private.is_family_member(family_id));

create policy "savings_goals_insert_member" on public.savings_goals
  for insert to authenticated
  with check (private.is_family_member(family_id));

create policy "savings_goals_update_member" on public.savings_goals
  for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));
-- 注：存取导致的 saved_amount/version 变更经 savings_deposit/withdraw RPC。

-- ── SAVINGS_ENTRIES（写入仅经 RPC，故只给读策略）───────────────────────────────
create policy "savings_entries_select_member" on public.savings_entries
  for select to authenticated
  using (private.is_member_of_goal(goal_id));

-- ── BUDGETS ──────────────────────────────────────────────────────────────────
create policy "budgets_select_member" on public.budgets
  for select to authenticated
  using (private.is_family_member(family_id));

create policy "budgets_insert_member" on public.budgets
  for insert to authenticated
  with check (private.is_family_member(family_id));

create policy "budgets_update_member" on public.budgets
  for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

create policy "budgets_delete_member" on public.budgets
  for delete to authenticated
  using (private.is_family_member(family_id));

-- ── BUDGET_CATEGORIES ────────────────────────────────────────────────────────
create policy "budget_categories_select_member" on public.budget_categories
  for select to authenticated
  using (private.is_member_of_budget(budget_id));

create policy "budget_categories_insert_member" on public.budget_categories
  for insert to authenticated
  with check (private.is_member_of_budget(budget_id));

create policy "budget_categories_update_member" on public.budget_categories
  for update to authenticated
  using (private.is_member_of_budget(budget_id))
  with check (private.is_member_of_budget(budget_id));

create policy "budget_categories_delete_member" on public.budget_categories
  for delete to authenticated
  using (private.is_member_of_budget(budget_id));

-- ── INVITATIONS（创建/撤销走 RPC，仅给读策略）─────────────────────────────────
create policy "invitations_select_member" on public.invitations
  for select to authenticated
  using (private.is_family_member(family_id));

-- ── SUCCESSION_REQUESTS（流转走 RPC，仅给读策略）──────────────────────────────
create policy "succession_select_member" on public.succession_requests
  for select to authenticated
  using (private.is_family_member(family_id));

-- ── NOTIFICATIONS（仅本人可读、可标记已读）────────────────────────────────────
create policy "notifications_select_self" on public.notifications
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "notifications_update_self" on public.notifications
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── MONTHLY_SUMMARIES（生成走 RPC/cron，仅给读策略）───────────────────────────
create policy "monthly_summaries_select_member" on public.monthly_summaries
  for select to authenticated
  using (private.is_family_member(family_id));
