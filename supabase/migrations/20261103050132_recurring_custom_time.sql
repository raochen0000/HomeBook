-- Preserve existing schedules at 06:00 Beijing and allow minute precision.
alter table public.recurring_transactions
  add column scheduled_minute integer not null default 360
    check (scheduled_minute between 0 and 1439),
  drop constraint recurring_schedule_check;
alter table public.recurring_transactions
  add constraint recurring_schedule_check check (
    (frequency = 'daily' and day_of_month = 1 and month_of_year is null)
    or (frequency = 'monthly' and day_of_month between 1 and 31 and month_of_year is null)
    or (frequency = 'yearly' and month_of_year is not null and month_of_year between 1 and 12 and day_of_month between 1 and
      extract(day from (make_date(2000, month_of_year, 1) + interval '1 month - 1 day'))::integer)
  );

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
    v_last_day := extract(day from (make_date(v_year, v_month, 1) + interval '1 month - 1 day'))::integer;
    v_date := make_date(v_year, v_month, least(p_day, v_last_day));
    if v_date < p_from then
      v_date := (date_trunc('month', p_from) + interval '1 month')::date;
      v_last_day := extract(day from (v_date + interval '1 month - 1 day'))::integer;
      v_date := v_date + (least(p_day, v_last_day) - 1);
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

create or replace function private.generate_due_recurring_transactions(
  p_family_id uuid, p_now timestamptz
) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_local_now timestamp := p_now at time zone 'Asia/Shanghai';
  v_today date := v_local_now::date;
  v_minute integer := extract(hour from v_local_now)::integer * 60 + extract(minute from v_local_now)::integer;
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
    where enabled and (next_due_date < v_today
      or (next_due_date = v_today and scheduled_minute <= v_minute))
      and (end_date is null or next_due_date <= end_date)
      and (p_family_id is null or family_id = p_family_id)
    order by next_due_date, scheduled_minute, id
    limit 1000
    for update skip locked
  loop
    v_count_before := v_count;
    v_processed_before := v_processed;
    begin
      v_due := v_rule.next_due_date;
      while (v_due < v_today or (v_due = v_today and v_rule.scheduled_minute <= v_minute))
        and (v_rule.end_date is null or v_due <= v_rule.end_date)
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
            (v_due::timestamp + v_rule.scheduled_minute * interval '1 minute') at time zone 'Asia/Shanghai',
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

