-- 0037 · 首页概览：完整账期聚合，避免 Hero 依赖首页流水首屏页
-- ----------------------------------------------------------------------------
-- 数据库端口被防火墙拦截，请在 Supabase Studio → SQL Editor 执行本文件（不要走 psql/CLI）。

create or replace function public.get_home_dashboard(p_period text)
returns table (
  family_id uuid,
  is_owner boolean,
  budget_total_amount bigint,
  income_amount bigint,
  expense_amount bigint,
  balance_amount bigint,
  transaction_count bigint,
  budget_used_amount bigint
)
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_family public.families;
  v_start timestamptz;
  v_end timestamptz;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception '账期格式必须为 YYYY-MM' using errcode = '22007';
  end if;

  select f.*
  into v_family
  from public.families f
  join public.memberships m on m.family_id = f.id
  where m.user_id = v_uid
    and m.status = 'active'
  limit 1;

  if not found then
    return;
  end if;

  v_start := (p_period || '-01 00:00:00')::timestamp at time zone v_family.timezone;
  v_end := ((p_period || '-01')::date + interval '1 month')::timestamp at time zone v_family.timezone;

  return query
  with transaction_totals as (
    select
      coalesce(sum(t.amount) filter (where t.type = 'income'), 0)::bigint as income_amount,
      coalesce(sum(t.amount) filter (where t.type = 'expense'), 0)::bigint as expense_amount,
      count(*)::bigint as transaction_count,
      coalesce(sum(t.amount) filter (where t.type = 'expense' and t.source = 'normal'), 0)::bigint as budget_used_amount
    from public.transactions t
    where t.family_id = v_family.id
      and t.is_deleted = false
      and t.occurred_at >= v_start
      and t.occurred_at < v_end
  )
  select
    v_family.id,
    v_family.owner_user_id = v_uid,
    b.total_amount,
    totals.income_amount,
    totals.expense_amount,
    (totals.income_amount - totals.expense_amount)::bigint,
    totals.transaction_count,
    totals.budget_used_amount
  from transaction_totals totals
  left join public.budgets b
    on b.family_id = v_family.id
   and b.period = p_period;
end;
$$;

revoke all on function public.get_home_dashboard(text) from public;
grant execute on function public.get_home_dashboard(text) to authenticated;

comment on function public.get_home_dashboard(text) is
  '当前活动家庭指定账期的首页 Hero 聚合；预算已用仅统计普通支出。';
