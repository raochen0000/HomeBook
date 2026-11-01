-- Run against a local Supabase database after migrations: supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);

select is(private.recurring_next_date('yearly', 29, 2, '2024-01-01'), date '2024-02-29', 'Leap year uses February 29');
select is(private.recurring_next_date('yearly', 29, 2, '2025-01-01'), date '2025-02-28', 'Common year uses February 28');
select is(private.recurring_next_date('yearly', 29, 2, '2025-03-01'), date '2026-02-28', 'Past annual date moves to next year');
select is(private.recurring_next_date('monthly', 28, null, '2025-02-28'), date '2025-02-28', 'Monthly date includes its due date');
select ok(not has_function_privilege('authenticated', 'private.generate_due_recurring_transactions(uuid,timestamp with time zone)', 'execute'), 'Private generator is not callable by authenticated clients');
select ok(has_function_privilege('authenticated', 'public.generate_due_recurring_transactions()', 'execute'), 'Authenticated catch-up wrapper remains available');

insert into auth.users (id, email, raw_user_meta_data)
values ('10000000-0000-0000-0000-000000000001', 'recurring-test@example.invalid', '{}');
insert into public.families (id, name, owner_user_id, timezone)
values ('10000000-0000-0000-0000-000000000002', 'Recurring test', '10000000-0000-0000-0000-000000000001', 'Asia/Shanghai');
update public.profiles set current_family_id = '10000000-0000-0000-0000-000000000002'
where id = '10000000-0000-0000-0000-000000000001';
insert into public.memberships (family_id, user_id, role)
values ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'owner');
insert into public.categories (id, family_id, name, type)
values ('10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Recurring test', 'expense');
insert into public.recurring_transactions
  (id, family_id, type, amount, category_id, recorder_user_id, created_by, day_of_month, frequency, start_date)
values ('10000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'expense', 100,
  '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 1, 'daily', '2000-01-01');

select is((select start_date from public.recurring_transactions where id = '10000000-0000-0000-0000-000000000004'),
  (now() at time zone 'Asia/Shanghai')::date + 1, 'Daily rule starts tomorrow in Beijing');
select is(private.generate_due_recurring_transactions('10000000-0000-0000-0000-000000000002',
  (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '5 hours 59 minutes') at time zone 'Asia/Shanghai'),
  0, 'No daily entry before 06:00');
select is(private.generate_due_recurring_transactions('10000000-0000-0000-0000-000000000002',
  (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '6 hours') at time zone 'Asia/Shanghai'),
  1, 'One daily entry at 06:00');
select is(private.generate_due_recurring_transactions('10000000-0000-0000-0000-000000000002',
  (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '6 hours 1 minute') at time zone 'Asia/Shanghai'),
  0, 'Repeated generation does not duplicate the entry');
select is((select occurred_at at time zone 'Asia/Shanghai' from public.transactions
  where family_id = '10000000-0000-0000-0000-000000000002'),
  (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '6 hours'), 'Entry timestamp is 06:00 Beijing');

-- Switching frequency after an entry was generated must not create a second
-- entry on the same scheduled date.
update public.recurring_transactions set frequency = 'yearly',
  month_of_year = extract(month from ((now() at time zone 'Asia/Shanghai')::date + 1))::int,
  day_of_month = extract(day from ((now() at time zone 'Asia/Shanghai')::date + 1))::int
where id = '10000000-0000-0000-0000-000000000004';
select is(private.generate_due_recurring_transactions('10000000-0000-0000-0000-000000000002',
  (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '6 hours') at time zone 'Asia/Shanghai'),
  0, 'Changing frequency does not duplicate an existing scheduled date');
select is((select count(*)::integer from public.transactions where family_id = '10000000-0000-0000-0000-000000000002'),
  1, 'Only one entry exists after frequency change');

create function pg_temp.reject_test_transaction() returns trigger language plpgsql as $$
begin
  if new.note = 'recurring-failure-test' then raise exception 'simulated failure'; end if;
  return new;
end;
$$;
create trigger recurring_test_failure before insert on public.transactions
  for each row execute function pg_temp.reject_test_transaction();
insert into public.recurring_transactions
  (id, family_id, type, amount, category_id, recorder_user_id, created_by, day_of_month, frequency, start_date, note)
values
  ('10000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', 'expense', 100,
   '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 1, 'daily', '2000-01-01', 'recurring-failure-test'),
  ('10000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000002', 'expense', 100,
   '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   '10000000-0000-0000-0000-000000000001', 1, 'daily', '2000-01-01', 'recurring-success-test');
select is(private.generate_due_recurring_transactions('10000000-0000-0000-0000-000000000002',
  (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '6 hours') at time zone 'Asia/Shanghai'),
  1, 'A failed rule does not block another rule');
select is((select count(*)::integer from public.recurring_runs where rule_id = '10000000-0000-0000-0000-000000000006'),
  0, 'A failed rule leaves no incomplete run');
drop trigger recurring_test_failure on public.transactions;
select is(private.generate_due_recurring_transactions('10000000-0000-0000-0000-000000000002',
  (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '6 hours') at time zone 'Asia/Shanghai'),
  1, 'A failed rule can be retried');
select is((select count(*)::integer from public.transactions where family_id = '10000000-0000-0000-0000-000000000002'),
  3, 'Retry creates only the missing entry');

update public.recurring_transactions set enabled = false
where family_id = '10000000-0000-0000-0000-000000000002';
insert into public.recurring_transactions
  (family_id, type, amount, category_id, recorder_user_id, created_by, day_of_month, frequency, start_date)
select '10000000-0000-0000-0000-000000000002', 'expense', 100,
  '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 1, 'daily', '2000-01-01'
from generate_series(1, 1001);
select is(private.generate_due_recurring_transactions('10000000-0000-0000-0000-000000000002',
  (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '6 hours') at time zone 'Asia/Shanghai'),
  1000, 'A single invocation processes at most 1000 due periods');
select is(private.generate_due_recurring_transactions('10000000-0000-0000-0000-000000000002',
  (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '6 hours') at time zone 'Asia/Shanghai'),
  1, 'The next invocation continues the remaining batch');

select throws_ok('select public.generate_due_recurring_transactions()', '28000', '未认证', 'Unauthenticated catch-up is rejected');
insert into auth.users (id, email, raw_user_meta_data)
values ('10000000-0000-0000-0000-000000000005', 'recurring-outsider@example.invalid', '{}');
update public.profiles set current_family_id = '10000000-0000-0000-0000-000000000002'
where id = '10000000-0000-0000-0000-000000000005';
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000005', true);
select throws_ok('select public.generate_due_recurring_transactions()', '42501', '无权访问该家庭', 'Non-member cannot run another family catch-up');
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select lives_ok('select public.generate_due_recurring_transactions()', 'Family member can call the catch-up wrapper');
select * from finish();
rollback;
