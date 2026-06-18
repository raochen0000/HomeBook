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
