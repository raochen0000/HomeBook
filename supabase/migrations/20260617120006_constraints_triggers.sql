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
