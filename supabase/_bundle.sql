-- 家账 HomeBook · 全量建库脚本（10 个迁移按序合并）
-- 用法：在自托管实例的 Studio → SQL Editor 整段粘贴执行一次。
-- 全程包在一个事务里，任一步出错整体回滚，便于安全重试。
-- 注意：表无 IF NOT EXISTS，仅供首次建库；重复执行会因对象已存在而报错（属预期）。

begin;

-- ============================================================
-- >>> migrations/20260617120001_extensions.sql
-- ============================================================
-- 0001 · 扩展与基础 schema
-- ----------------------------------------------------------------------------
-- 说明：
--   * 不依赖 moddatetime 扩展，改用自定义 set_updated_at() 触发器函数（更可移植）。
--   * private schema 存放 RLS 辅助函数（SECURITY DEFINER），不暴露给 Data API。
--   * gen_random_uuid() 为 PG13+ 内置，无需额外扩展。

-- 用于 RLS 辅助函数的私有 schema（PostgREST 不会暴露此 schema）
create schema if not exists private;

-- 仅授予 authenticated 使用权（供 RLS 策略内调用辅助函数），不给 anon
grant usage on schema private to authenticated;

-- updated_at 自动维护函数（全表通用）
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- >>> migrations/20260617120002_core_tables.sql
-- ============================================================
-- 0002 · 核心表：profiles / families / memberships
-- ----------------------------------------------------------------------------
-- 认证模型修正：用户认证主表为 Supabase Auth 的 auth.users（托管手机号/OTP/session）。
-- 业务字段落在 public.profiles，id 与 auth.users 一对一（ON DELETE CASCADE）。
-- families 与 profiles 互相引用（owner_user_id ↔ current_family_id），故先建表、后补交叉外键。

-- ── FAMILY ──────────────────────────────────────────────────────────────────
create table public.families (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  owner_user_id uuid not null,                       -- 外键稍后补加 → profiles(id)
  timezone      text not null,                        -- 账期时区，创建时落定（PRD §2.5）
  member_count  int  not null default 1 check (member_count between 1 and 8),
  status        text not null default 'active' check (status in ('active','dissolved')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── PROFILE（改造自 USER，去掉 phone，由 auth.users 持有）──────────────────────
create table public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  nickname          text not null,
  avatar_url        text,
  current_family_id uuid references public.families(id),  -- 当前所属家庭（一人一家）
  last_login_at     timestamptz,                          -- 户主 30 天继任判定用
  status            text not null default 'active' check (status in ('active','deactivated')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 补加 families → profiles 的交叉外键（此时 profiles 已存在）
alter table public.families
  add constraint families_owner_user_id_fkey
  foreign key (owner_user_id) references public.profiles(id);

-- ── MEMBERSHIP ───────────────────────────────────────────────────────────────
create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner','member')),
  status     text not null default 'active' check (status in ('active','left','removed')),
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (family_id, user_id)
);

-- 一人一家：每用户仅一条 active 成员关系（PRD §2.2）
create unique index memberships_one_active_per_user
  on public.memberships (user_id) where status = 'active';

-- 户主唯一：每家仅一条 active 的 owner（PRD §5）
create unique index memberships_one_owner_per_family
  on public.memberships (family_id) where role = 'owner' and status = 'active';

create index memberships_family_active_idx
  on public.memberships (family_id) where status = 'active';

-- ============================================================
-- >>> migrations/20260617120003_ledger_savings_tables.sql
-- ============================================================
-- 0003 · 账本与储蓄：categories / savings_goals / transactions / savings_entries
-- ----------------------------------------------------------------------------
-- 依赖顺序：categories、savings_goals 先于 transactions；savings_entries 最后
-- （transactions 引用 savings_goals 与 categories；savings_entries 引用两者）。

-- ── CATEGORY ─────────────────────────────────────────────────────────────────
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid references public.families(id) on delete cascade,  -- null = 系统预设全局分类
  name       text not null,
  icon       text,                                                    -- SF Symbols 名
  type       text not null check (type in ('expense','income')),
  is_system  boolean not null default false,                          -- 系统预设不可删，仅可隐藏
  status     text not null default 'active' check (status in ('active','archived','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 同家庭内分类名不重复（active）
create unique index categories_uniq_name_per_family
  on public.categories (family_id, name) where family_id is not null and status = 'active';

-- 系统全局分类名不重复（active）
create unique index categories_uniq_system_name
  on public.categories (name) where family_id is null and status = 'active';

-- ── SAVINGS_GOAL ─────────────────────────────────────────────────────────────
create table public.savings_goals (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  name          text not null,
  target_amount bigint not null check (target_amount > 0),  -- 单位：分
  deadline      date,                                        -- 可空（无期限）
  cover_url     text,
  note          text,
  saved_amount  bigint not null default 0 check (saved_amount >= 0),
  achieved_at   timestamptz,                                 -- 首次达成时间（庆祝只触发一次）
  status        text not null default 'active' check (status in ('active','deleted')),
  version       int not null default 0,                      -- 乐观锁，解决并发存取（PRD §9.7）
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index savings_goals_family_active_idx
  on public.savings_goals (family_id) where status = 'active';

-- ── TRANSACTION（模型核心）───────────────────────────────────────────────────
create table public.transactions (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references public.families(id) on delete cascade,  -- 创建即绑定，不可变
  type             text not null check (type in ('expense','income')),
  amount           bigint not null check (amount > 0),                              -- 单位：分
  category_id      uuid not null references public.categories(id),
  note             text,
  occurred_at      timestamptz not null default now(),                             -- 按家庭时区归月
  recorder_user_id uuid not null references public.profiles(id),
  source           text not null default 'normal'
                     check (source in ('normal','savings_deposit','savings_withdraw')),
  savings_goal_id  uuid references public.savings_goals(id),                        -- 储蓄类流水关联目标
  sync_status      text not null default 'synced' check (sync_status in ('synced','pending')),
  is_deleted       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index transactions_family_occurred_idx
  on public.transactions (family_id, occurred_at desc) where is_deleted = false;
create index transactions_family_category_idx
  on public.transactions (family_id, category_id);
create index transactions_goal_idx
  on public.transactions (savings_goal_id) where savings_goal_id is not null;

-- ── SAVINGS_ENTRY（存取记录，对应一笔流水 —— 方案 B 资金闭环）────────────────────
create table public.savings_entries (
  id             uuid primary key default gen_random_uuid(),
  goal_id        uuid not null references public.savings_goals(id) on delete cascade,
  direction      text not null check (direction in ('deposit','withdraw')),
  amount         bigint not null check (amount > 0),         -- 单位：分
  note           text,
  transaction_id uuid not null references public.transactions(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index savings_entries_goal_idx on public.savings_entries (goal_id);

-- ============================================================
-- >>> migrations/20260617120004_budget_tables.sql
-- ============================================================
-- 0004 · 预算：budgets / budget_categories
-- ----------------------------------------------------------------------------

-- ── BUDGET（月度总预算）──────────────────────────────────────────────────────
create table public.budgets (
  id            uuid primary key default gen_random_uuid(),
  family_id     uuid not null references public.families(id) on delete cascade,
  period        text not null check (period ~ '^\d{4}-\d{2}$'),  -- YYYY-MM，按自然月不结转
  total_amount  bigint not null check (total_amount > 0),         -- 单位：分
  alert_enabled boolean not null default true,                    -- 80% 预警开关
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (family_id, period)
);

-- ── BUDGET_CATEGORY（分类预算，可选）─────────────────────────────────────────
create table public.budget_categories (
  id          uuid primary key default gen_random_uuid(),
  budget_id   uuid not null references public.budgets(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  amount      bigint not null check (amount > 0),  -- 单位：分；合计可超总预算（仅警告）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (budget_id, category_id)
);

-- ============================================================
-- >>> migrations/20260617120005_aux_tables.sql
-- ============================================================
-- 0005 · 辅助表：invitations / succession_requests / notifications / monthly_summaries
-- ----------------------------------------------------------------------------

-- ── INVITATION（邀请码）──────────────────────────────────────────────────────
create table public.invitations (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families(id) on delete cascade,
  code       text not null unique,
  expires_at timestamptz not null,                       -- 24 小时有效期
  status     text not null default 'valid' check (status in ('valid','revoked','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index invitations_family_idx on public.invitations (family_id);

-- ── SUCCESSION_REQUEST（户主继任申请）────────────────────────────────────────
create table public.succession_requests (
  id                 uuid primary key default gen_random_uuid(),
  family_id          uuid not null references public.families(id) on delete cascade,
  applicant_user_id  uuid not null references public.profiles(id),
  objection_deadline timestamptz not null,               -- 原户主 7 天异议期截止
  status             text not null default 'pending'
                       check (status in ('pending','approved','rejected','cancelled')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 同一家庭异议期内仅允许一条 pending 申请（PRD §7.6）
create unique index succession_one_pending_per_family
  on public.succession_requests (family_id) where status = 'pending';

-- ── NOTIFICATION（通知）──────────────────────────────────────────────────────
create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text not null check (type in
               ('removed','transfer','succession','goal_achieved','budget_alert','monthly_summary')),
  channel    text not null check (channel in ('in_app','push')),
  payload    jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, read_at);

-- ── MONTHLY_SUMMARY（月度总结，生成时快照存储）────────────────────────────────
create table public.monthly_summaries (
  id                 uuid primary key default gen_random_uuid(),
  family_id          uuid not null references public.families(id) on delete cascade,
  period             text not null check (period ~ '^\d{4}-\d{2}$'),  -- YYYY-MM
  total_expense      bigint not null default 0,    -- 单位：分（排除储蓄类流水的消费口径，PRD §11）
  total_income       bigint not null default 0,
  balance            bigint not null default 0,
  max_single_expense jsonb,                         -- 最大单笔快照
  top_category       jsonb,                         -- 支出最高分类快照
  top_recorder       jsonb,                         -- 记账最积极的人快照
  mom_compare        jsonb,                         -- 环比上月快照
  warm_text          text,                          -- 暖心文案（生成时随机落定）
  generated_at       timestamptz not null default now(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (family_id, period)
);

-- ============================================================
-- >>> migrations/20260617120006_constraints_triggers.sql
-- ============================================================
-- 0006 · 约束触发器：自动建档 / updated_at / 不可变 / 计数上限
-- ----------------------------------------------------------------------------

-- ── auth.users 插入时自动创建 profiles 行 ────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, nickname)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nickname', '用户')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── updated_at 自动维护（逐表挂载）───────────────────────────────────────────
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.families
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.transactions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.savings_goals
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.savings_entries
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.budgets
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.budget_categories
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.invitations
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.succession_requests
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.notifications
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.monthly_summaries
  for each row execute function public.set_updated_at();

-- ── transactions.family_id 创建后不可变（PRD §2.3 防串账）────────────────────
create or replace function public.prevent_family_id_change()
returns trigger
language plpgsql
as $$
begin
  if new.family_id is distinct from old.family_id then
    raise exception 'transactions.family_id 创建后不可变';
  end if;
  return new;
end;
$$;

create trigger transactions_family_id_immutable
  before update on public.transactions
  for each row execute function public.prevent_family_id_change();

-- ── 成员上限 8（PRD §2.2）────────────────────────────────────────────────────
create or replace function public.enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and (select count(*) from public.memberships
          where family_id = new.family_id and status = 'active') >= 8 then
    raise exception '家庭成员已达上限（8 人）';
  end if;
  return new;
end;
$$;

create trigger memberships_member_limit
  before insert on public.memberships
  for each row execute function public.enforce_member_limit();

-- ── active 储蓄目标上限 5（PRD §9.3）─────────────────────────────────────────
create or replace function public.enforce_goal_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and (select count(*) from public.savings_goals
          where family_id = new.family_id and status = 'active') >= 5 then
    raise exception '进行中的储蓄目标已达上限（5 个）';
  end if;
  return new;
end;
$$;

create trigger savings_goals_goal_limit
  before insert on public.savings_goals
  for each row execute function public.enforce_goal_limit();

-- ============================================================
-- >>> migrations/20260617120007_rls_helpers.sql
-- ============================================================
-- 0007 · RLS 辅助函数（SECURITY DEFINER，避免策略递归）
-- ----------------------------------------------------------------------------
-- 这些函数以定义者（postgres）身份运行，绕过 memberships 自身的 RLS，
-- 从而避免「memberships 策略调用查 memberships」的无限递归。
-- 函数内部均以 auth.uid() 判定调用者本人，只回布尔/归属，暴露给 authenticated 无安全风险。
-- 置于 private schema，PostgREST 不会将其暴露为 REST endpoint。

-- 当前用户是否为某家庭的 active 成员
create or replace function private.is_family_member(fid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.family_id = fid
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

-- 当前用户是否为某家庭的 active 户主
create or replace function private.is_family_owner(fid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.family_id = fid
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
      and m.status = 'active'
  );
$$;

-- 当前用户是否与目标用户同属一个 active 家庭（用于 profiles 可见性）
create or replace function private.shares_family(other_user uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships me
    join public.memberships them on them.family_id = me.family_id
    where me.user_id = (select auth.uid())
      and me.status = 'active'
      and them.user_id = other_user
      and them.status = 'active'
  );
$$;

-- 当前用户是否为某储蓄目标所属家庭的成员
create or replace function private.is_member_of_goal(gid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.savings_goals g
    join public.memberships m on m.family_id = g.family_id
    where g.id = gid
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

-- 当前用户是否为某预算所属家庭的成员
create or replace function private.is_member_of_budget(bid uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.budgets b
    join public.memberships m on m.family_id = b.family_id
    where b.id = bid
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

grant execute on function private.is_family_member(uuid)  to authenticated;
grant execute on function private.is_family_owner(uuid)   to authenticated;
grant execute on function private.shares_family(uuid)     to authenticated;
grant execute on function private.is_member_of_goal(uuid) to authenticated;
grant execute on function private.is_member_of_budget(uuid) to authenticated;

-- ============================================================
-- >>> migrations/20260617120008_rls_policies.sql
-- ============================================================
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

-- ============================================================
-- >>> migrations/20260617120009_rpc_functions.sql
-- ============================================================
-- 0009 · RPC 事务函数（保证原子性与完整性）
-- ----------------------------------------------------------------------------
-- 均为 SECURITY DEFINER：绕过 RLS 在服务端完成多表事务，函数体内自行做鉴权与归属校验。
-- 默认 PG 会把 EXECUTE 授予 PUBLIC，故逐个 revoke from public 再 grant authenticated。
-- 本文件实现 M1 所需核心 4 个；其余（leave/remove/transfer/succession 等）后续按流程补。

-- ── create_family：建家庭 + 户主成员 + 置 current_family_id ────────────────────
create or replace function public.create_family(p_name text, p_timezone text)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_family public.families;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  -- 一人一家
  if exists (select 1 from public.memberships
             where user_id = v_uid and status = 'active') then
    raise exception '当前用户已属于某个家庭';
  end if;

  insert into public.families (name, owner_user_id, timezone, member_count)
    values (p_name, v_uid, p_timezone, 1)
    returning * into v_family;

  insert into public.memberships (family_id, user_id, role, status)
    values (v_family.id, v_uid, 'owner', 'active');

  update public.profiles set current_family_id = v_family.id where id = v_uid;

  return v_family;
end;
$$;

-- ── join_family_by_code：凭邀请码入伙 ────────────────────────────────────────
create or replace function public.join_family_by_code(p_code text)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_inv    public.invitations;
  v_family public.families;
  v_count  int;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if exists (select 1 from public.memberships
             where user_id = v_uid and status = 'active') then
    raise exception '当前用户已属于某个家庭';
  end if;

  select * into v_inv from public.invitations
    where code = p_code and status = 'valid' for update;
  if not found then
    raise exception '邀请码无效';
  end if;
  if v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception '邀请码已过期';
  end if;

  -- 成员上限（同时由 0006 触发器兜底）
  select count(*) into v_count from public.memberships
    where family_id = v_inv.family_id and status = 'active';
  if v_count >= 8 then
    raise exception '家庭成员已达上限（8 人）';
  end if;

  insert into public.memberships (family_id, user_id, role, status)
    values (v_inv.family_id, v_uid, 'member', 'active');

  update public.families set member_count = member_count + 1
    where id = v_inv.family_id
    returning * into v_family;

  update public.profiles set current_family_id = v_inv.family_id where id = v_uid;

  return v_family;
end;
$$;

-- ── savings_deposit：存入（支出类流水 + entry + 更新目标，乐观锁）────────────────
create or replace function public.savings_deposit(
  p_goal_id          uuid,
  p_amount           bigint,
  p_note             text,
  p_expected_version int
)
returns public.savings_goals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_goal   public.savings_goals;
  v_cat_id uuid;
  v_tx_id  uuid;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if p_amount <= 0 then
    raise exception '金额必须大于 0';
  end if;

  select * into v_goal from public.savings_goals
    where id = p_goal_id and status = 'active' for update;
  if not found then
    raise exception '储蓄目标不存在或已删除';
  end if;
  if not private.is_family_member(v_goal.family_id) then
    raise exception '无权操作该家庭数据' using errcode = '42501';
  end if;
  if v_goal.version <> p_expected_version then
    raise exception '版本冲突，请刷新后重试' using errcode = '40001';
  end if;

  select id into v_cat_id from public.categories
    where is_system and family_id is null and name = '储蓄·目标存入' limit 1;

  -- 存入：资金离开可支配池 → expense，source=savings_deposit（排除于消费分析）
  insert into public.transactions
    (family_id, type, amount, category_id, note, recorder_user_id, source, savings_goal_id)
    values (v_goal.family_id, 'expense', p_amount, v_cat_id, p_note, v_uid,
            'savings_deposit', p_goal_id)
    returning id into v_tx_id;

  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (p_goal_id, 'deposit', p_amount, p_note, v_tx_id);

  update public.savings_goals
    set saved_amount = saved_amount + p_amount,
        version      = version + 1,
        achieved_at  = case
                         when achieved_at is null
                              and saved_amount + p_amount >= target_amount
                         then now() else achieved_at end
    where id = p_goal_id
    returning * into v_goal;

  return v_goal;
end;
$$;

-- ── savings_withdraw：取出（收入类流水 + entry + 更新目标，乐观锁）──────────────
create or replace function public.savings_withdraw(
  p_goal_id          uuid,
  p_amount           bigint,
  p_note             text,
  p_expected_version int
)
returns public.savings_goals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_goal   public.savings_goals;
  v_cat_id uuid;
  v_tx_id  uuid;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if p_amount <= 0 then
    raise exception '金额必须大于 0';
  end if;

  select * into v_goal from public.savings_goals
    where id = p_goal_id and status = 'active' for update;
  if not found then
    raise exception '储蓄目标不存在或已删除';
  end if;
  if not private.is_family_member(v_goal.family_id) then
    raise exception '无权操作该家庭数据' using errcode = '42501';
  end if;
  if v_goal.version <> p_expected_version then
    raise exception '版本冲突，请刷新后重试' using errcode = '40001';
  end if;
  if v_goal.saved_amount < p_amount then
    raise exception '取出金额超过已存金额';
  end if;

  select id into v_cat_id from public.categories
    where is_system and family_id is null and name = '储蓄·目标取出' limit 1;

  -- 取出：资金回到可支配池 → income，source=savings_withdraw（排除于消费分析）
  insert into public.transactions
    (family_id, type, amount, category_id, note, recorder_user_id, source, savings_goal_id)
    values (v_goal.family_id, 'income', p_amount, v_cat_id, p_note, v_uid,
            'savings_withdraw', p_goal_id)
    returning id into v_tx_id;

  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (p_goal_id, 'withdraw', p_amount, p_note, v_tx_id);

  update public.savings_goals
    set saved_amount = saved_amount - p_amount,
        version      = version + 1
    where id = p_goal_id
    returning * into v_goal;

  return v_goal;
end;
$$;

-- 收紧 EXECUTE 授权：撤销 PUBLIC，仅授予 authenticated
revoke execute on function public.create_family(text, text)              from public;
revoke execute on function public.join_family_by_code(text)              from public;
revoke execute on function public.savings_deposit(uuid, bigint, text, int)  from public;
revoke execute on function public.savings_withdraw(uuid, bigint, text, int) from public;

grant execute on function public.create_family(text, text)               to authenticated;
grant execute on function public.join_family_by_code(text)               to authenticated;
grant execute on function public.savings_deposit(uuid, bigint, text, int)   to authenticated;
grant execute on function public.savings_withdraw(uuid, bigint, text, int)  to authenticated;

-- ============================================================
-- >>> migrations/20260617120010_seed_system_categories.sql
-- ============================================================
-- 0010 · 系统预设分类（family_id = null, is_system = true）
-- ----------------------------------------------------------------------------
-- 起步默认集（待产品最终确认）。图标用 SF Symbols 名占位。
-- 储蓄两项为资金闭环 RPC 依赖项（按名称 '储蓄·目标存入' / '储蓄·目标取出' 查找），勿改名。
-- 幂等：on conflict 命中 categories_uniq_system_name 部分唯一索引时跳过。

insert into public.categories (family_id, name, icon, type, is_system, status) values
  -- 支出
  (null, '餐饮',   'fork.knife',                 'expense', true, 'active'),
  (null, '交通',   'car.fill',                   'expense', true, 'active'),
  (null, '购物',   'bag.fill',                   'expense', true, 'active'),
  (null, '居家',   'house.fill',                 'expense', true, 'active'),
  (null, '娱乐',   'gamecontroller.fill',        'expense', true, 'active'),
  (null, '医疗',   'cross.case.fill',            'expense', true, 'active'),
  (null, '教育',   'book.fill',                  'expense', true, 'active'),
  (null, '人情',   'gift.fill',                  'expense', true, 'active'),
  (null, '其他支出', 'ellipsis.circle.fill',      'expense', true, 'active'),
  -- 收入
  (null, '工资',   'dollarsign.circle.fill',     'income',  true, 'active'),
  (null, '奖金',   'star.fill',                  'income',  true, 'active'),
  (null, '理财',   'chart.line.uptrend.xyaxis',  'income',  true, 'active'),
  (null, '其他收入', 'ellipsis.circle.fill',      'income',  true, 'active'),
  -- 储蓄（资金闭环专用，RPC 依赖名称）
  (null, '储蓄·目标存入', 'arrow.down.circle.fill', 'expense', true, 'active'),
  (null, '储蓄·目标取出', 'arrow.up.circle.fill',   'income',  true, 'active')
on conflict do nothing;

commit;
