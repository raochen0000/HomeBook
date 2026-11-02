-- Family-specific category hierarchy. Existing category IDs remain valid for
-- old transactions, recurring rules and older clients.
-- Defer existing category references so family deletion can remove categories,
-- transactions, budgets, recurring rules and savings in any cascade order,
-- while still rejecting deletes that would leave dangling records at commit.
alter table public.transactions alter constraint transactions_category_id_fkey deferrable initially deferred;
alter table public.transactions alter constraint transactions_savings_goal_id_fkey deferrable initially deferred;
alter table public.budget_categories alter constraint budget_categories_category_id_fkey deferrable initially deferred;
alter table public.recurring_transactions alter constraint recurring_transactions_category_id_fkey deferrable initially deferred;
alter table public.recurring_runs alter constraint recurring_runs_transaction_id_fkey deferrable initially deferred;
alter table public.savings_entries alter constraint savings_entries_transaction_id_fkey deferrable initially deferred;

create table public.family_category_layout (
  family_id uuid not null references public.families(id) on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  parent_category_id uuid,
  is_group boolean not null default false,
  legacy_entry boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (family_id, category_id),
  foreign key (family_id, parent_category_id)
    references public.family_category_layout (family_id, category_id) on delete cascade,
  check ((is_group and parent_category_id is null) or (not is_group and parent_category_id is not null)),
  check (not legacy_entry or is_group),
  check (category_id is distinct from parent_category_id)
);

create index family_category_layout_parent_idx
  on public.family_category_layout (family_id, parent_category_id)
  where parent_category_id is not null;

alter table public.family_category_layout enable row level security;
grant select, insert, update, delete on public.family_category_layout to authenticated;
create policy family_category_layout_select on public.family_category_layout
  for select to authenticated using (private.is_family_member(family_id));
create policy family_category_layout_insert on public.family_category_layout
  for insert to authenticated with check (private.is_family_member(family_id));
create policy family_category_layout_update on public.family_category_layout
  for update to authenticated using (private.is_family_member(family_id))
  with check (private.is_family_member(family_id));
create policy family_category_layout_delete on public.family_category_layout
  for delete to authenticated using (private.is_family_member(family_id));

-- Serialize changes within a family before enforcing sibling name uniqueness.
drop index public.categories_uniq_name_per_family;

create or replace function private.lock_category_family()
returns trigger language plpgsql set search_path = '' as $$
declare v_family uuid;
begin
  if tg_op = 'DELETE' then v_family := old.family_id; else v_family := new.family_id; end if;
  if v_family is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_family::text, 831726));
  end if;
  return coalesce(new, old);
end;
$$;

create trigger categories_lock_family before insert or update on public.categories
  for each row execute function private.lock_category_family();
create trigger family_category_layout_lock_family before insert or update or delete on public.family_category_layout
  for each row execute function private.lock_category_family();

create or replace function private.check_category_sibling_names()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_family uuid;
  v_category uuid;
begin
  if tg_op = 'DELETE' then v_family := old.family_id; else v_family := new.family_id; end if;
  if v_family is null then return null; end if;
  if tg_table_name = 'categories' then
    if tg_op = 'UPDATE' and (new.name, new.status) is not distinct from (old.name, old.status) then
      return null;
    end if;
    v_category := new.id;
  else
    if tg_op = 'UPDATE' and new.parent_category_id is not distinct from old.parent_category_id then
      return null;
    end if;
    -- Promoting an existing root to a group does not change its sibling set.
    if tg_op = 'INSERT' and new.is_group then return null; end if;
    if tg_op = 'DELETE' then v_category := old.category_id; else v_category := new.category_id; end if;
  end if;
  if exists (
    select 1
    from public.categories a
    join public.categories b on a.id < b.id and a.name = b.name and a.type = b.type
    left join public.family_category_layout la on la.family_id = v_family and la.category_id = a.id
    left join public.family_category_layout lb on lb.family_id = v_family and lb.category_id = b.id
    where (a.id = v_category or b.id = v_category)
      and (a.family_id is null or a.family_id = v_family)
      and (b.family_id is null or b.family_id = v_family)
      and a.status = 'active' and b.status = 'active'
      and la.parent_category_id is not distinct from lb.parent_category_id
  ) then
    raise exception '同一层级已有同名分类' using errcode = '23505';
  end if;
  return null;
end;
$$;

create constraint trigger category_sibling_names
  after insert or update on public.categories deferrable initially deferred
  for each row execute function private.check_category_sibling_names();
create constraint trigger category_layout_sibling_names
  after insert or update or delete on public.family_category_layout deferrable initially deferred
  for each row execute function private.check_category_sibling_names();

create or replace function private.validate_category_layout()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_category public.categories;
  v_parent public.categories;
  v_old_parent uuid;
  v_has_history boolean;
begin
  if tg_op = 'DELETE' then
    -- Family deletion cascades through this table; never block that cleanup.
    if not exists (select 1 from public.families where id = old.family_id) then return old; end if;
    if old.is_group then raise exception '一级分类不能直接移除，请停用或隐藏'; end if;
    v_old_parent := old.parent_category_id;
    if exists (select 1 from public.budget_categories bc join public.budgets b on b.id = bc.budget_id
               where b.family_id = old.family_id and bc.category_id = v_old_parent)
       and not private.is_family_owner(old.family_id) then
      raise exception '涉及分类预算，请由户主调整分类';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.family_id, new.category_id, new.is_group, new.legacy_entry)
     is distinct from (old.family_id, old.category_id, old.is_group, old.legacy_entry) then
    raise exception '分类层级标识不可修改';
  end if;

  select * into v_category from public.categories where id = new.category_id;
  if not found or (v_category.family_id is not null and v_category.family_id <> new.family_id)
     or v_category.status <> 'active' or v_category.name like '储蓄·%' then
    raise exception '分类不属于当前家庭或不可用';
  end if;

  if new.is_group then
    if not new.legacy_entry and (exists (select 1 from public.transactions t where t.family_id = new.family_id and t.category_id = new.category_id)
       or exists (select 1 from public.budget_categories bc join public.budgets b on b.id = bc.budget_id
                  where b.family_id = new.family_id and bc.category_id = new.category_id)) then
      raise exception '已有流水或预算的分类必须保留未细分入口';
    end if;
    if exists (select 1 from public.budget_categories bc join public.budgets b on b.id = bc.budget_id
               where b.family_id = new.family_id and bc.category_id = new.category_id)
       and not private.is_family_owner(new.family_id) then
      raise exception '已有分类预算，请由户主确认细分';
    end if;
    return new;
  end if;

  select c.* into v_parent
  from public.categories c join public.family_category_layout l
    on l.family_id = new.family_id and l.category_id = c.id and l.is_group
  where c.id = new.parent_category_id and c.status = 'active';
  if not found or v_parent.type <> v_category.type then
    raise exception '上级分类不可用或收支类型不一致';
  end if;
  if exists (select 1 from public.budget_categories bc join public.budgets b on b.id = bc.budget_id
             join public.families f on f.id = b.family_id
             where b.family_id = new.family_id and bc.category_id = new.category_id
               and b.period >= to_char(now() at time zone f.timezone, 'YYYY-MM')) then
    raise exception '该分类已有预算，请户主先调整预算后再归组';
  end if;

  if tg_op = 'UPDATE' then v_old_parent := old.parent_category_id; end if;
  select exists (select 1 from public.transactions t
                 where t.family_id = new.family_id and t.category_id = new.category_id and not t.is_deleted)
    into v_has_history;
  if v_has_history and not private.is_family_owner(new.family_id)
     and exists (select 1 from public.budget_categories bc join public.budgets b on b.id = bc.budget_id
                 where b.family_id = new.family_id
                   and bc.category_id in (new.parent_category_id, v_old_parent)) then
    raise exception '归组将影响预算，请由户主确认';
  end if;
  return new;
end;
$$;

create trigger validate_category_layout before insert or update or delete on public.family_category_layout
  for each row execute function private.validate_category_layout();

-- Family-scoped triggers can fire while the family itself is being deleted.
-- Do not recreate its revision row after the parent row has disappeared.
create or replace function private.touch_family_revision(p_family_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_family_id is null or not exists (select 1 from public.families where id = p_family_id) then return; end if;
  insert into public.family_data_revisions (family_id, revision, updated_at)
    values (p_family_id, 1, now())
    on conflict (family_id) do update
      set revision = public.family_data_revisions.revision + 1, updated_at = now();
end;
$$;
revoke all on function private.touch_family_revision(uuid) from public, anon, authenticated;

create trigger family_data_revisions_on_category_layout
  after insert or update or delete on public.family_category_layout
  for each row execute function private.tg_touch_family_revision_from_family_id();

-- Enforce the existing owner-only archive/hide contract at the database boundary.
create or replace function private.guard_category_owner_actions()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.family_id is null or new.is_system then raise exception '不能创建系统分类'; end if;
  else
    if (new.id, new.family_id, new.is_system, new.type) is distinct from (old.id, old.family_id, old.is_system, old.type) then
      raise exception '分类归属和类型不可修改';
    end if;
    if new.status is distinct from old.status and not private.is_family_owner(old.family_id) then
      raise exception '仅户主可停用分类' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger categories_guard_owner before insert or update on public.categories
  for each row when (current_user = 'authenticated') execute function private.guard_category_owner_actions();

drop policy fhc_insert_member on public.family_hidden_categories;
drop policy fhc_delete_member on public.family_hidden_categories;
create policy fhc_insert_owner on public.family_hidden_categories for insert to authenticated
  with check (private.is_family_owner(family_id));
create policy fhc_delete_owner on public.family_hidden_categories for delete to authenticated
  using (private.is_family_owner(family_id));
create or replace function private.protect_fallback_categories()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.categories where id = new.category_id and name in ('其他支出', '其他收入')) then
    raise exception '兜底分类不可隐藏';
  end if;
  return new;
end;
$$;
create trigger protect_fallback_categories before insert on public.family_hidden_categories
  for each row execute function private.protect_fallback_categories();

drop policy budgets_insert_member on public.budgets;
drop policy budgets_update_member on public.budgets;
drop policy budgets_delete_member on public.budgets;
create policy budgets_insert_owner on public.budgets for insert to authenticated
  with check (private.is_family_owner(family_id));
create policy budgets_update_owner on public.budgets for update to authenticated
  using (private.is_family_owner(family_id)) with check (private.is_family_owner(family_id));
create policy budgets_delete_owner on public.budgets for delete to authenticated
  using (private.is_family_owner(family_id));
drop policy budget_categories_insert_member on public.budget_categories;
drop policy budget_categories_update_member on public.budget_categories;
drop policy budget_categories_delete_member on public.budget_categories;
create policy budget_categories_insert_owner on public.budget_categories for insert to authenticated
  with check (exists (select 1 from public.budgets b where b.id = budget_id and private.is_family_owner(b.family_id)));
create policy budget_categories_update_owner on public.budget_categories for update to authenticated
  using (exists (select 1 from public.budgets b where b.id = budget_id and private.is_family_owner(b.family_id)))
  with check (exists (select 1 from public.budgets b where b.id = budget_id and private.is_family_owner(b.family_id)));
create policy budget_categories_delete_owner on public.budget_categories for delete to authenticated
  using (exists (select 1 from public.budgets b where b.id = budget_id and private.is_family_owner(b.family_id)));

-- Group and child creation are atomic, so duplicate sibling names are checked
-- after the new child has acquired its parent rather than against root items.
create or replace function public.create_hierarchical_category(
  p_family_id uuid, p_name text, p_icon text, p_type text, p_color_key text,
  p_parent_category_id uuid default null, p_is_group boolean default false
) returns public.categories language plpgsql security invoker set search_path = '' as $$
declare v_category public.categories;
begin
  if not private.is_family_member(p_family_id) then raise exception '无家庭权限' using errcode = '42501'; end if;
  if p_is_group and p_parent_category_id is not null then raise exception '最多支持两级分类'; end if;
  if btrim(p_name) = '' or char_length(btrim(p_name)) > 6 or p_type not in ('expense', 'income') then
    raise exception '分类名称或类型无效';
  end if;
  insert into public.categories (family_id, name, icon, type, color_key, is_system, status)
    values (p_family_id, btrim(p_name), p_icon, p_type, p_color_key, false, 'active')
    returning * into v_category;
  if p_is_group or p_parent_category_id is not null then
    insert into public.family_category_layout (family_id, category_id, parent_category_id, is_group, legacy_entry)
      values (p_family_id, v_category.id, p_parent_category_id, p_is_group, false);
  end if;
  return v_category;
end;
$$;
revoke all on function public.create_hierarchical_category(uuid, text, text, text, text, uuid, boolean) from public, anon;
grant execute on function public.create_hierarchical_category(uuid, text, text, text, text, uuid, boolean) to authenticated;

-- Existing category budget writes used several HTTP requests. The new RPC is
-- atomic, and legacy clients are stopped before they can partially replace a
-- family budget once that family uses the hierarchy.
create or replace function private.guard_hierarchical_budget_write()
returns trigger language plpgsql set search_path = '' as $$
declare v_family uuid;
begin
  if tg_table_name = 'budgets' then
    if tg_op = 'DELETE' then v_family := old.family_id; else v_family := new.family_id; end if;
  else
    select b.family_id into v_family from public.budgets b where b.id = coalesce(new.budget_id, old.budget_id);
  end if;
  if current_user = 'authenticated' and exists (
    select 1 from public.family_category_layout l where l.family_id = v_family
  ) then
    raise exception '此家庭已启用分类层级，请升级后再修改预算';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger guard_hierarchical_budgets before insert or update or delete on public.budgets
  for each row execute function private.guard_hierarchical_budget_write();
create trigger guard_hierarchical_budget_categories before insert or update or delete on public.budget_categories
  for each row execute function private.guard_hierarchical_budget_write();

create or replace function public.save_family_budget(
  p_family_id uuid, p_period text, p_total_amount bigint, p_alert_enabled boolean, p_categories jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare v_budget_id uuid;
begin
  if (select auth.uid()) is null or not private.is_family_owner(p_family_id) then
    raise exception '仅户主可设置预算' using errcode = '42501';
  end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' or p_total_amount <= 0
     or jsonb_typeof(p_categories) <> 'array' then raise exception '预算参数无效'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_family_id::text, 831726));
  perform 1 from public.families where id = p_family_id for update;
  if exists (
    select 1 from jsonb_to_recordset(p_categories) as item(category_id uuid, amount bigint)
    left join public.categories c on c.id = item.category_id
    left join public.family_category_layout l on l.family_id = p_family_id and l.category_id = c.id
    where c.id is null or (c.family_id is not null and c.family_id <> p_family_id)
      or c.type <> 'expense' or c.status <> 'active' or c.name like '储蓄·%'
      or item.amount is null or item.amount <= 0 or l.parent_category_id is not null
  ) then raise exception '预算只能设置给有效的一级支出分类'; end if;
  insert into public.budgets (family_id, period, total_amount, alert_enabled)
    values (p_family_id, p_period, p_total_amount, p_alert_enabled)
    on conflict (family_id, period) do update
      set total_amount = excluded.total_amount, alert_enabled = excluded.alert_enabled
    returning id into v_budget_id;
  delete from public.budget_categories where budget_id = v_budget_id;
  insert into public.budget_categories (budget_id, category_id, amount)
    select v_budget_id, category_id, amount
    from jsonb_to_recordset(p_categories) as item(category_id uuid, amount bigint);
end;
$$;
revoke all on function public.save_family_budget(uuid, text, bigint, boolean, jsonb) from public, anon;
grant execute on function public.save_family_budget(uuid, text, bigint, boolean, jsonb) to authenticated;

create or replace function public.get_category_move_impact(
  p_family_id uuid, p_category_id uuid, p_parent_id uuid, p_period text
) returns jsonb language plpgsql security invoker stable set search_path = '' as $$
declare
  v_family public.families;
  v_source uuid;
  v_target uuid := coalesce(p_parent_id, p_category_id);
  v_start timestamptz;
  v_end timestamptz;
  v_category_used bigint;
  v_source_used bigint;
  v_target_used bigint;
  v_source_budget bigint;
  v_target_budget bigint;
  v_has_own_budget boolean;
  v_has_affected_budget boolean;
begin
  if not private.is_family_member(p_family_id) then raise exception '无家庭权限' using errcode = '42501'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception '账期格式无效'; end if;
  select * into v_family from public.families where id = p_family_id;
  if not exists (select 1 from public.categories where id = p_category_id and (family_id is null or family_id = p_family_id)) then
    raise exception '分类不属于当前家庭';
  end if;
  if p_parent_id is not null and not exists (
    select 1 from public.family_category_layout where family_id = p_family_id and category_id = p_parent_id and is_group
  ) then raise exception '一级分类不存在'; end if;
  select coalesce((select parent_category_id from public.family_category_layout
                   where family_id = p_family_id and category_id = p_category_id), p_category_id) into v_source;
  v_start := (p_period || '-01 00:00:00')::timestamp at time zone v_family.timezone;
  v_end := ((p_period || '-01')::date + interval '1 month')::timestamp at time zone v_family.timezone;
  select coalesce(sum(t.amount) filter (where t.category_id = p_category_id), 0),
         coalesce(sum(t.amount) filter (where coalesce(l.parent_category_id, t.category_id) = v_source), 0),
         coalesce(sum(t.amount) filter (where coalesce(l.parent_category_id, t.category_id) = v_target), 0)
    into v_category_used, v_source_used, v_target_used
  from public.transactions t
  left join public.family_category_layout l on l.family_id = t.family_id and l.category_id = t.category_id
  where t.family_id = p_family_id and not t.is_deleted and t.type = 'expense' and t.source = 'normal'
    and t.occurred_at >= v_start and t.occurred_at < v_end;
  select max(bc.amount) filter (where bc.category_id = v_source),
         max(bc.amount) filter (where bc.category_id = v_target)
    into v_source_budget, v_target_budget
  from public.budgets b join public.budget_categories bc on bc.budget_id = b.id
  where b.family_id = p_family_id and b.period = p_period;
  select exists (select 1 from public.budget_categories bc join public.budgets b on b.id = bc.budget_id
                 join public.families f on f.id = b.family_id
                 where b.family_id = p_family_id and bc.category_id = p_category_id
                   and b.period >= to_char(now() at time zone f.timezone, 'YYYY-MM'))
    into v_has_own_budget;
  select exists (select 1 from public.budget_categories bc join public.budgets b on b.id = bc.budget_id
                 where b.family_id = p_family_id and bc.category_id in (v_source, v_target))
    into v_has_affected_budget;
  return jsonb_build_object('sourceId', v_source, 'targetId', v_target, 'categoryUsed', v_category_used,
    'sourceUsed', v_source_used, 'targetUsed', v_target_used, 'sourceBudget', v_source_budget,
    'targetBudget', v_target_budget, 'hasOwnBudget', v_has_own_budget, 'hasAffectedBudget', v_has_affected_budget);
end;
$$;
revoke all on function public.get_category_move_impact(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.get_category_move_impact(uuid, uuid, uuid, text) to authenticated;

-- Recalculate complete family-period aggregates using the current hierarchy.
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
    select coalesce(l.parent_category_id, c.category_id) as category_id, sum(c.amount)::bigint as amount
    from current_period c
    left join public.family_category_layout l on l.family_id = v_family.id and l.category_id = c.category_id
    where c.type = 'expense' and c.source = 'normal'
    group by coalesce(l.parent_category_id, c.category_id)
    order by sum(c.amount) desc, category_id
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
    select coalesce(l.parent_category_id, t.category_id) as category_id, t.amount
    from public.transactions t
    left join public.family_category_layout l on l.family_id = t.family_id and l.category_id = t.category_id
    where t.family_id = v_family.id
      and not t.is_deleted
      and t.type = 'expense'
      and t.source = 'normal'
      and t.occurred_at >= v_start
      and t.occurred_at < v_end
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
      select t.*, coalesce(l.parent_category_id, t.category_id) as group_category_id
      from public.transactions t
      left join public.family_category_layout l on l.family_id = t.family_id and l.category_id = t.category_id
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
        select group_category_id as category_id,
          coalesce(sum(amount) filter (where occurred_at >= v_start), 0)::bigint as current_amount,
          coalesce(sum(amount) filter (where occurred_at < v_start), 0)::bigint as previous_amount
        from (select * from current_rows union all select * from previous_rows) x
        where type = 'expense' and source = 'normal'
        group by group_category_id
      ) grouped
    ),
    income_categories as (
      select jsonb_agg(jsonb_build_object('categoryId', category_id, 'amount', amount) order by amount desc, category_id)
      from (
        select group_category_id as category_id, sum(amount)::bigint as amount
        from current_rows where type = 'income' and source = 'normal'
        group by group_category_id
      ) grouped
    ),
    expense_children as (
      select jsonb_agg(jsonb_build_object('parentId', group_category_id, 'categoryId', category_id,
                         'currentAmount', current_amount, 'previousAmount', previous_amount)
                       order by current_amount desc, category_id)
      from (
        select group_category_id, category_id,
          coalesce(sum(amount) filter (where occurred_at >= v_start), 0)::bigint as current_amount,
          coalesce(sum(amount) filter (where occurred_at < v_start), 0)::bigint as previous_amount
        from (select * from current_rows union all select * from previous_rows) x
        where type = 'expense' and source = 'normal'
        group by group_category_id, category_id
      ) grouped
    ),
    income_children as (
      select jsonb_agg(jsonb_build_object('parentId', group_category_id, 'categoryId', category_id, 'amount', amount)
                       order by amount desc, category_id)
      from (
        select group_category_id, category_id, sum(amount)::bigint as amount
        from current_rows where type = 'income' and source = 'normal'
        group by group_category_id, category_id
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
        select recorder_user_id, group_category_id as category_id, sum(amount)::bigint as amount
        from current_rows where type = 'expense' and source = 'normal'
        group by recorder_user_id, group_category_id
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
      'expenseCategoryChildren', coalesce((select * from expense_children), '[]'::jsonb),
      'incomeCategoryChildren', coalesce((select * from income_children), '[]'::jsonb),
      'members', coalesce((select * from members), '[]'::jsonb),
      'memberCategories', coalesce((select * from member_categories), '[]'::jsonb),
      'topExpenses', coalesce((select * from top_expenses), '[]'::jsonb),
      'days', coalesce((select * from days), '[]'::jsonb)
    )
  );
end;
$$;


create or replace function public.get_report_category_detail_v2(
  p_start date,
  p_end date,
  p_history_start date,
  p_category_ids uuid[],
  p_member_ids uuid[],
  p_type text,
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
  if p_start >= p_end or p_history_start > p_start or cardinality(p_category_ids) = 0
     or p_type not in ('expense', 'income') then
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
      where t.family_id = v_family.id and t.is_deleted = false and t.type = p_type and t.source = 'normal'
        and (cardinality(p_member_ids) = 0 or t.recorder_user_id = any(p_member_ids))
        and t.category_id = any(p_category_ids) and t.occurred_at >= v_start and t.occurred_at < v_end
    ),
    history_rows as materialized (
      select * from public.transactions t
      where t.family_id = v_family.id and t.is_deleted = false and t.type = p_type and t.source = 'normal'
        and (cardinality(p_member_ids) = 0 or t.recorder_user_id = any(p_member_ids))
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


revoke all on function public.get_report_category_detail_v2(date, date, date, uuid[], uuid[], text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_report_category_detail_v2(date, date, date, uuid[], uuid[], text, timestamptz, uuid, integer) to authenticated;
