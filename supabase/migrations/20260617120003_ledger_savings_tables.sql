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
