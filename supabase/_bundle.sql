-- 家账 HomeBook · 全量建库脚本（22 个迁移按序合并）
-- 用法：在自托管实例的 Studio → SQL Editor 整段粘贴执行一次。
-- 全程包在一个事务里，任一步出错整体回滚，便于安全重试。
-- 注意：表无 IF NOT EXISTS，仅供首次建库；重复执行会因对象已存在而报错（属预期）。
-- 本文件由 scripts/build-supabase-bundle.sh 自动生成，请勿手改；改迁移后重跑脚本。

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

-- ============================================================
-- >>> migrations/20260618120011_create_invitation_rpc.sql
-- ============================================================
-- 0011 · create_invitation RPC（户主生成邀请码）
-- ----------------------------------------------------------------------------
-- 对应 PRD §5「流程 3：户主邀请家人加入」：
--   * 仅户主可生成（前置条件 5.2）
--   * 家庭满 8 人则拦截（异常 5.5「家庭人数已满」）
--   * 24h 有效期；不限次数，户主可随时刷新
--   * 打开邀请页复用当前有效码；显式刷新（p_force_new=true）则作废旧码再生成新码（流程图 L「作废旧码 重新生成」）
-- 与 join_family_by_code（0009）配套，闭合邀请→加入链路。

create or replace function public.create_invitation(p_force_new boolean default false)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_family   uuid;
  v_code     text;
  v_inv      public.invitations;
  v_attempts int := 0;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  -- 仅户主（active owner）可生成
  select family_id into v_family from public.memberships
    where user_id = v_uid and role = 'owner' and status = 'active';
  if v_family is null then
    raise exception '仅户主可生成邀请码' using errcode = '42501';
  end if;

  -- 家庭已满则无需邀请（PRD 异常 5.5）
  if (select member_count from public.families where id = v_family) >= 8 then
    raise exception '家庭成员已达上限（8 人），需先移除成员';
  end if;

  -- 非强制刷新：复用当前未过期的有效码（打开邀请页场景）
  if not p_force_new then
    select * into v_inv from public.invitations
      where family_id = v_family and status = 'valid' and expires_at > now()
      order by expires_at desc limit 1;
    if found then
      return v_inv;
    end if;
  end if;

  -- 刷新或无有效码：作废家庭现有 valid 码，再生成新码
  update public.invitations set status = 'revoked'
    where family_id = v_family and status = 'valid';

  -- 生成 8 位大写十六进制码（取自随机 UUID，仅用核心函数，无 pgcrypto 依赖）；冲突重试
  loop
    v_attempts := v_attempts + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.invitations (family_id, code, expires_at, status)
        values (v_family, v_code, now() + interval '24 hours', 'valid')
        returning * into v_inv;
      return v_inv;
    exception when unique_violation then
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.create_invitation(boolean) from public;
grant execute on function public.create_invitation(boolean) to authenticated;

-- ============================================================
-- >>> migrations/20260619120012_family_lifecycle_rpcs.sql
-- ============================================================
-- 0012 · 家庭生命周期 RPC（PRD 流程 5：转让 / 退出 / 解散）+ 关键通知（流程 13）
-- ----------------------------------------------------------------------------
-- 均 SECURITY DEFINER：绕过 RLS 在服务端完成多表事务，函数内自行鉴权与归属校验。
-- member_count 手动维护（与 0009 一致，无计数触发器）。
-- 这些流转「必须在线」（不进离线队列，TECH §6.5）。

-- ── transfer_ownership：户主把户主身份转让给本家庭某成员 ──────────────────────
create or replace function public.transfer_ownership(p_new_owner uuid)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_family uuid;
  v_fam    public.families;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if p_new_owner = v_uid then
    raise exception '不能转让给自己';
  end if;

  -- 调用者必须是 active 户主
  select family_id into v_family from public.memberships
    where user_id = v_uid and role = 'owner' and status = 'active';
  if v_family is null then
    raise exception '仅户主可转让' using errcode = '42501';
  end if;

  -- 目标必须是同家庭 active 成员
  if not exists (select 1 from public.memberships
                 where family_id = v_family and user_id = p_new_owner and status = 'active') then
    raise exception '目标不是本家庭成员';
  end if;

  -- 先降原户主、再升新户主（避免「户主唯一」部分索引瞬时冲突）
  update public.memberships set role = 'member'
    where family_id = v_family and user_id = v_uid and status = 'active';
  update public.memberships set role = 'owner'
    where family_id = v_family and user_id = p_new_owner and status = 'active';

  update public.families set owner_user_id = p_new_owner
    where id = v_family
    returning * into v_fam;

  -- 通知新户主（流程 13）
  insert into public.notifications (user_id, type, channel, payload)
    values (p_new_owner, 'transfer', 'in_app',
            jsonb_build_object('family_id', v_family, 'family_name', v_fam.name));

  return v_fam;
end;
$$;

-- ── leave_family：普通成员退出（户主须先转让或解散）────────────────────────────
create or replace function public.leave_family()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_mem public.memberships;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  select * into v_mem from public.memberships
    where user_id = v_uid and status = 'active';
  if not found then
    raise exception '你当前不在任何家庭';
  end if;
  if v_mem.role = 'owner' then
    raise exception '户主需先转让户主或解散家庭';
  end if;

  update public.memberships set status = 'left', left_at = now()
    where id = v_mem.id;
  update public.families set member_count = greatest(member_count - 1, 0)
    where id = v_mem.family_id;
  update public.profiles set current_family_id = null where id = v_uid;
end;
$$;

-- ── dissolve_family：户主解散家庭（软解散 + 解绑成员 + 通知）────────────────────
-- DATAMODEL §7 要求最终物理清理家庭数据，可异步执行；此处先做软解散（标记 dissolved
-- + 解绑全部成员），解绑后 RLS（is_family_member）对所有人返回 false，数据即不可读。
create or replace function public.dissolve_family()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_family uuid;
  v_name   text;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  select m.family_id, f.name into v_family, v_name
    from public.memberships m
    join public.families f on f.id = m.family_id
    where m.user_id = v_uid and m.role = 'owner' and m.status = 'active';
  if v_family is null then
    raise exception '仅户主可解散家庭' using errcode = '42501';
  end if;

  -- 通知其他成员（流程 13：家庭已解散，按 removed 兜底 + payload 区分原因）
  insert into public.notifications (user_id, type, channel, payload)
    select m.user_id, 'removed', 'in_app',
           jsonb_build_object('reason', 'dissolved', 'family_name', v_name)
      from public.memberships m
     where m.family_id = v_family and m.status = 'active' and m.user_id <> v_uid;

  -- 解绑全部成员（含户主），并清空各自的 current_family_id
  update public.memberships set status = 'left', left_at = now()
    where family_id = v_family and status = 'active';
  update public.profiles set current_family_id = null
    where current_family_id = v_family;

  -- 作废未用邀请码，标记家庭解散
  update public.invitations set status = 'revoked'
    where family_id = v_family and status = 'valid';
  update public.families set status = 'dissolved', member_count = 0
    where id = v_family;
end;
$$;

-- 收紧 EXECUTE 授权：撤销 PUBLIC，仅授予 authenticated
revoke execute on function public.transfer_ownership(uuid) from public;
revoke execute on function public.leave_family()           from public;
revoke execute on function public.dissolve_family()        from public;

grant execute on function public.transfer_ownership(uuid) to authenticated;
grant execute on function public.leave_family()            to authenticated;
grant execute on function public.dissolve_family()         to authenticated;

-- ============================================================
-- >>> migrations/20260619120013_remove_member_rpc.sql
-- ============================================================
-- 0013 · 户主移除成员 RPC（PRD 流程 6）+ 关键通知（流程 13）
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER：服务端完成多表事务，函数内自鉴权与归属校验。沿用 0012 生命周期 RPC 风格。
-- 移除 = 软删（status=removed）+ 解绑被移除者 current_family_id + 写 removed 通知。
-- 被移除者历史流水保留在家庭（DATAMODEL §3.3）；其新单人家庭由前台首次记账时自动创建
-- （与 leave_family 一致，不在此处建，避免重复逻辑）。

create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_family uuid;
  v_name   text;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if p_user_id = v_uid then
    raise exception '不能移除自己，请走退出或解散';
  end if;

  -- 调用者必须是 active 户主
  select m.family_id, f.name into v_family, v_name
    from public.memberships m
    join public.families f on f.id = m.family_id
    where m.user_id = v_uid and m.role = 'owner' and m.status = 'active';
  if v_family is null then
    raise exception '仅户主可移除成员' using errcode = '42501';
  end if;

  -- 目标必须是同家庭 active 成员
  if not exists (select 1 from public.memberships
                 where family_id = v_family and user_id = p_user_id and status = 'active') then
    raise exception '目标不是本家庭成员';
  end if;

  -- 软删除该成员、维护计数、解绑其当前家庭
  update public.memberships set status = 'removed', left_at = now()
    where family_id = v_family and user_id = p_user_id and status = 'active';
  update public.families set member_count = greatest(member_count - 1, 0)
    where id = v_family;
  update public.profiles set current_family_id = null where id = p_user_id;

  -- 通知被移除者（流程 13：被移出家庭）
  insert into public.notifications (user_id, type, channel, payload)
    values (p_user_id, 'removed', 'in_app',
            jsonb_build_object('reason', 'removed', 'family_name', v_name));
end;
$$;

-- 收紧 EXECUTE 授权：撤销 PUBLIC，仅授予 authenticated
revoke execute on function public.remove_member(uuid) from public;
grant execute on function public.remove_member(uuid) to authenticated;

-- ============================================================
-- >>> migrations/20260619120014_delete_savings_goal_rpc.sql
-- ============================================================
-- 0014 · 删除储蓄目标 RPC（PRD 流程 7：仅户主可删，已存余额回吐为收入流水）
-- ----------------------------------------------------------------------------
-- 资金守恒（PRD §9.6）：删除时若 saved_amount > 0，按「取出」口径生成一笔收入流水
-- （分类「储蓄·目标取出」，source=savings_withdraw）+ savings_entry，再标记目标 deleted。
-- 复用 0009 savings_withdraw 的记账口径，整体在一个事务内完成。

create or replace function public.delete_savings_goal(p_goal_id uuid)
returns void
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

  select * into v_goal from public.savings_goals
    where id = p_goal_id and status = 'active' for update;
  if not found then
    raise exception '储蓄目标不存在或已删除';
  end if;

  -- 仅户主可删除（PRD §9.3）
  if not exists (select 1 from public.memberships
                 where family_id = v_goal.family_id and user_id = v_uid
                   and role = 'owner' and status = 'active') then
    raise exception '仅户主可删除储蓄目标' using errcode = '42501';
  end if;

  -- 已存余额回吐为收入流水（资金守恒）
  if v_goal.saved_amount > 0 then
    select id into v_cat_id from public.categories
      where is_system and family_id is null and name = '储蓄·目标取出' limit 1;

    insert into public.transactions
      (family_id, type, amount, category_id, note, recorder_user_id, source, savings_goal_id)
      values (v_goal.family_id, 'income', v_goal.saved_amount, v_cat_id, '删除目标回吐余额',
              v_uid, 'savings_withdraw', p_goal_id)
      returning id into v_tx_id;

    insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
      values (p_goal_id, 'withdraw', v_goal.saved_amount, '删除目标回吐余额', v_tx_id);
  end if;

  update public.savings_goals
    set status = 'deleted', saved_amount = 0, version = version + 1
    where id = p_goal_id;
end;
$$;

revoke execute on function public.delete_savings_goal(uuid) from public;
grant execute on function public.delete_savings_goal(uuid) to authenticated;

-- ============================================================
-- >>> migrations/20260621120015_join_reactivate_membership.sql
-- ============================================================
-- 0015 · 修复：退出/被移除后用同一邀请码重新加入会撞唯一约束
-- ----------------------------------------------------------------------------
-- memberships 上有全表唯一约束 unique (family_id, user_id)（约束名
-- memberships_family_id_user_id_key），不区分 status。leave_family / remove_member
-- 均为软删除（保留行，status 置 'left' / 'removed'），因此再次加入同一家庭时，
-- 0009 版 join_family_by_code 直接 INSERT 会与历史行冲突，报
-- 「duplicate key value violates unique constraint "memberships_family_id_user_id_key"」。
--
-- 修复：改用 INSERT ... ON CONFLICT (family_id, user_id) DO UPDATE，命中历史行时
-- 复活为 active（重置 role/joined_at，清空 left_at），而非新增行。
-- 仅当当前无 active 行才会走到这里（前置校验保证），故复活后仍满足
-- memberships_one_active_per_user 部分唯一索引。成员上限由前置计数 + 0006
-- BEFORE INSERT 触发器（on-conflict 的 insert 尝试阶段仍会触发）双重兜底。

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

  -- 复活历史成员行（曾退出/被移除），否则新增；避免与 unique(family_id,user_id) 冲突
  insert into public.memberships (family_id, user_id, role, status, joined_at, left_at)
    values (v_inv.family_id, v_uid, 'member', 'active', now(), null)
  on conflict (family_id, user_id) do update
    set role      = 'member',
        status    = 'active',
        joined_at = now(),
        left_at   = null;

  update public.families set member_count = member_count + 1
    where id = v_inv.family_id
    returning * into v_family;

  update public.profiles set current_family_id = v_inv.family_id where id = v_uid;

  return v_family;
end;
$$;

-- 重新收紧 EXECUTE 授权（create or replace 不改授权，此处幂等重申）
revoke execute on function public.join_family_by_code(text) from public;
grant  execute on function public.join_family_by_code(text) to authenticated;

-- ============================================================
-- >>> migrations/20260622120016_family_hidden_categories.sql
-- ============================================================
-- 0016 · FAMILY_HIDDEN_CATEGORIES（家庭隐藏的系统预设分类 · PRD 流程 11 / MVP §2.4）
-- ----------------------------------------------------------------------------
-- 背景：系统预设分类是全局单行（categories.family_id is null, is_system=true），
-- 不能直接把它 status='hidden'——那会对「所有家庭」生效。此表做按家庭覆盖：
-- 一行 = 「该 family 在记账/预算选择器中隐藏了该系统分类」。
-- 全局分类行保持 active，历史流水仍能解析其名称/图标（显示零回归）。
-- 自定义分类的「删除」仍走软删除 categories.status='archived'，不进此表。

create table public.family_hidden_categories (
  family_id   uuid not null references public.families(id)   on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (family_id, category_id)
);

comment on table public.family_hidden_categories is
  '家庭对系统预设分类的隐藏覆盖：仅系统分类（categories.family_id is null）可入此表；自定义分类用 categories.status=archived 软删除。';

-- 完整性：只允许隐藏「系统预设分类」，挡住误把自定义分类写进来。
create or replace function private.assert_hideable_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.categories
    where id = new.category_id and family_id is null and is_system = true
  ) then
    raise exception '只能隐藏系统预设分类（category_id=% 非系统分类）', new.category_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger family_hidden_categories_system_only
  before insert on public.family_hidden_categories
  for each row execute function private.assert_hideable_category();

-- ── RLS：家庭成员可读/隐藏/取消隐藏本家庭的覆盖行（与停用自定义分类一致，户主门禁在前端）──
alter table public.family_hidden_categories enable row level security;

create policy "fhc_select_member" on public.family_hidden_categories
  for select to authenticated
  using (private.is_family_member(family_id));

create policy "fhc_insert_member" on public.family_hidden_categories
  for insert to authenticated
  with check (private.is_family_member(family_id));

create policy "fhc_delete_member" on public.family_hidden_categories
  for delete to authenticated
  using (private.is_family_member(family_id));

-- ============================================================
-- >>> migrations/20260622120017_preview_family_by_code_rpc.sql
-- ============================================================
-- 0017 · preview_family_by_code RPC（流程 4「加入家庭」预览卡 + 加入影响）
-- ----------------------------------------------------------------------------
-- 对应 PRD §6「流程 4：加入家庭」：满 6 位码 → 先拉家庭预览卡 + 加入影响提示，
-- 用户确认后才调 join_family_by_code（0015）真正加入。本函数为**只读**（stable），
-- 不改邀请码 status、不写任何表，纯校验 + 取预览，避免「预览即副作用」。
--
-- 隐私折中档（PRD §6.4）：户主显昵称+头像；其他成员仅返回头像（堆叠），不含昵称。
-- 跨家庭读取目标家庭信息（调用者尚非其成员）→ security definer 绕 RLS，仅暴露受控字段。
--
-- 前置：families 历史上无 cover_url 列（0002 core_tables 未含；types 里的 cover_url 属
-- savings_goals）。预览卡需展示家庭封面，故此处幂等补列，供本 RPC 与家庭设置页共用。

alter table public.families add column if not exists cover_url text;

-- ── 返回契约（jsonb）─────────────────────────────────────────────────────────
-- { "status": "ok" | "invalid" | "expired" | "full" | "already_member",
--   "impact": "none" | "delete_origin" | "auto_leave" | "blocked_owner",   -- 仅 status=ok
--   "family": {                                                            -- status=ok / already_member
--     "id", "name", "cover_url", "member_count", "max_members",
--     "owner": { "nickname", "avatar_url" },
--     "member_avatars": ["url", ...]                                       -- 最多 8，按入家先后
--   }
-- }
--   impact 语义（PRD §6.3 四分支）：
--     none          调用者无家庭 / 单人无记账     → 直接加入
--     delete_origin 单人家庭且有记账             → ⚠ 加入后原家庭+数据删除，需二次确认
--     auto_leave    多人家庭普通成员             → ⚠ 加入后自动退出当前家庭
--     blocked_owner 多人家庭户主                 → ⛔ 禁用加入，先转让/解散
create or replace function public.preview_family_by_code(p_code text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_inv          public.invitations;
  v_family       public.families;
  v_owner        public.profiles;
  v_member_count int;
  v_avatars      jsonb;
  v_cur_family   uuid;
  v_cur_role     text;
  v_cur_count    int;
  v_has_tx       boolean;
  v_impact       text;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  -- 1) 邀请码校验（只读：过期/作废仅报告，不落库）
  select * into v_inv from public.invitations where code = upper(trim(p_code));
  if not found or v_inv.status = 'revoked' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_inv.status = 'expired' or v_inv.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;

  -- 2) 目标家庭 + 户主
  select * into v_family from public.families where id = v_inv.family_id;
  if not found or v_family.status <> 'active' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_owner from public.profiles where id = v_family.owner_user_id;

  -- 3) 已是该家庭 active 成员？
  if exists (
    select 1 from public.memberships
    where family_id = v_family.id and user_id = v_uid and status = 'active'
  ) then
    return jsonb_build_object(
      'status', 'already_member',
      'family', jsonb_build_object('id', v_family.id, 'name', v_family.name)
    );
  end if;

  -- 4) 成员数 + 头像堆叠（满 8 则拦截）
  select count(*) into v_member_count from public.memberships
    where family_id = v_family.id and status = 'active';
  if v_member_count >= 8 then
    return jsonb_build_object('status', 'full');
  end if;

  select coalesce(jsonb_agg(a.avatar_url), '[]'::jsonb) into v_avatars
  from (
    select p.avatar_url
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.family_id = v_family.id and m.status = 'active'
    order by m.joined_at
    limit 8
  ) a;

  -- 5) 调用者加入影响（PRD §6.3 四分支）
  select current_family_id into v_cur_family from public.profiles where id = v_uid;
  if v_cur_family is null then
    v_impact := 'none';
  else
    select role into v_cur_role from public.memberships
      where user_id = v_uid and status = 'active';
    select count(*) into v_cur_count from public.memberships
      where family_id = v_cur_family and status = 'active';

    if v_cur_role = 'owner' and v_cur_count > 1 then
      v_impact := 'blocked_owner';
    elsif v_cur_count > 1 then
      v_impact := 'auto_leave';
    else
      -- 单人家庭：有任一未删除流水即视为「有记账」
      select exists (
        select 1 from public.transactions
        where family_id = v_cur_family and is_deleted = false
      ) into v_has_tx;
      v_impact := case when v_has_tx then 'delete_origin' else 'none' end;
    end if;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'impact', v_impact,
    'family', jsonb_build_object(
      'id',            v_family.id,
      'name',          v_family.name,
      'cover_url',     v_family.cover_url,
      'member_count',  v_member_count,
      'max_members',   8,
      'owner', jsonb_build_object(
        'nickname',   v_owner.nickname,
        'avatar_url', v_owner.avatar_url
      ),
      'member_avatars', v_avatars
    )
  );
end;
$$;

revoke execute on function public.preview_family_by_code(text) from public;
grant  execute on function public.preview_family_by_code(text) to authenticated;

-- ============================================================
-- >>> migrations/20260622120018_invitation_code_6char.sql
-- ============================================================
-- 0018 · 邀请码改为 6 位（排除易混 0/O/1/I），对齐 PRD §5.4
-- ----------------------------------------------------------------------------
-- 原 0011/0015 的 create_invitation 生成 8 位十六进制码；PRD 要求 6 位、大写
-- A–Z + 0–9 且排除易混的 0/O/1/I（便于口述 / 手抄 / 3+3 分段展示）。
-- 本迁移只改「生成码」的字符集与长度，其余逻辑（仅户主、满 8 拦截、24h 有效、
-- 复用未过期有效码、强制刷新作废重生）完全保持不变。
--
-- 字母表 = A–Z 去掉 O/I（24）+ 2–9（8）= 32 字符。6 位 → 32^6 ≈ 1.07e9，冲突重试。
-- 注：邀请码非安全敏感（24h 失效 + 防枚举限频另议），random() 足够。

create or replace function public.create_invitation(p_force_new boolean default false)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_family   uuid;
  v_alpha    text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 字符，排除 0 O 1 I
  v_code     text;
  v_inv      public.invitations;
  v_attempts int := 0;
  i          int;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  -- 仅户主（active owner）可生成
  select family_id into v_family from public.memberships
    where user_id = v_uid and role = 'owner' and status = 'active';
  if v_family is null then
    raise exception '仅户主可生成邀请码' using errcode = '42501';
  end if;

  -- 家庭已满则无需邀请
  if (select member_count from public.families where id = v_family) >= 8 then
    raise exception '家庭成员已达上限（8 人），需先移除成员';
  end if;

  -- 非强制刷新：复用当前未过期的有效码（打开邀请页场景）
  if not p_force_new then
    select * into v_inv from public.invitations
      where family_id = v_family and status = 'valid' and expires_at > now()
      order by expires_at desc limit 1;
    if found then
      return v_inv;
    end if;
  end if;

  -- 刷新或无有效码：作废家庭现有 valid 码，再生成新码
  update public.invitations set status = 'revoked'
    where family_id = v_family and status = 'valid';

  -- 生成 6 位安全字母表码；唯一冲突重试
  loop
    v_attempts := v_attempts + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    begin
      insert into public.invitations (family_id, code, expires_at, status)
        values (v_family, v_code, now() + interval '24 hours', 'valid')
        returning * into v_inv;
      return v_inv;
    exception when unique_violation then
      if v_attempts >= 8 then raise; end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.create_invitation(boolean) from public;
grant execute on function public.create_invitation(boolean) to authenticated;

-- ============================================================
-- >>> migrations/20260622120019_fix_dissolved_family_member_count.sql
-- ============================================================
-- 0019 · 修复：解散家庭时 member_count=0 违反 families_member_count_check
-- ----------------------------------------------------------------------------
-- dissolve_family（0012）末句把家庭置 `status='dissolved', member_count=0`（已无成员），
-- 但 0002 的列级 check 要求 `member_count between 1 and 8`，导致解散整体回滚，报：
--   new row for relation "families" violates check constraint "families_member_count_check"
--
-- 修复：放宽约束——仅「active」家庭受 1–8 约束；已解散家庭允许 0。
-- 解散 RPC 在同一条 UPDATE 同时写 status='dissolved' 与 member_count=0，约束按行最终态校验，故通过。
-- leave_family / remove_member 仅在 ≥2 人时递减（单人户主须走解散/转让），不会触达 0，行为不变。

alter table public.families drop constraint if exists families_member_count_check;

alter table public.families
  add constraint families_member_count_check
  check (status = 'dissolved' or member_count between 1 and 8);

-- ============================================================
-- >>> migrations/20260622120020_storage_policies.sql
-- ============================================================
-- 0020 · Storage 对象权限策略（头像 / 家庭封面）
-- ----------------------------------------------------------------------------
-- 背景：两个 public 桶已在 Studio 手动创建：
--   homebook-user-avatars   用户头像，路径 {用户id}/avatar.ext
--   homebook-family-covers  家庭封面，路径 {家庭id}/cover.ext
-- public 桶的「读」走公开 CDN 端点（/object/public/...），绕过 RLS，无需 select 策略；
-- 但「写 / 删」仍受 storage.objects 的 RLS 管控，故此处只配 insert/update/delete。
--
-- 隔离思路（与 0008 一致）：
--   ① auth.uid() 一律包 (select auth.uid())。
--   ② 一律 TO authenticated（anon 不授权写）。
--   ③ 路径第一层文件夹 = 归属 id —— (storage.foldername(name))[1]。
--   ④ 头像：第一层 = 本人 uid；封面：第一层家庭须由当前用户任户主，复用 private.is_family_owner。
--
-- 注：storage.objects 默认已启用 RLS，此处不重复 alter（需表 owner 权限）。
-- 注：所有策略先 drop if exists 再 create，便于 Studio 重复粘贴执行（幂等）。

-- ── 用户头像：只能写自己 uid 文件夹下的对象 ───────────────────────────────────
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homebook-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'homebook-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'homebook-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'homebook-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ── 家庭封面：仅该家庭户主可写（第一层文件夹 = family_id）──────────────────────
drop policy if exists "covers_insert_owner" on storage.objects;
create policy "covers_insert_owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "covers_update_owner" on storage.objects;
create policy "covers_update_owner" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "covers_delete_owner" on storage.objects;
create policy "covers_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner(((storage.foldername(name))[1])::uuid)
  );

-- ============================================================
-- >>> migrations/20260624120021_storage_policies_flat_paths.sql
-- ============================================================
-- 0021 · Storage 写权限策略改为「桶根目录 + 文件名归属」（替换 0020 的文件夹方案）
-- ----------------------------------------------------------------------------
-- 背景：本自托管实例的 storage.prefixes 表开了 RLS，却归 supabase_storage_admin 独占、
--   postgres（含 Studio SQL Editor）无权加策略。路径一旦含子文件夹（{id}/avatar.jpg），
--   插入 storage.objects 时其 BEFORE INSERT 触发器会先向 prefixes 写目录前缀行，该步被
--   RLS 拒 → 整笔上传回滚，报 "new row violates row-level security policy"；且这步发生在
--   objects 策略被检查之前，无法用 objects 策略绕过。
-- 对策：上传改落桶根目录（{id}.jpg，见 src/adapters/storage.ts）。根对象 foldername 为空，
--   不触发 prefixes 写入，从根上规避该限制。相应地，本迁移把 objects 的归属判定从
--   「第一层文件夹」(storage.foldername(name))[1] 改为「文件名去扩展名」split_part(name,'.',1)，
--   即归属 id（uuid 不含点，故按首个 '.' 切分即得纯 id）。
-- 注：本迁移只动 storage.objects（postgres 可管），不碰 storage.prefixes，可在 Studio 直接执行。
-- 注：策略名沿用 0020，drop if exists 后 create，幂等替换旧定义（含 upsert 覆盖需要的 update）。

-- ── 用户头像：只能写文件名 = 本人 uid 的根对象 ────────────────────────────────
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = (select auth.uid())::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = (select auth.uid())::text
  )
  with check (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = (select auth.uid())::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = (select auth.uid())::text
  );

-- ── 家庭封面：仅该家庭户主可写（文件名 = family_id）───────────────────────────
drop policy if exists "covers_insert_owner" on storage.objects;
create policy "covers_insert_owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner((split_part(name, '.', 1))::uuid)
  );

drop policy if exists "covers_update_owner" on storage.objects;
create policy "covers_update_owner" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner((split_part(name, '.', 1))::uuid)
  )
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner((split_part(name, '.', 1))::uuid)
  );

drop policy if exists "covers_delete_owner" on storage.objects;
create policy "covers_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner((split_part(name, '.', 1))::uuid)
  );

-- ============================================================
-- >>> migrations/20260624120022_storage_policies_owner_based.sql
-- ============================================================
-- 0022 · Storage 读写策略：SELECT 放行 + 写按 owner 列把关
-- ----------------------------------------------------------------------------
-- 背景（实测结论）：
--   1) storage 上传走 upsert：`insert ... on conflict do update ... returning *`。
--      ON CONFLICT 要读冲突行、RETURNING 要把行读回 —— 这两步都要求 objects 上有
--      一条 SELECT 策略。只建 insert/update 的"只写"策略，upsert 会因读不到而被 RLS
--      拒，报 "new row violates row-level security policy"。这是本项目反复踩的真正坑：
--      之前唯一能成的「全开」策略，胜在它顺手建了 SELECT，而非因为它 TO public。
--   2) storage 执行时角色就是 authenticated、JWT 声明也在，但本实例的 auth.uid() 在
--      storage 上下文里取不到 sub（GUC 名不一致），故不依赖 auth.uid()；改用 storage
--      服务端盖在 objects.owner / owner_id 列上的真实 uid（客户端伪造不了）来判归属。
--
-- 设计：
--   · 读：两个 public 桶本就走公开 CDN，这里的 SELECT 策略只为放行 upsert 的读，TO public。
--   · 写：TO public（角色判定无意义，已知是 authenticated），用 owner 列做归属。
--       头像 —— 文件名(去扩展名) = owner；封面 —— owner 须为该家庭 active 户主。
--   · 不开放客户端 DELETE（App 不需要；删除走控制台 service_role）。
--   · 归属 id 取 coalesce(owner::text, owner_id)；文件名取 split_part(name,'.',1)。
--   · 零信任需求请改走 Edge Function + service_role 服务端代传，再把写策略收紧为拒绝。

-- 户主判定：显式传入用户，不依赖 auth.uid()（与 0007 的 is_family_owner 同逻辑、入参不同）
create or replace function private.is_user_family_owner(_user uuid, _family uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.family_id = _family
      and m.user_id = _user
      and m.role = 'owner'
      and m.status = 'active'
  );
$$;
grant execute on function private.is_user_family_owner(uuid, uuid) to public;

-- ── 清理：0020/0021 的旧策略 + 排查期手动建的临时策略（幂等，drop if exists） ──
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and ( policyname in (
              'avatars_select','avatars_insert_own','avatars_update_own','avatars_delete_own',
              'covers_select','covers_insert_owner','covers_update_owner','covers_delete_owner',
              'avatars_insert_anon_TEST'
            )
            or policyname like 'full-access-policy%' )   -- UI 建的全开临时策略（带哈希后缀）
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- ── 用户头像 ─────────────────────────────────────────────────────────────────
-- SELECT：放行 upsert 的读（桶本就公开），TO public
create policy "avatars_select" on storage.objects
  for select to public
  using (bucket_id = 'homebook-user-avatars');

-- INSERT/UPDATE：文件名必须等于上传者本人（owner）
create policy "avatars_insert_own" on storage.objects
  for insert to public
  with check (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = coalesce(owner::text, owner_id)
  );

create policy "avatars_update_own" on storage.objects
  for update to public
  using (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = coalesce(owner::text, owner_id)
  )
  with check (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = coalesce(owner::text, owner_id)
  );

-- ── 家庭封面 ─────────────────────────────────────────────────────────────────
create policy "covers_select" on storage.objects
  for select to public
  using (bucket_id = 'homebook-family-covers');

-- 写：上传者须为该家庭的 active 户主
create policy "covers_insert_owner" on storage.objects
  for insert to public
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_user_family_owner(
          coalesce(owner::text, owner_id)::uuid,
          (split_part(name, '.', 1))::uuid)
  );

create policy "covers_update_owner" on storage.objects
  for update to public
  using (
    bucket_id = 'homebook-family-covers'
    and private.is_user_family_owner(
          coalesce(owner::text, owner_id)::uuid,
          (split_part(name, '.', 1))::uuid)
  )
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_user_family_owner(
          coalesce(owner::text, owner_id)::uuid,
          (split_part(name, '.', 1))::uuid)
  );

commit;
