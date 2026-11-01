-- Daily, monthly and yearly recurring entries. All due dates use Asia/Shanghai;
-- the scheduler and the existing authenticated catch-up RPC share one generator.

alter table public.recurring_transactions
  drop constraint recurring_transactions_frequency_check,
  drop constraint recurring_transactions_day_of_month_check,
  add column month_of_year integer,
  add column next_due_date date;

alter table public.recurring_transactions
  add constraint recurring_frequency_check check (frequency in ('daily', 'monthly', 'yearly')),
  add constraint recurring_schedule_check check (
    (frequency = 'daily' and day_of_month = 1 and month_of_year is null)
    or (frequency = 'monthly' and day_of_month between 1 and 28 and month_of_year is null)
    or (frequency = 'yearly' and month_of_year is not null and month_of_year between 1 and 12 and day_of_month between 1 and
      extract(day from (make_date(2000, month_of_year, 1) + interval '1 month - 1 day'))::integer)
  );

-- Returns the first occurrence on or after p_from. 2000 is a leap year, so
-- February 29 remains selectable; in other years the day is clamped to Feb 28.
create or replace function private.recurring_next_date(
  p_frequency text, p_day integer, p_month integer, p_from date
) returns date
language plpgsql immutable
set search_path = ''
as $$
declare
  v_year integer := extract(year from p_from)::integer;
  v_month integer := extract(month from p_from)::integer;
  v_date date;
  v_last_day integer;
begin
  if p_frequency = 'daily' then
    return p_from;
  elsif p_frequency = 'monthly' then
    v_date := make_date(v_year, v_month, p_day);
    if v_date < p_from then
      v_date := (date_trunc('month', p_from) + interval '1 month')::date + (p_day - 1);
    end if;
    return v_date;
  elsif p_frequency = 'yearly' then
    v_last_day := extract(day from (make_date(v_year, p_month, 1) + interval '1 month - 1 day'))::integer;
    v_date := make_date(v_year, p_month, least(p_day, v_last_day));
    if v_date < p_from then
      v_year := v_year + 1;
      v_last_day := extract(day from (make_date(v_year, p_month, 1) + interval '1 month - 1 day'))::integer;
      v_date := make_date(v_year, p_month, least(p_day, v_last_day));
    end if;
    return v_date;
  end if;
  raise exception 'Unsupported recurring frequency' using errcode = '22023';
end;
$$;
revoke all on function private.recurring_next_date(text, integer, integer, date) from public, anon, authenticated;

-- The server establishes start dates so device clocks/timezones cannot start a
-- daily rule early. Existing monthly start dates and their catch-up are retained.
create or replace function private.prepare_recurring_schedule()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if tg_op = 'INSERT' then
    if new.frequency in ('daily', 'yearly') then
      new.start_date := v_today + 1;
    end if;
    new.next_due_date := private.recurring_next_date(new.frequency, new.day_of_month, new.month_of_year, new.start_date);
  elsif new.frequency is distinct from old.frequency
     or new.day_of_month is distinct from old.day_of_month
     or new.month_of_year is distinct from old.month_of_year
     or new.start_date is distinct from old.start_date then
    if new.frequency = 'daily' and old.frequency is distinct from 'daily' then
      new.start_date := v_today + 1;
    elsif new.frequency = 'yearly' and (old.frequency is distinct from 'yearly'
       or new.day_of_month is distinct from old.day_of_month
       or new.month_of_year is distinct from old.month_of_year) then
      new.start_date := v_today + 1;
    end if;
    new.next_due_date := private.recurring_next_date(new.frequency, new.day_of_month, new.month_of_year, new.start_date);
  end if;
  return new;
end;
$$;
revoke all on function private.prepare_recurring_schedule() from public, anon, authenticated;

update public.recurring_transactions
set next_due_date = private.recurring_next_date(frequency, day_of_month, month_of_year, start_date);
alter table public.recurring_transactions alter column next_due_date set not null;
create trigger prepare_recurring_schedule
  before insert or update on public.recurring_transactions
  for each row execute function private.prepare_recurring_schedule();
create index recurring_transactions_due_idx
  on public.recurring_transactions (next_due_date) where enabled;

-- In addition to legacy month keys, a date key prevents duplicates if a rule's
-- frequency changes after an entry has already been generated on that date.
alter table public.recurring_runs add column scheduled_date date;
update public.recurring_runs r
set scheduled_date = (t.occurred_at at time zone coalesce(f.timezone, 'Asia/Shanghai'))::date
from public.transactions t, public.recurring_transactions rule
join public.families f on f.id = rule.family_id
where r.transaction_id = t.id and r.rule_id = rule.id;
create unique index recurring_runs_rule_date_idx
  on public.recurring_runs (rule_id, scheduled_date) where scheduled_date is not null;

-- p_family_id is supplied only by the authenticated wrapper, or null by the
-- private cron job. p_now is injectable for deterministic database tests.
create or replace function private.generate_due_recurring_transactions(
  p_family_id uuid, p_now timestamptz
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cutoff date := ((p_now at time zone 'Asia/Shanghai') - interval '6 hours')::date;
  v_rule public.recurring_transactions;
  v_due date;
  v_period text;
  v_run_id uuid;
  v_txn_id uuid;
  v_count integer := 0;
  v_processed integer := 0;
  v_count_before integer;
  v_processed_before integer;
begin
  for v_rule in
    select * from public.recurring_transactions
    where enabled and next_due_date <= v_cutoff
      and (end_date is null or next_due_date <= end_date)
      and (p_family_id is null or family_id = p_family_id)
    order by next_due_date, id
    limit 1000
    for update skip locked
  loop
    v_count_before := v_count;
    v_processed_before := v_processed;
    begin
      v_due := v_rule.next_due_date;
      while v_due <= v_cutoff and (v_rule.end_date is null or v_due <= v_rule.end_date)
        and v_processed < 1000 loop
        v_period := case v_rule.frequency
          when 'daily' then 'day:' || to_char(v_due, 'YYYY-MM-DD')
          when 'yearly' then 'year:' || to_char(v_due, 'YYYY')
          else to_char(v_due, 'YYYY-MM')
        end;
        v_run_id := null;
        insert into public.recurring_runs (rule_id, period_key, scheduled_date)
        values (v_rule.id, v_period, v_due)
        on conflict do nothing
        returning id into v_run_id;
        if v_run_id is not null then
          insert into public.transactions
            (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source)
          values (v_rule.family_id, v_rule.type, v_rule.amount, v_rule.category_id, v_rule.note,
            (v_due::timestamp + interval '6 hours') at time zone 'Asia/Shanghai',
            v_rule.recorder_user_id, 'normal')
          returning id into v_txn_id;
          update public.recurring_runs set transaction_id = v_txn_id where id = v_run_id;
          v_count := v_count + 1;
        end if;
        v_processed := v_processed + 1;
        v_due := private.recurring_next_date(v_rule.frequency, v_rule.day_of_month, v_rule.month_of_year, v_due + 1);
      end loop;
      update public.recurring_transactions set next_due_date = v_due where id = v_rule.id;
    exception when others then
      -- Roll back this rule only; another rule must not prevent other entries.
      v_count := v_count_before;
      v_processed := v_processed_before;
      raise warning 'Recurring rule % failed (SQLSTATE %)', v_rule.id, SQLSTATE;
    end;
    exit when v_processed >= 1000;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.generate_due_recurring_transactions(uuid, timestamptz) from public, anon, authenticated;

-- Retain the public RPC for installed clients and the current-family catch-up.
create or replace function public.generate_due_recurring_transactions()
returns integer language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_family_id uuid;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  select current_family_id into v_family_id from public.profiles where id = v_uid;
  if v_family_id is null then return 0; end if;
  if not private.is_family_member(v_family_id) then
    raise exception '无权访问该家庭' using errcode = '42501';
  end if;
  return private.generate_due_recurring_transactions(v_family_id, now());
end;
$$;
revoke execute on function public.generate_due_recurring_transactions() from public, anon;
grant execute on function public.generate_due_recurring_transactions() to authenticated;

-- One bounded batch per minute; the cutoff prevents today's entry before 06:00.
-- Repeated runs also catch up after an outage without relying on an open app.
select cron.schedule('homebook-recurring-generate', '* * * * *',
  'select private.generate_due_recurring_transactions(null, now())');
