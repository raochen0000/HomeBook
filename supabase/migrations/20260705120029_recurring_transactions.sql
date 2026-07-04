-- 0029 · 定时收支：recurring_transactions（家庭共享规则）+ recurring_runs（幂等台账）
--        + generate_due_recurring_transactions() 补记 RPC（PRD §18 自定义能力 / DATAMODEL §5.9）
-- ----------------------------------------------------------------------------
-- 数据库端口被防火墙拦截，请在 Supabase Studio → SQL Editor 执行本文件（不要走 psql/CLI）。
--
-- 语义（产品定稿）：用户在「记账设置 → 定时收支」维护「每月 N 号自动记一笔」的规则（如工资、订阅）。
-- 规则家庭共享（口径同流水账本，RLS 复用 private.is_family_member）；生成的流水记入家庭账本，
-- 记账人 = 规则创建者（recorder_user_id）。自动记录采用「客户端触发、服务端幂等生成」：客户端在
-- App 前台调 generate_due_recurring_transactions() 补记缺失的到期流水，recurring_runs 上的
-- unique(rule_id, period_key) 保证多设备 / 多成员并发下同一期只生成一条。

-- ── RECURRING_TRANSACTIONS（定时收支规则）────────────────────────────────────
create table public.recurring_transactions (
  id               uuid primary key default gen_random_uuid(),
  family_id        uuid not null references public.families(id) on delete cascade,
  type             text not null check (type in ('expense','income')),
  amount           bigint not null check (amount > 0),                 -- 单位：分
  category_id      uuid not null references public.categories(id),
  note             text,
  recorder_user_id uuid not null references public.profiles(id),       -- 生成流水的记账人 = 规则创建者
  created_by       uuid not null references public.profiles(id),
  day_of_month     int  not null check (day_of_month between 1 and 28), -- 限 1–28，规避小月 29–31 不存在的边界
  frequency        text not null default 'monthly' check (frequency in ('monthly')), -- 预留列，MVP 仅按月
  start_date       date not null,                                      -- 首个生效月（含）
  end_date         date,                                               -- 可选结束（含）；null = 长期有效
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index recurring_transactions_family_idx
  on public.recurring_transactions (family_id) where enabled;

create trigger set_updated_at before update on public.recurring_transactions
  for each row execute function public.set_updated_at();

-- ── RECURRING_RUNS（幂等台账：每规则每期至多一行）─────────────────────────────
-- 客户端一般不直接写本表——由 generate_due_recurring_transactions() 在服务端写。
-- transaction_id 可空：补记时「先占位 run（抢 unique）成功者才建流水并回填」，避免并发重复建流水。
create table public.recurring_runs (
  id             uuid primary key default gen_random_uuid(),
  rule_id        uuid not null references public.recurring_transactions(id) on delete cascade,
  period_key     text not null,                                        -- 期键，如 '2026-07'
  transaction_id uuid references public.transactions(id),
  created_at     timestamptz not null default now(),
  unique (rule_id, period_key)                                         -- 幂等的关键
);

create index recurring_runs_rule_idx on public.recurring_runs (rule_id);

-- 表权限：本表建于 0008「grant on all tables」之后，显式补授。
-- recurring_transactions 客户端全 CRUD（无物理 delete 限制——规则可真删）；recurring_runs 仅读。
grant select, insert, update, delete on public.recurring_transactions to authenticated;
grant select on public.recurring_runs to authenticated;

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table public.recurring_transactions enable row level security;
alter table public.recurring_runs        enable row level security;

-- 规则：家庭成员可增删改查本家庭规则（复用 transactions 同款 private.is_family_member）。
create policy "recurring_txn_select_member" on public.recurring_transactions
  for select to authenticated
  using (private.is_family_member(family_id));

create policy "recurring_txn_insert_member" on public.recurring_transactions
  for insert to authenticated
  with check (private.is_family_member(family_id) and created_by = (select auth.uid()));

create policy "recurring_txn_update_member" on public.recurring_transactions
  for update to authenticated
  using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));

create policy "recurring_txn_delete_member" on public.recurring_transactions
  for delete to authenticated
  using (private.is_family_member(family_id));

-- 台账：经所属规则的家庭归属做只读（写入仅经 RPC，SECURITY DEFINER 绕过 RLS）。
create policy "recurring_runs_select_member" on public.recurring_runs
  for select to authenticated
  using (exists (
    select 1 from public.recurring_transactions r
    where r.id = recurring_runs.rule_id and private.is_family_member(r.family_id)
  ));

-- ── RPC：补记调用者当前家庭到期的定时收支（幂等、原子）────────────────────────
-- SECURITY DEFINER：绕过 transactions_insert 的「recorder_user_id = auth.uid()」限制，
-- 以规则创建者身份代记。返回本次新生成的流水条数。
create or replace function public.generate_due_recurring_transactions()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_fid    uuid;
  v_tz     text;
  v_rule   public.recurring_transactions;
  v_month  date;
  v_sched  date;
  v_period text;
  v_run_id uuid;
  v_txn_id uuid;
  v_count  int := 0;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  select current_family_id into v_fid from public.profiles where id = v_uid;
  if v_fid is null then
    return 0;
  end if;
  select timezone into v_tz from public.families where id = v_fid;

  for v_rule in
    select * from public.recurring_transactions
    where family_id = v_fid and enabled
  loop
    v_month := date_trunc('month', v_rule.start_date)::date;
    while v_month <= current_date loop
      v_sched := make_date(
        extract(year  from v_month)::int,
        extract(month from v_month)::int,
        v_rule.day_of_month
      );
      if v_sched >= v_rule.start_date
         and v_sched <= current_date
         and (v_rule.end_date is null or v_sched <= v_rule.end_date)
      then
        v_period := to_char(v_month, 'YYYY-MM');
        -- 先抢占 run（unique 为闸）：抢到者才建流水并回填，避免并发重复建。
        insert into public.recurring_runs (rule_id, period_key)
          values (v_rule.id, v_period)
          on conflict (rule_id, period_key) do nothing
          returning id into v_run_id;
        if v_run_id is not null then
          insert into public.transactions
            (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source)
          values (
            v_rule.family_id, v_rule.type, v_rule.amount, v_rule.category_id, v_rule.note,
            make_timestamptz(
              extract(year  from v_sched)::int,
              extract(month from v_sched)::int,
              v_rule.day_of_month, 12, 0, 0,
              coalesce(v_tz, 'Asia/Shanghai')
            ),
            v_rule.recorder_user_id, 'normal'
          )
          returning id into v_txn_id;
          update public.recurring_runs set transaction_id = v_txn_id where id = v_run_id;
          v_count := v_count + 1;
        end if;
        v_run_id := null;
      end if;
      v_month := (v_month + interval '1 month')::date;
    end loop;
  end loop;

  return v_count;
end;
$$;

-- PG 默认把 EXECUTE 授予 PUBLIC，收紧后仅授 authenticated（同 0009 约定）。
revoke execute on function public.generate_due_recurring_transactions() from public;
grant execute on function public.generate_due_recurring_transactions() to authenticated;
