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
