-- 0001 · 扩展与基础 schema
-- ----------------------------------------------------------------------------
-- 说明：
--   * 不依赖 moddatetime 扩展，改用自定义 set_updated_at() 触发器函数（更可移植）。
--   * private schema 存放 RLS 辅助函数（SECURITY DEFINER），不暴露给 Data API。
--   * gen_random_uuid() 为 PG13+ 内置，无需额外扩展。

-- 用于 RLS 辅助函数的私有 schema（PostgREST 不会暴露此 schema）
create schema if not exists private;

-- 仅授予 authenticated 使用权（供 RLS 策略内调用辅助函数），不给 anon
grant usage on schema private to authenticated;

-- updated_at 自动维护函数（全表通用）
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
