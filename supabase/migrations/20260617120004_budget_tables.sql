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
