begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);
select is(private.recurring_next_date('monthly',31,null,'2025-02-01'), date '2025-02-28', 'February clamps 31 to month end');
select is(private.recurring_next_date('monthly',31,null,'2024-02-01'), date '2024-02-29', 'Leap February clamps 31 to February 29');
select is(private.recurring_next_date('monthly',31,null,'2025-04-01'), date '2025-04-30', 'April clamps 31 to April 30');
select is(private.recurring_next_date('monthly',31,null,'2025-05-01'), date '2025-05-31', 'A long month retains day 31');
insert into auth.users (id,email,raw_user_meta_data) values ('20000000-0000-0000-0000-000000000001','recurring-time@example.invalid','{}');
insert into public.families (id,name,owner_user_id,timezone) values ('20000000-0000-0000-0000-000000000002','Time test','20000000-0000-0000-0000-000000000001','Asia/Shanghai');
insert into public.categories (id,family_id,name,type) values ('20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','Time test','expense');
insert into public.recurring_transactions (id,family_id,type,amount,category_id,recorder_user_id,created_by,day_of_month,frequency,start_date,scheduled_minute)
values ('20000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','expense',100,'20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'daily','2000-01-01',720);
select is(private.generate_due_recurring_transactions('20000000-0000-0000-0000-000000000002', (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '11 hours 59 minutes') at time zone 'Asia/Shanghai'),0,'No entry before chosen time');
select is(private.generate_due_recurring_transactions('20000000-0000-0000-0000-000000000002', (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '12 hours') at time zone 'Asia/Shanghai'),1,'Entry generated at chosen time');
select is(private.generate_due_recurring_transactions('20000000-0000-0000-0000-000000000002', (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '12 hours 1 minute') at time zone 'Asia/Shanghai'),0,'Repeated execution does not duplicate');
select is((select occurred_at at time zone 'Asia/Shanghai' from public.transactions where family_id='20000000-0000-0000-0000-000000000002'), (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '12 hours'),'Entry records selected time');
insert into public.recurring_transactions (id,family_id,type,amount,category_id,recorder_user_id,created_by,day_of_month,frequency,start_date)
values ('20000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002','expense',100,'20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',31,'monthly','2025-02-01');
select is((select scheduled_minute from public.recurring_transactions where id='20000000-0000-0000-0000-000000000005'),360,'Default time remains 06:00');
select is(private.generate_due_recurring_transactions('20000000-0000-0000-0000-000000000002','2025-02-28 06:00+08'),1,'Month-end rule generates on February 28');
update public.recurring_transactions set enabled = false where family_id = '20000000-0000-0000-0000-000000000002';
insert into public.recurring_transactions (id,family_id,type,amount,category_id,recorder_user_id,created_by,day_of_month,frequency,start_date,scheduled_minute)
values
 ('20000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000002','expense',100,'20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'daily','2000-01-01',0),
 ('20000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000002','expense',100,'20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',1,'daily','2000-01-01',1439);
select is(private.generate_due_recurring_transactions('20000000-0000-0000-0000-000000000002', ((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp at time zone 'Asia/Shanghai'),1,'Midnight generates on the due date');
select is(private.generate_due_recurring_transactions('20000000-0000-0000-0000-000000000002', (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '23 hours 58 minutes') at time zone 'Asia/Shanghai'),0,'23:59 does not generate early');
select is(private.generate_due_recurring_transactions('20000000-0000-0000-0000-000000000002', (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '23 hours 59 minutes') at time zone 'Asia/Shanghai'),1,'23:59 generates on time');
select is(private.generate_due_recurring_transactions('20000000-0000-0000-0000-000000000002', (((now() at time zone 'Asia/Shanghai')::date + 1)::timestamp + interval '23 hours 59 minutes') at time zone 'Asia/Shanghai'),0,'23:59 remains idempotent');
select * from finish();
rollback;
