-- 0041 · 通知生产者：全家事件、预算阈值与月度总结。
-- 说明：通知正文是短暂消息，阅读后会删除；去重键单独保留在 private schema，避免
-- 同一目标、预算阈值或月度总结在后续记账时反复打扰全家。

create table if not exists private.notification_event_keys (
  family_id uuid not null references public.families(id) on delete cascade,
  event_key text not null,
  created_at timestamptz not null default now(),
  primary key (family_id, event_key)
);

revoke all on table private.notification_event_keys from public, anon, authenticated;

-- 原子抢占事件键：true 代表本次首次触发，可创建通知；false 代表已处理过。
create or replace function private.claim_notification_event(p_family_id uuid, p_event_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.notification_event_keys (family_id, event_key)
  values (p_family_id, p_event_key)
  on conflict do nothing;
  return found;
end;
$$;

-- 同一家庭的所有 active 成员各拥有一条通知，供 App 内通知中心和推送投递分别消费。
create or replace function private.enqueue_family_notification(
  p_family_id uuid,
  p_type text,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, type, channel, payload)
  select m.user_id, p_type, 'in_app', p_payload
    from public.memberships m
   where m.family_id = p_family_id and m.status = 'active';
end;
$$;

revoke all on function private.claim_notification_event(uuid, text) from public, anon, authenticated;
revoke all on function private.enqueue_family_notification(uuid, text, jsonb) from public, anon, authenticated;

-- 预算口径与首页 Hero 一致：仅统计同一家庭账期内、未删除的日常支出。
create or replace function private.evaluate_budget_alert(p_family_id uuid, p_period text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_budget public.budgets;
  v_timezone text;
  v_used bigint;
  v_threshold text;
  v_text text;
begin
  -- PL/pgSQL 不允许「整行记录变量 + 另一个变量」共用 INTO；先取预算整行，再取家庭时区。
  select b.*
    into v_budget
    from public.budgets b
   where b.family_id = p_family_id
     and b.period = p_period
     and b.alert_enabled;
  if not found then
    return;
  end if;

  select f.timezone
    into v_timezone
    from public.families f
   where f.id = p_family_id;

  select coalesce(sum(t.amount), 0)
    into v_used
    from public.transactions t
   where t.family_id = p_family_id
     and t.is_deleted = false
     and t.type = 'expense'
     and t.source = 'normal'
     and to_char(t.occurred_at at time zone v_timezone, 'YYYY-MM') = p_period;

  if v_used > v_budget.total_amount then
    v_threshold := '100';
    v_text := '本月总预算已超支，请留意后续开支';
  elsif v_used >= ceil(v_budget.total_amount * 0.8) then
    v_threshold := '80';
    v_text := '本月总预算已用至 80%，请留意后续开支';
  else
    return;
  end if;

  if private.claim_notification_event(p_family_id, 'budget:' || p_period || ':' || v_threshold) then
    perform private.enqueue_family_notification(
      p_family_id,
      'budget_alert',
      jsonb_build_object(
        'family_id', p_family_id,
        'period', p_period,
        'level', case when v_threshold = '100' then 'danger' else 'warning' end,
        'text', v_text
      )
    );
  end if;
end;
$$;

create or replace function private.enqueue_budget_alert_from_transaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
  v_period text;
begin
  if new.is_deleted or new.type <> 'expense' or new.source <> 'normal' then
    return new;
  end if;
  select timezone into v_timezone from public.families where id = new.family_id;
  v_period := to_char(new.occurred_at at time zone coalesce(v_timezone, 'Asia/Shanghai'), 'YYYY-MM');
  perform private.evaluate_budget_alert(new.family_id, v_period);
  return new;
end;
$$;

drop trigger if exists transactions_enqueue_budget_alert on public.transactions;
create trigger transactions_enqueue_budget_alert
  after insert or update of type, amount, occurred_at, source, is_deleted on public.transactions
  for each row execute function private.enqueue_budget_alert_from_transaction();

-- 月中新增或下调预算时，若既有开支已经跨过阈值，同样立即生成一次通知。
create or replace function private.enqueue_budget_alert_from_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.alert_enabled then
    perform private.evaluate_budget_alert(new.family_id, new.period);
  end if;
  return new;
end;
$$;

drop trigger if exists budgets_enqueue_budget_alert on public.budgets;
create trigger budgets_enqueue_budget_alert
  after insert or update of total_amount, alert_enabled on public.budgets
  for each row execute function private.enqueue_budget_alert_from_budget();

-- 目标首次达到目标金额时记录达成时间；同时覆盖“编辑目标金额使其达成”的情况。
create or replace function private.set_savings_goal_achieved_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active'
     and new.achieved_at is null
     and new.saved_amount >= new.target_amount then
    new.achieved_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists savings_goals_set_achieved_at on public.savings_goals;
create trigger savings_goals_set_achieved_at
  before insert or update of saved_amount, target_amount on public.savings_goals
  for each row execute function private.set_savings_goal_achieved_at();

create or replace function private.enqueue_goal_achieved_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' and new.achieved_at is not null)
     or (tg_op = 'UPDATE' and old.achieved_at is null and new.achieved_at is not null) then
    perform private.enqueue_family_notification(
      new.family_id,
      'goal_achieved',
      jsonb_build_object('family_id', new.family_id, 'goal_id', new.id, 'goal_name', new.name)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists savings_goals_enqueue_achieved_notification on public.savings_goals;
create trigger savings_goals_enqueue_achieved_notification
  after insert or update on public.savings_goals
  for each row execute function private.enqueue_goal_achieved_notification();

-- 户主转让完成后，通知当前家庭的全体 active 成员（含原户主与新户主）。
create or replace function public.transfer_ownership(p_new_owner uuid)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_family uuid;
  v_fam    public.families;
  v_new_owner_name text;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if p_new_owner = v_uid then
    raise exception '不能转让给自己';
  end if;

  select family_id into v_family from public.memberships
    where user_id = v_uid and role = 'owner' and status = 'active';
  if v_family is null then
    raise exception '仅户主可转让' using errcode = '42501';
  end if;
  if not exists (select 1 from public.memberships
                 where family_id = v_family and user_id = p_new_owner and status = 'active') then
    raise exception '目标不是本家庭成员';
  end if;

  update public.memberships set role = 'member'
    where family_id = v_family and user_id = v_uid and status = 'active';
  update public.memberships set role = 'owner'
    where family_id = v_family and user_id = p_new_owner and status = 'active';

  update public.families set owner_user_id = p_new_owner
    where id = v_family
    returning * into v_fam;

  select nickname into v_new_owner_name
    from public.profiles
   where id = p_new_owner;

  perform private.enqueue_family_notification(
    v_family,
    'transfer',
    jsonb_build_object(
      'family_id', v_family,
      'family_name', v_fam.name,
      'new_owner_user_id', p_new_owner,
      'new_owner_name', coalesce(v_new_owner_name, '家庭成员')
    )
  );
  return v_fam;
end;
$$;

-- 由 push-fc 的 service_role 每轮调用；各家庭按自己的账期时区在每月前 7 天只生成一次。
create or replace function public.emit_monthly_summary_notifications()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family record;
  v_today date;
  v_now_local timestamp;
  v_period text;
  v_created integer := 0;
begin
  for v_family in
    select id, timezone from public.families where status = 'active'
  loop
    v_now_local := now() at time zone v_family.timezone;
    v_today := v_now_local::date;
    if extract(day from v_today) > 7 or v_now_local::time < time '08:00' then
      continue;
    end if;
    v_period := to_char(date_trunc('month', v_today) - interval '1 month', 'YYYY-MM');
    if exists (
      select 1
        from public.transactions t
       where t.family_id = v_family.id
         and t.is_deleted = false
         and to_char(t.occurred_at at time zone v_family.timezone, 'YYYY-MM') = v_period
    ) and private.claim_notification_event(v_family.id, 'monthly_summary:' || v_period) then
      perform private.enqueue_family_notification(
        v_family.id,
        'monthly_summary',
        jsonb_build_object('family_id', v_family.id, 'period', v_period)
      );
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end;
$$;

revoke all on function public.emit_monthly_summary_notifications() from public, anon, authenticated;
grant execute on function public.emit_monthly_summary_notifications() to service_role;

-- 其余 private 函数只能被表触发器或受控 RPC 调用，不能由已登录客户端直接制造全家通知。
revoke all on function private.evaluate_budget_alert(uuid, text) from public, anon, authenticated;
revoke all on function private.enqueue_budget_alert_from_transaction() from public, anon, authenticated;
revoke all on function private.enqueue_budget_alert_from_budget() from public, anon, authenticated;
revoke all on function private.set_savings_goal_achieved_at() from public, anon, authenticated;
revoke all on function private.enqueue_goal_achieved_notification() from public, anon, authenticated;
