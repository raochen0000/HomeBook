-- 家账 HomeBook · 建库后验证脚本
-- 用法：在 Studio → SQL Editor 执行，逐段核对结果。
-- 期望：13 张业务表全部存在且 RLS 已启用；策略、函数、系统分类数量符合预期。

-- 1) 13 张业务表是否齐全 + RLS 是否启用（期望 13 行，rls_enabled 全为 true）
select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
order by tablename;

-- 2) 每张表的策略数量（期望各表 ≥1）
select schemaname, tablename, count(*) as policy_count
from pg_policies
where schemaname = 'public'
group by 1, 2
order by 2;

-- 3) RLS 辅助函数（期望 5 个 private.* 函数）
select n.nspname as schema, p.proname as func, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private'
order by 2;

-- 4) 核心 RPC（期望 4 个 public.* 函数，security_definer = true）
select p.proname as rpc, p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_family','join_family_by_code','savings_deposit','savings_withdraw')
order by 1;

-- 5) 系统预设分类（期望 15 条，含「储蓄·目标存入」「储蓄·目标取出」）
select count(*) as system_category_count
from public.categories
where is_system and family_id is null;

select name, type, icon from public.categories
where is_system and family_id is null
order by type, name;

-- 6) 关键部分唯一索引是否就位（期望含 one_active_per_user / one_owner_per_family 等）
select indexname from pg_indexes
where schemaname = 'public'
  and indexname in (
    'memberships_one_active_per_user',
    'memberships_one_owner_per_family',
    'succession_one_pending_per_family',
    'categories_uniq_system_name'
  )
order by 1;

-- 7) handle_new_user 触发器是否挂在 auth.users 上（期望 1 行）
select tgname from pg_trigger
where tgrelid = 'auth.users'::regclass and not tgisinternal;

-- 8) Storage 对象写权限策略是否就位（迁移 0020，期望 6 行：avatars_/covers_ 各 insert/update/delete）
--    缺失会导致 App 内上传头像/封面报 "new row violates row-level security policy"
--    （Studio 控制台手动上传走 service_role 绕过 RLS，不受影响，故易漏检）。
select policyname, cmd from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (policyname like 'avatars\_%' or policyname like 'covers\_%')
order by 1;
