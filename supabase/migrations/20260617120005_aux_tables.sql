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
