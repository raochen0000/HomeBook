-- Run against a local Supabase database after migrations: supabase test db.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(22);

insert into auth.users (id, email, raw_user_meta_data) values
  ('21000000-0000-0000-0000-000000000001', 'category-owner@example.invalid', '{}'),
  ('21000000-0000-0000-0000-000000000002', 'category-member@example.invalid', '{}'),
  ('21000000-0000-0000-0000-000000000003', 'category-outsider@example.invalid', '{}');
insert into public.families (id, name, owner_user_id, timezone) values
  ('22000000-0000-0000-0000-000000000001', 'Category test', '21000000-0000-0000-0000-000000000001', 'Asia/Shanghai'),
  ('22000000-0000-0000-0000-000000000002', 'Other family', '21000000-0000-0000-0000-000000000003', 'Asia/Shanghai');
insert into public.memberships (family_id, user_id, role) values
  ('22000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'owner'),
  ('22000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000002', 'member'),
  ('22000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000003', 'owner');
-- Model a legacy system/custom name collision that was possible before the
-- hierarchy migration; unrelated changes must not be blocked by that old pair.
alter table public.categories disable trigger category_sibling_names;
insert into public.categories (id, family_id, name, icon, type, is_system, color_key) values
  ('23000000-0000-0000-0000-000000000004', null, '历史重名测试', 'fork.knife', 'expense', true, null),
  ('23000000-0000-0000-0000-000000000005', '22000000-0000-0000-0000-000000000001', '历史重名测试', 'fork.knife', 'expense', false, 'food');
alter table public.categories enable trigger category_sibling_names;
insert into public.categories (id, family_id, name, icon, type, is_system, color_key) values
  ('23000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '餐饮测试', 'fork.knife', 'expense', false, 'food'),
  ('23000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', '早餐测试', 'cup.and.saucer.fill', 'expense', false, 'food'),
  ('23000000-0000-0000-0000-000000000003', '22000000-0000-0000-0000-000000000001', '居家测试', 'house.fill', 'expense', false, 'home');
insert into public.budgets (id, family_id, period, total_amount, alert_enabled) values
  ('24000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '2026-06', 200000, true),
  ('24000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', '2000-01', 200000, true);
insert into public.budget_categories (budget_id, category_id, amount) values
  ('24000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 200000),
  ('24000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000002', 30000);
insert into public.transactions (id, family_id, type, amount, category_id, recorder_user_id, occurred_at, source) values
  ('25000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'expense', 10000, '23000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '2026-06-10 04:00Z', 'normal'),
  ('25000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', 'expense', 2000, '23000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000002', '2026-06-11 04:00Z', 'normal');
insert into public.recurring_transactions
  (id, family_id, type, amount, category_id, recorder_user_id, created_by, day_of_month, frequency, start_date)
values ('26000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001',
  'expense', 10000, '23000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001',
  '21000000-0000-0000-0000-000000000001', 10, 'monthly', '2026-06-01');
insert into public.recurring_runs (rule_id, period_key, transaction_id)
values ('26000000-0000-0000-0000-000000000001', '2026-06', '25000000-0000-0000-0000-000000000001');
insert into public.savings_goals (id, family_id, name, target_amount)
values ('27000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '储蓄测试', 50000);
insert into public.transactions (id, family_id, type, amount, category_id, recorder_user_id, occurred_at, source, savings_goal_id)
values ('25000000-0000-0000-0000-000000000003', '22000000-0000-0000-0000-000000000001', 'expense', 5000,
  '23000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '2026-06-12 04:00Z',
  'savings_deposit', '27000000-0000-0000-0000-000000000001');
insert into public.savings_entries (goal_id, direction, amount, transaction_id)
values ('27000000-0000-0000-0000-000000000001', 'deposit', 5000, '25000000-0000-0000-0000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000002', true);
select throws_ok($$insert into public.family_category_layout (family_id, category_id, is_group, legacy_entry)
  values ('22000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', true, true)$$,
  'P0001', '已有分类预算，请由户主确认细分', 'Member cannot change an existing budget scope');
select throws_ok($$select public.save_family_budget('22000000-0000-0000-0000-000000000001', '2026-06', 200000, true, '[]')$$,
  '42501', '仅户主可设置预算', 'Member cannot save a budget');

select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000001', true);
select lives_ok($$do $test$ begin
  update public.categories set icon = 'cup.and.saucer.fill' where id = '23000000-0000-0000-0000-000000000005';
  set constraints category_sibling_names immediate;
  set constraints category_sibling_names deferred;
end $test$;$$, 'An unchanged legacy name can still be edited');
select lives_ok($$do $test$ begin
  insert into public.family_category_layout (family_id, category_id, is_group, legacy_entry)
  values ('22000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000005', true, true);
  set constraints category_layout_sibling_names immediate;
  set constraints category_layout_sibling_names deferred;
end $test$;$$, 'An existing duplicate can be promoted without changing its sibling set');
select lives_ok($$do $test$ begin
  perform public.create_hierarchical_category('22000000-0000-0000-0000-000000000001',
    '新分类测试', 'house.fill', 'expense', 'home', null, false);
  set constraints category_sibling_names immediate;
  set constraints category_sibling_names deferred;
end $test$;$$, 'An unrelated category can be created despite an old duplicate');
select throws_ok($$do $test$ begin
  perform public.create_hierarchical_category('22000000-0000-0000-0000-000000000001',
    '历史重名测试', 'house.fill', 'expense', 'home', null, false);
  set constraints category_sibling_names immediate;
end $test$;$$, '23505', '同一层级已有同名分类', 'New root name collisions are rejected');
select lives_ok($$insert into public.family_category_layout (family_id, category_id, is_group, legacy_entry)
  values ('22000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', true, true)$$,
  'Owner can split a budgeted category');
select lives_ok($$insert into public.family_category_layout (family_id, category_id, parent_category_id)
  values ('22000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001')$$,
  'Owner can move an existing child with only an old budget');
select is((select count(*) from public.budget_categories where budget_id = '24000000-0000-0000-0000-000000000002'),
  1::bigint, 'Moving the category retains past budget records');
insert into public.family_category_layout (family_id, category_id, is_group)
values ('22000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000003', true);
select lives_ok($$select public.create_hierarchical_category('22000000-0000-0000-0000-000000000001',
  '早餐测试', 'house.fill', 'expense', 'home', '23000000-0000-0000-0000-000000000003', false)$$,
  'Same child name is allowed under a different primary category');
select throws_ok($$do $test$ begin
  perform public.create_hierarchical_category('22000000-0000-0000-0000-000000000001',
    '早餐测试', 'house.fill', 'expense', 'home', '23000000-0000-0000-0000-000000000003', false);
  set constraints category_sibling_names, category_layout_sibling_names immediate;
end $test$; $$, '23505', '同一层级已有同名分类', 'Same child name is rejected within one primary category');
select is((select used_amount from public.get_budget_progress('2026-06')), 12000::bigint, 'Budget total retains both entries');
select is((select (category_usage->>'23000000-0000-0000-0000-000000000001')::bigint from public.get_budget_progress('2026-06')),
  12000::bigint, 'Primary budget includes its child and legacy entries');
select is((public.get_report_analytics('2026-06-01', '2026-07-01', '2026-05-01', '2026-05-01')->'expenseCategories'->0->>'currentAmount')::bigint,
  12000::bigint, 'Report aggregates the primary category');
select is(jsonb_array_length(public.get_report_analytics('2026-06-01', '2026-07-01', '2026-05-01', '2026-05-01')->'expenseCategoryChildren'),
  2, 'Report keeps the legacy and child breakdown');
select is((public.get_report_category_detail_v2('2026-06-01', '2026-07-01', '2026-05-01',
  array['23000000-0000-0000-0000-000000000001'::uuid, '23000000-0000-0000-0000-000000000002'::uuid],
  array['21000000-0000-0000-0000-000000000002'::uuid], 'expense')->>'amount')::bigint,
  2000::bigint, 'Category drilldown preserves member filters');
select throws_ok($$select public.save_family_budget('22000000-0000-0000-0000-000000000001', '2026-06', 200000, true,
  '[{"category_id":"23000000-0000-0000-0000-000000000002","amount":20000}]')$$,
  'P0001', '预算只能设置给有效的一级支出分类', 'Child category budgets are rejected');
select throws_ok($$update public.budgets set total_amount = 100 where id = '24000000-0000-0000-0000-000000000001'$$,
  'P0001', '此家庭已启用分类层级，请升级后再修改预算', 'Old clients cannot partially replace a hierarchical budget');
select is((select total_amount from public.budgets where id = '24000000-0000-0000-0000-000000000001'),
  200000::bigint, 'Failed budget writes preserve the original amount');

select set_config('request.jwt.claim.sub', '21000000-0000-0000-0000-000000000003', true);
select is((select count(*) from public.family_category_layout), 0::bigint, 'Another family cannot read the hierarchy');
reset role;
select lives_ok($$do $test$ begin
  delete from public.families where id = '22000000-0000-0000-0000-000000000001';
  set constraints all immediate;
end $test$;$$, 'Family deletion can cascade through the hierarchy, recurring rules and savings');
select is((select count(*) from public.family_category_layout where family_id = '22000000-0000-0000-0000-000000000001'),
  0::bigint, 'Family deletion removes its hierarchy');
select * from finish();
rollback;
