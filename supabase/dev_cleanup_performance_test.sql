-- HomeBook 生产性能压测数据清理脚本
--
-- 仅用于清理 2026-09-05 创建的隔离性能测试家庭。
-- 执行前确认不再需要报表/搜索的大数据量验证；本脚本不可恢复。
-- 账号与家庭均以固定 UUID + 测试名称双重限定，避免误删正常数据。

begin;

do $cleanup$
begin
  if not exists (
    select 1
    from public.families
    where id = 'f6000000-0000-0000-0000-000000000001'::uuid
      and name = '性能压测家庭（待清理）'
  ) then
    raise exception '未找到目标性能压测家庭，停止清理';
  end if;
end;
$cleanup$;

-- 先解除 profiles -> families 的外键。
--
-- 家庭实时修订触发器会在共享数据删除时更新 family_data_revisions，
-- 因此必须在 families 行仍存在时先删除各共享子数据。若直接删除家庭，
-- 级联删除 transactions/memberships 的 AFTER DELETE 触发器会尝试写回已删除家庭的修订行。
-- 本次流水量为 100,000 条；在本事务中临时抑制用户触发器，避免为即将整体删除的
-- 测试家庭重复写入 100,000 次修订号。该设置仅在 commit/rollback 前有效。
update public.profiles
set current_family_id = null
where id in (
  '60000000-0000-0000-0000-000000000001'::uuid,
  '60000000-0000-0000-0000-000000000002'::uuid,
  '60000000-0000-0000-0000-000000000003'::uuid,
  '60000000-0000-0000-0000-000000000004'::uuid,
  '60000000-0000-0000-0000-000000000005'::uuid,
  '2937b7d2-72cf-4dbd-9d8b-f96a6f007a8e'::uuid
);

set local session_replication_role = replica;

delete from public.savings_entries
where goal_id in (
  select id
  from public.savings_goals
  where family_id = 'f6000000-0000-0000-0000-000000000001'::uuid
);

delete from public.transactions
where family_id = 'f6000000-0000-0000-0000-000000000001'::uuid;

delete from public.savings_goals
where family_id = 'f6000000-0000-0000-0000-000000000001'::uuid;

delete from public.budget_categories
where budget_id in (
  select id
  from public.budgets
  where family_id = 'f6000000-0000-0000-0000-000000000001'::uuid
);

delete from public.budgets
where family_id = 'f6000000-0000-0000-0000-000000000001'::uuid;

delete from public.recurring_transactions
where family_id = 'f6000000-0000-0000-0000-000000000001'::uuid;

delete from public.family_hidden_categories
where family_id = 'f6000000-0000-0000-0000-000000000001'::uuid;

delete from public.categories
where family_id = 'f6000000-0000-0000-0000-000000000001'::uuid;

delete from public.memberships
where family_id = 'f6000000-0000-0000-0000-000000000001'::uuid;

set local session_replication_role = origin;

delete from public.families
where id = 'f6000000-0000-0000-0000-000000000001'::uuid
  and name = '性能压测家庭（待清理）';

-- 家庭及其流水已删除后，删除本次创建的 6 个 Auth 用户和关联 profiles/identities。
delete from auth.users
where id in (
  '60000000-0000-0000-0000-000000000001'::uuid,
  '60000000-0000-0000-0000-000000000002'::uuid,
  '60000000-0000-0000-0000-000000000003'::uuid,
  '60000000-0000-0000-0000-000000000004'::uuid,
  '60000000-0000-0000-0000-000000000005'::uuid,
  '2937b7d2-72cf-4dbd-9d8b-f96a6f007a8e'::uuid
);

commit;

-- 执行后应全部为 0。
select
  (select count(*) from public.families where id = 'f6000000-0000-0000-0000-000000000001'::uuid) as families,
  (select count(*) from public.transactions where family_id = 'f6000000-0000-0000-0000-000000000001'::uuid) as transactions,
  (select count(*) from auth.users where id in (
    '60000000-0000-0000-0000-000000000001'::uuid,
    '60000000-0000-0000-0000-000000000002'::uuid,
    '60000000-0000-0000-0000-000000000003'::uuid,
    '60000000-0000-0000-0000-000000000004'::uuid,
    '60000000-0000-0000-0000-000000000005'::uuid,
    '2937b7d2-72cf-4dbd-9d8b-f96a6f007a8e'::uuid
  )) as auth_users;
