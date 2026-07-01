-- 记录每笔流水的「最后修改者」，用于首页流水第二行展示修改者头像（仅当被他人修改时）。
-- 数据库端口被防火墙拦截，请在 Supabase Studio → SQL Editor 执行本文件（不要走 psql/CLI）。

alter table public.transactions
  add column if not exists last_editor_user_id uuid references public.profiles(id) on delete set null;

comment on column public.transactions.last_editor_user_id is
  '最后一次 UPDATE 的操作者（auth.uid()）；NULL 表示自创建后未被编辑。';

-- 每次 UPDATE 自动把修改者盖章为当前登录用户（含软删除，但软删行已被列表过滤，无影响）。
create or replace function public.set_transaction_last_editor()
returns trigger
language plpgsql
as $$
begin
  new.last_editor_user_id := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_transactions_last_editor on public.transactions;
create trigger trg_transactions_last_editor
  before update on public.transactions
  for each row
  execute function public.set_transaction_last_editor();
