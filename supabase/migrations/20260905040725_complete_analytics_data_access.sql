-- 0046 · 完整统计数据访问：按家庭账期聚合，明细独立分页
-- ----------------------------------------------------------------------------
-- 统计不得依赖客户端已加载流水。所有函数以 auth.uid() 解析当前活动家庭，
-- security invoker 保持底表 RLS 生效；账期边界统一由 families.timezone 推导。

-- 预算、分类报表和分类下钻按家庭 + 分类 + 时间过滤；成员筛选也有独立路径。
-- 现有 family + occurred_at 索引继续服务无筛选的总览，不为低选择性的列堆叠索引。
create index transactions_family_normal_expense_category_occurred_idx
  on public.transactions (family_id, category_id, occurred_at desc)
  where is_deleted = false and type = 'expense' and source = 'normal';

create index transactions_family_recorder_occurred_idx
  on public.transactions (family_id, recorder_user_id, occurred_at desc)
  where is_deleted = false;

create or replace function public.get_monthly_summary(p_period text)
returns table (
  earliest_period text,
  transaction_count bigint,
  income_amount bigint,
  expense_amount bigint,
  consumption_expense_amount bigint,
  previous_income_amount bigint,
  previous_expense_amount bigint,
  max_expense_id uuid,
  max_expense_amount bigint,
  max_expense_category_id uuid,
  max_expense_occurred_at timestamptz,
  top_category_id uuid,
  top_category_amount bigint,
  top_recorder_user_id uuid,
  top_recorder_count bigint
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
  v_prev_start timestamptz;
  v_prev_end timestamptz;
  v_previous_compare_end timestamptz;
  v_day_cap integer;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception '账期格式必须为 YYYY-MM' using errcode = '22007';
  end if;

  select f.* into v_family
  from public.families f
  join public.memberships m on m.family_id = f.id
  where m.user_id = v_uid and m.status = 'active'
  limit 1;
  if not found then return; end if;

  v_start := (p_period || '-01 00:00:00')::timestamp at time zone v_family.timezone;
  v_end := ((p_period || '-01')::date + interval '1 month')::timestamp at time zone v_family.timezone;
  v_prev_start := ((p_period || '-01')::date - interval '1 month')::timestamp at time zone v_family.timezone;
  v_prev_end := v_start;
  v_day_cap := extract(day from (now() at time zone v_family.timezone))::integer;
  v_previous_compare_end := case
    when p_period = to_char(now() at time zone v_family.timezone, 'YYYY-MM')
      then least(v_prev_end, v_prev_start + v_day_cap * interval '1 day')
    else v_prev_end
  end;

  return query
  with scoped as materialized (
    select t.*
    from public.transactions t
    where t.family_id = v_family.id
      and t.is_deleted = false
      and t.occurred_at >= v_prev_start
      and t.occurred_at < v_end
  ),
  current_period as materialized (
    select * from scoped where occurred_at >= v_start
  ),
  previous_period as materialized (
    select * from scoped where occurred_at < v_previous_compare_end
  ),
  earliest as (
    select to_char(min(t.occurred_at at time zone v_family.timezone), 'YYYY-MM') as period
    from public.transactions t
    where t.family_id = v_family.id and t.is_deleted = false
  ),
  totals as (
    select
      count(*)::bigint as transaction_count,
      coalesce(sum(amount) filter (where type = 'income'), 0)::bigint as income_amount,
      coalesce(sum(amount) filter (where type = 'expense'), 0)::bigint as expense_amount,
      coalesce(sum(amount) filter (where type = 'expense' and source = 'normal'), 0)::bigint as consumption_expense_amount
    from current_period
  ),
  previous_totals as (
    select
      coalesce(sum(amount) filter (where type = 'income'), 0)::bigint as income_amount,
      coalesce(sum(amount) filter (where type = 'expense'), 0)::bigint as expense_amount
    from previous_period
  ),
  max_expense as (
    select id, amount, category_id, occurred_at
    from current_period
    where type = 'expense' and source = 'normal'
    order by amount desc, occurred_at desc, id desc
    limit 1
  ),
  top_category as (
    select category_id, sum(amount)::bigint as amount
    from current_period
    where type = 'expense' and source = 'normal'
    group by category_id
    order by sum(amount) desc, category_id
    limit 1
  ),
  top_recorder as (
    select recorder_user_id, count(*)::bigint as count
    from current_period
    group by recorder_user_id
    order by count(*) desc, recorder_user_id
    limit 1
  )
  select
    earliest.period,
    totals.transaction_count,
    totals.income_amount,
    totals.expense_amount,
    totals.consumption_expense_amount,
    previous_totals.income_amount,
    previous_totals.expense_amount,
    max_expense.id,
    max_expense.amount,
    max_expense.category_id,
    max_expense.occurred_at,
    top_category.category_id,
    top_category.amount,
    top_recorder.recorder_user_id,
    top_recorder.count
  from totals
  cross join previous_totals
  cross join earliest
  left join max_expense on true
  left join top_category on true
  left join top_recorder on true;
end;
$$;

revoke all on function public.get_monthly_summary(text) from public;
grant execute on function public.get_monthly_summary(text) to authenticated;

create or replace function public.get_budget_progress(p_period text)
returns table (used_amount bigint, category_usage jsonb)
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
  if v_uid is null then raise exception '未认证' using errcode = '28000'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception '账期格式必须为 YYYY-MM' using errcode = '22007';
  end if;

  select f.* into v_family
  from public.families f join public.memberships m on m.family_id = f.id
  where m.user_id = v_uid and m.status = 'active'
  limit 1;
  if not found then return; end if;

  v_start := (p_period || '-01 00:00:00')::timestamp at time zone v_family.timezone;
  v_end := ((p_period || '-01')::date + interval '1 month')::timestamp at time zone v_family.timezone;

  return query
  with expenses as (
    select category_id, amount
    from public.transactions
    where family_id = v_family.id
      and is_deleted = false
      and type = 'expense'
      and source = 'normal'
      and occurred_at >= v_start
      and occurred_at < v_end
  ),
  grouped as (
    select category_id, sum(amount)::bigint as amount
    from expenses
    group by category_id
  )
  select
    coalesce((select sum(amount) from expenses), 0)::bigint,
    coalesce(jsonb_object_agg(category_id, amount), '{}'::jsonb)
  from grouped;
end;
$$;

revoke all on function public.get_budget_progress(text) from public;
grant execute on function public.get_budget_progress(text) to authenticated;

comment on function public.get_monthly_summary(text) is
  '完整账期月度总结；所有边界按当前家庭 timezone 计算。';
comment on function public.get_budget_progress(text) is
  '完整账期预算执行；仅普通支出，按分类分组。';

create or replace function public.get_family_activity()
returns table (
  month_count bigint,
  family_streak integer,
  my_month_count bigint,
  my_streak integer,
  today_count bigint,
  month_member_count bigint,
  latest_transaction_id uuid,
  latest_category_id uuid,
  latest_recorder_user_id uuid,
  latest_amount bigint
)
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_family public.families;
  v_today date;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_today_start timestamptz;
  v_tomorrow_start timestamptz;
begin
  if v_uid is null then raise exception '未认证' using errcode = '28000'; end if;
  select f.* into v_family
  from public.families f join public.memberships m on m.family_id = f.id
  where m.user_id = v_uid and m.status = 'active'
  limit 1;
  if not found then return; end if;

  v_today := (now() at time zone v_family.timezone)::date;
  v_month_start := date_trunc('month', v_today)::timestamp at time zone v_family.timezone;
  v_month_end := (date_trunc('month', v_today) + interval '1 month')::timestamp at time zone v_family.timezone;
  v_today_start := v_today::timestamp at time zone v_family.timezone;
  v_tomorrow_start := (v_today + 1)::timestamp at time zone v_family.timezone;

  return query
  with all_days as materialized (
    select distinct (t.occurred_at at time zone v_family.timezone)::date as day, t.recorder_user_id
    from public.transactions t
    where t.family_id = v_family.id and t.is_deleted = false and t.occurred_at < v_tomorrow_start
  ),
  date_bounds as (
    select min(day) as first_day from all_days
  ),
  family_streak_calc as (
    select coalesce(
      (select coalesce(min(g.ordinality) filter (where d.day is null) - 1, count(*))::integer
       from date_bounds b
       cross join lateral generate_series(
         case when exists (select 1 from all_days where day = v_today) then v_today else v_today - 1 end,
         b.first_day,
         '-1 day'::interval
       ) with ordinality as g(day, ordinality)
       left join (select distinct day from all_days) d on d.day = g.day),
      0
    ) as value
  ),
  my_streak_calc as (
    select coalesce(
      (select coalesce(min(g.ordinality) filter (where d.day is null) - 1, count(*))::integer
       from (select min(day) as first_day from all_days where recorder_user_id = v_uid) b
       cross join lateral generate_series(
         case when exists (select 1 from all_days where day = v_today and recorder_user_id = v_uid) then v_today else v_today - 1 end,
         b.first_day,
         '-1 day'::interval
       ) with ordinality as g(day, ordinality)
       left join (select distinct day from all_days where recorder_user_id = v_uid) d on d.day = g.day),
      0
    ) as value
  ),
  month_transactions as materialized (
    select * from public.transactions t
    where t.family_id = v_family.id and t.is_deleted = false
      and t.occurred_at >= v_month_start and t.occurred_at < v_month_end
  ),
  latest as (
    select id, category_id, recorder_user_id, amount
    from month_transactions
    order by occurred_at desc, id desc
    limit 1
  )
  select
    (select count(*) from month_transactions)::bigint,
    (select value from family_streak_calc),
    (select count(*) from month_transactions where recorder_user_id = v_uid)::bigint,
    (select value from my_streak_calc),
    (select count(*) from month_transactions where occurred_at >= v_today_start and occurred_at < v_tomorrow_start)::bigint,
    (select count(distinct recorder_user_id) from month_transactions)::bigint,
    latest.id, latest.category_id, latest.recorder_user_id, latest.amount
  from latest
  right join (select 1) singleton on true;
end;
$$;

revoke all on function public.get_family_activity() from public;
grant execute on function public.get_family_activity() to authenticated;
comment on function public.get_family_activity() is
  '家庭当下活动指标；按家庭 timezone 统计完整历史流水。';

create or replace function public.get_report_analytics(
  p_start date,
  p_end date,
  p_previous_start date,
  p_history_start date,
  p_member_ids uuid[] default '{}'::uuid[],
  p_category_ids uuid[] default '{}'::uuid[])
returns jsonb
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
  v_previous_start timestamptz;
  v_history_start timestamptz;
begin
  if v_uid is null then raise exception '未认证' using errcode = '28000'; end if;
  if p_start >= p_end or p_previous_start >= p_start or p_history_start > p_start then
    raise exception '报表日期范围无效' using errcode = '22007';
  end if;
  select f.* into v_family
  from public.families f join public.memberships m on m.family_id = f.id
  where m.user_id = v_uid and m.status = 'active'
  limit 1;
  if not found then return '{}'::jsonb; end if;

  v_start := p_start::timestamp at time zone v_family.timezone;
  v_end := p_end::timestamp at time zone v_family.timezone;
  v_previous_start := p_previous_start::timestamp at time zone v_family.timezone;
  v_history_start := p_history_start::timestamp at time zone v_family.timezone;

  return (
    with scoped as materialized (
      select t.*
      from public.transactions t
      where t.family_id = v_family.id and t.is_deleted = false
        and t.occurred_at >= v_history_start and t.occurred_at < v_end
        and (cardinality(p_member_ids) = 0 or t.recorder_user_id = any(p_member_ids))
        and (cardinality(p_category_ids) = 0 or t.category_id = any(p_category_ids))
    ),
    current_rows as materialized (
      select * from scoped where occurred_at >= v_start
    ),
    previous_rows as materialized (
      select * from scoped where occurred_at >= v_previous_start and occurred_at < v_start
    ),
    summary as (
      select jsonb_build_object(
        'transactionCount', count(*),
        'incomeAmount', coalesce(sum(amount) filter (where type = 'income'), 0),
        'expenseAmount', coalesce(sum(amount) filter (where type = 'expense'), 0),
        'expenseNormalAmount', coalesce(sum(amount) filter (where type = 'expense' and source = 'normal'), 0)
      ) as value from current_rows
    ),
    expense_categories as (
      select jsonb_agg(jsonb_build_object('categoryId', category_id, 'currentAmount', current_amount, 'previousAmount', previous_amount)
                       order by current_amount desc, previous_amount desc, category_id)
      from (
        select category_id,
          coalesce(sum(amount) filter (where occurred_at >= v_start), 0)::bigint as current_amount,
          coalesce(sum(amount) filter (where occurred_at < v_start), 0)::bigint as previous_amount
        from (select * from current_rows union all select * from previous_rows) x
        where type = 'expense' and source = 'normal'
        group by category_id
      ) grouped
    ),
    income_categories as (
      select jsonb_agg(jsonb_build_object('categoryId', category_id, 'amount', amount) order by amount desc, category_id)
      from (
        select category_id, sum(amount)::bigint as amount
        from current_rows where type = 'income' and source = 'normal'
        group by category_id
      ) grouped
    ),
    members as (
      select jsonb_agg(jsonb_build_object(
        'userId', recorder_user_id, 'count', transaction_count,
        'incomeAmount', income_amount, 'expenseAmount', expense_amount,
        'expenseNormalAmount', expense_normal_amount
      ) order by expense_normal_amount desc, recorder_user_id)
      from (
        select recorder_user_id, count(*)::bigint as transaction_count,
          coalesce(sum(amount) filter (where type = 'income'), 0)::bigint as income_amount,
          coalesce(sum(amount) filter (where type = 'expense'), 0)::bigint as expense_amount,
          coalesce(sum(amount) filter (where type = 'expense' and source = 'normal'), 0)::bigint as expense_normal_amount
        from current_rows group by recorder_user_id
      ) grouped
    ),
    member_categories as (
      select jsonb_agg(jsonb_build_object('userId', recorder_user_id, 'categoryId', category_id, 'amount', amount)
                       order by recorder_user_id, amount desc, category_id)
      from (
        select recorder_user_id, category_id, sum(amount)::bigint as amount
        from current_rows where type = 'expense' and source = 'normal'
        group by recorder_user_id, category_id
      ) grouped
    ),
    top_expenses as (
      select jsonb_agg(jsonb_build_object('id', id, 'categoryId', category_id, 'note', note, 'amount', amount,
                                           'occurredAt', occurred_at) order by amount desc, occurred_at desc, id desc)
      from (
        select id, category_id, note, amount, occurred_at
        from current_rows where type = 'expense' and source = 'normal'
        order by amount desc, occurred_at desc, id desc limit 5
      ) ranked
    ),
    days as (
      select jsonb_agg(jsonb_build_object(
        'date', day, 'incomeAmount', income_amount, 'expenseAmount', expense_amount,
        'incomeNormalAmount', income_normal_amount, 'expenseNormalAmount', expense_normal_amount
      ) order by day)
      from (
        select (occurred_at at time zone v_family.timezone)::date::text as day,
          coalesce(sum(amount) filter (where type = 'income'), 0)::bigint as income_amount,
          coalesce(sum(amount) filter (where type = 'expense'), 0)::bigint as expense_amount,
          coalesce(sum(amount) filter (where type = 'income' and source = 'normal'), 0)::bigint as income_normal_amount,
          coalesce(sum(amount) filter (where type = 'expense' and source = 'normal'), 0)::bigint as expense_normal_amount
        from scoped group by (occurred_at at time zone v_family.timezone)::date
      ) grouped
    )
    select jsonb_build_object(
      'summary', (select value from summary),
      'expenseCategories', coalesce((select * from expense_categories), '[]'::jsonb),
      'incomeCategories', coalesce((select * from income_categories), '[]'::jsonb),
      'members', coalesce((select * from members), '[]'::jsonb),
      'memberCategories', coalesce((select * from member_categories), '[]'::jsonb),
      'topExpenses', coalesce((select * from top_expenses), '[]'::jsonb),
      'days', coalesce((select * from days), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.get_report_analytics(date, date, date, date, uuid[], uuid[]) from public;
grant execute on function public.get_report_analytics(date, date, date, date, uuid[], uuid[]) to authenticated;
comment on function public.get_report_analytics(date, date, date, date, uuid[], uuid[]) is
  '完整报表聚合；仅返回有限分组、Top N 与按日分桶，不传回原始流水全集。';

create or replace function public.get_report_category_detail(
  p_start date,
  p_end date,
  p_history_start date,
  p_category_ids uuid[],
  p_cursor_occurred_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50)
returns jsonb
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
  v_history_start timestamptz;
  v_page_size integer := least(greatest(p_page_size, 1), 100);
  v_result jsonb;
begin
  if v_uid is null then raise exception '未认证' using errcode = '28000'; end if;
  if p_start >= p_end or p_history_start > p_start or cardinality(p_category_ids) = 0 then
    raise exception '分类明细参数无效' using errcode = '22007';
  end if;
  select f.* into v_family from public.families f join public.memberships m on m.family_id = f.id
  where m.user_id = v_uid and m.status = 'active' limit 1;
  if not found then return '{}'::jsonb; end if;
  v_start := p_start::timestamp at time zone v_family.timezone;
  v_end := p_end::timestamp at time zone v_family.timezone;
  v_history_start := p_history_start::timestamp at time zone v_family.timezone;

  with current_rows as materialized (
      select * from public.transactions t
      where t.family_id = v_family.id and t.is_deleted = false and t.type = 'expense' and t.source = 'normal'
        and t.category_id = any(p_category_ids) and t.occurred_at >= v_start and t.occurred_at < v_end
    ),
    history_rows as materialized (
      select * from public.transactions t
      where t.family_id = v_family.id and t.is_deleted = false and t.type = 'expense' and t.source = 'normal'
        and t.category_id = any(p_category_ids) and t.occurred_at >= v_history_start and t.occurred_at < v_end
    ),
    page as (
      select id, note, amount, occurred_at from current_rows
      where p_cursor_occurred_at is null or (occurred_at, id) < (p_cursor_occurred_at, p_cursor_id)
      order by occurred_at desc, id desc limit v_page_size
    ),
    note_groups as (
      select jsonb_agg(jsonb_build_object('name', name, 'amount', amount, 'count', count) order by amount desc, count desc, name)
      from (
        select left(coalesce(nullif(btrim(note), ''), '未填写'), 12) as name, sum(amount)::bigint as amount, count(*)::bigint as count
        from current_rows group by left(coalesce(nullif(btrim(note), ''), '未填写'), 12)
        order by sum(amount) desc, count(*) desc, left(coalesce(nullif(btrim(note), ''), '未填写'), 12) limit 5
      ) grouped
    ),
    daily as (
      select jsonb_agg(jsonb_build_object('date', day, 'amount', amount) order by day)
      from (
        select (occurred_at at time zone v_family.timezone)::date::text as day, sum(amount)::bigint as amount
        from history_rows group by (occurred_at at time zone v_family.timezone)::date
      ) grouped
    )
  select jsonb_build_object(
      'count', (select count(*) from current_rows),
      'amount', (select coalesce(sum(amount), 0) from current_rows),
      'notes', coalesce((select * from note_groups), '[]'::jsonb),
      'days', coalesce((select * from daily), '[]'::jsonb),
      'rows', coalesce(
        (
          select jsonb_agg(row_value order by occurred_at desc, id desc)
          from (
            select
              jsonb_build_object('id', id, 'note', note, 'amount', amount, 'occurredAt', occurred_at) as row_value,
              occurred_at,
              id
            from page
          ) page_rows
        ),
        '[]'::jsonb
      )
    )
  into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_report_category_detail(date, date, date, uuid[], timestamptz, uuid, integer) from public;
grant execute on function public.get_report_category_detail(date, date, date, uuid[], timestamptz, uuid, integer) to authenticated;

create or replace function public.search_transactions(
  p_keyword text default '',
  p_keyword_category_ids uuid[] default '{}'::uuid[],
  p_keyword_recorder_ids uuid[] default '{}'::uuid[],
  p_types text[] default '{}'::text[],
  p_category_ids uuid[] default '{}'::uuid[],
  p_recorder_ids uuid[] default '{}'::uuid[],
  p_date_preset text default 'all',
  p_custom_from date default null,
  p_custom_to date default null,
  p_amount_min bigint default null,
  p_amount_max bigint default null,
  p_cursor_occurred_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_family public.families;
  v_today date;
  v_start timestamptz := null;
  v_end timestamptz := null;
  v_page_size integer := least(greatest(p_page_size, 1), 100);
  v_keyword text := btrim(p_keyword);
begin
  if v_uid is null then raise exception '未认证' using errcode = '28000'; end if;
  if p_amount_min is not null and p_amount_max is not null and p_amount_min > p_amount_max then
    raise exception '金额范围无效' using errcode = '22003';
  end if;
  if p_date_preset not in ('all', 'thisMonth', 'lastMonth', 'last7', 'last30', 'thisYear', 'custom') then
    raise exception '日期筛选无效' using errcode = '22007';
  end if;
  select f.* into v_family from public.families f join public.memberships m on m.family_id = f.id
  where m.user_id = v_uid and m.status = 'active' limit 1;
  if not found then return jsonb_build_object('count', 0, 'rows', '[]'::jsonb); end if;
  v_today := (now() at time zone v_family.timezone)::date;
  case p_date_preset
    when 'thisMonth' then
      v_start := date_trunc('month', v_today)::timestamp at time zone v_family.timezone;
      v_end := (date_trunc('month', v_today) + interval '1 month')::timestamp at time zone v_family.timezone;
    when 'lastMonth' then
      v_start := (date_trunc('month', v_today) - interval '1 month')::timestamp at time zone v_family.timezone;
      v_end := date_trunc('month', v_today)::timestamp at time zone v_family.timezone;
    when 'last7' then
      v_start := (v_today - 6)::timestamp at time zone v_family.timezone;
      v_end := (v_today + 1)::timestamp at time zone v_family.timezone;
    when 'last30' then
      v_start := (v_today - 29)::timestamp at time zone v_family.timezone;
      v_end := (v_today + 1)::timestamp at time zone v_family.timezone;
    when 'thisYear' then
      v_start := date_trunc('year', v_today)::timestamp at time zone v_family.timezone;
      v_end := (date_trunc('year', v_today) + interval '1 year')::timestamp at time zone v_family.timezone;
    when 'custom' then
      if p_custom_from is not null then v_start := p_custom_from::timestamp at time zone v_family.timezone; end if;
      if p_custom_to is not null then v_end := (p_custom_to + 1)::timestamp at time zone v_family.timezone; end if;
      if p_custom_from is not null and p_custom_to is not null and p_custom_from > p_custom_to then
        raise exception '日期范围无效' using errcode = '22007';
      end if;
    else null;
  end case;
  return (
    with matched as materialized (
      select t.* from public.transactions t
      where t.family_id = v_family.id and t.is_deleted = false
        and (cardinality(p_types) = 0 or t.type = any(p_types))
        and (cardinality(p_category_ids) = 0 or t.category_id = any(p_category_ids))
        and (cardinality(p_recorder_ids) = 0 or t.recorder_user_id = any(p_recorder_ids))
        and (v_start is null or t.occurred_at >= v_start)
        and (v_end is null or t.occurred_at < v_end)
        and (p_amount_min is null or t.amount >= p_amount_min)
        and (p_amount_max is null or t.amount <= p_amount_max)
        and (
          v_keyword = '' or t.note ilike '%' || v_keyword || '%'
          or t.category_id = any(p_keyword_category_ids) or t.recorder_user_id = any(p_keyword_recorder_ids)
        )
    ),
    page as (
      select id, family_id, type, amount, category_id, recorder_user_id, note, occurred_at, source, updated_at, last_editor_user_id
      from matched
      where p_cursor_occurred_at is null or (occurred_at, id) < (p_cursor_occurred_at, p_cursor_id)
      order by occurred_at desc, id desc limit v_page_size
    )
    select jsonb_build_object(
      'count', (select count(*) from matched),
      'expenseAmount', (select coalesce(sum(amount) filter (where type = 'expense' and source = 'normal'), 0) from matched),
      'incomeAmount', (select coalesce(sum(amount) filter (where type = 'income' and source = 'normal'), 0) from matched),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'familyId', family_id, 'type', type, 'amount', amount, 'categoryId', category_id,
        'recorderUserId', recorder_user_id, 'note', note, 'occurredAt', occurred_at, 'source', source,
        'updatedAt', updated_at, 'lastEditorUserId', last_editor_user_id
      ) order by occurred_at desc, id desc) from page), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.search_transactions(text, uuid[], uuid[], text[], uuid[], uuid[], text, date, date, bigint, bigint, timestamptz, uuid, integer) from public;
grant execute on function public.search_transactions(text, uuid[], uuid[], text[], uuid[], uuid[], text, date, date, bigint, bigint, timestamptz, uuid, integer) to authenticated;
