-- 家庭在线协作门铃：一张版本号表 + 共享表写触发器 + Realtime publication。
-- 客户端只订这一行（以及本人 notifications），再失效 React Query，不逐表拼缓存。
-- Cloud 关闭了「新表自动暴露」，须显式 GRANT SELECT；写路径仅内部触发器。

create table public.family_data_revisions (
  family_id  uuid primary key references public.families (id) on delete cascade,
  revision   bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now()
);

comment on table public.family_data_revisions is
  '家庭共享数据版本号。共享表写入后 revision + 1，供 Realtime 门铃失效客户端缓存。';

alter table public.family_data_revisions enable row level security;

create policy "family_data_revisions_select_member" on public.family_data_revisions
  for select to authenticated
  using (private.is_family_member(family_id));

grant select on table public.family_data_revisions to authenticated;

create or replace function private.touch_family_revision(p_family_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_family_id is null then
    return;
  end if;
  insert into public.family_data_revisions (family_id, revision, updated_at)
  values (p_family_id, 1, now())
  on conflict (family_id) do update
    set revision = public.family_data_revisions.revision + 1,
        updated_at = now();
end;
$$;

revoke all on function private.touch_family_revision(uuid) from public, anon, authenticated;

create or replace function private.tg_touch_family_revision_from_family_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.touch_family_revision(old.family_id);
    return old;
  end if;
  perform private.touch_family_revision(new.family_id);
  if tg_op = 'UPDATE' and old.family_id is distinct from new.family_id then
    perform private.touch_family_revision(old.family_id);
  end if;
  return new;
end;
$$;

create or replace function private.tg_touch_family_revision_from_family_pk()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.touch_family_revision(old.id);
    return old;
  end if;
  perform private.touch_family_revision(new.id);
  return new;
end;
$$;

create or replace function private.tg_touch_family_revision_from_budget()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family uuid;
  v_budget uuid := coalesce(new.budget_id, old.budget_id);
begin
  select family_id into v_family from public.budgets where id = v_budget;
  perform private.touch_family_revision(v_family);
  return coalesce(new, old);
end;
$$;

create or replace function private.tg_touch_family_revision_from_goal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family uuid;
  v_goal uuid := coalesce(new.goal_id, old.goal_id);
begin
  select family_id into v_family from public.savings_goals where id = v_goal;
  perform private.touch_family_revision(v_family);
  return coalesce(new, old);
end;
$$;

create or replace function private.tg_touch_family_revision_from_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.nickname is not distinct from old.nickname
     and new.avatar_url is not distinct from old.avatar_url
     and new.current_family_id is not distinct from old.current_family_id then
    return new;
  end if;
  if tg_op = 'DELETE' then
    perform private.touch_family_revision(old.current_family_id);
    return old;
  end if;
  perform private.touch_family_revision(new.current_family_id);
  if tg_op = 'UPDATE' and old.current_family_id is distinct from new.current_family_id then
    perform private.touch_family_revision(old.current_family_id);
  end if;
  return new;
end;
$$;

create or replace function private.tg_touch_family_revision_from_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform private.touch_family_revision(old.family_id);
    return old;
  end if;
  -- 系统分类 family_id 为空，不敲门铃。
  perform private.touch_family_revision(new.family_id);
  if tg_op = 'UPDATE' and old.family_id is distinct from new.family_id then
    perform private.touch_family_revision(old.family_id);
  end if;
  return new;
end;
$$;

revoke all on function private.tg_touch_family_revision_from_family_id() from public, anon, authenticated;
revoke all on function private.tg_touch_family_revision_from_family_pk() from public, anon, authenticated;
revoke all on function private.tg_touch_family_revision_from_budget() from public, anon, authenticated;
revoke all on function private.tg_touch_family_revision_from_goal() from public, anon, authenticated;
revoke all on function private.tg_touch_family_revision_from_profile() from public, anon, authenticated;
revoke all on function private.tg_touch_family_revision_from_category() from public, anon, authenticated;

create trigger family_data_revisions_on_families
  after insert or update on public.families
  for each row execute function private.tg_touch_family_revision_from_family_pk();

create trigger family_data_revisions_on_memberships
  after insert or update or delete on public.memberships
  for each row execute function private.tg_touch_family_revision_from_family_id();

create trigger family_data_revisions_on_transactions
  after insert or update or delete on public.transactions
  for each row execute function private.tg_touch_family_revision_from_family_id();

create trigger family_data_revisions_on_categories
  after insert or update or delete on public.categories
  for each row execute function private.tg_touch_family_revision_from_category();

create trigger family_data_revisions_on_hidden_categories
  after insert or update or delete on public.family_hidden_categories
  for each row execute function private.tg_touch_family_revision_from_family_id();

create trigger family_data_revisions_on_savings_goals
  after insert or update or delete on public.savings_goals
  for each row execute function private.tg_touch_family_revision_from_family_id();

create trigger family_data_revisions_on_savings_entries
  after insert or update or delete on public.savings_entries
  for each row execute function private.tg_touch_family_revision_from_goal();

create trigger family_data_revisions_on_budgets
  after insert or update or delete on public.budgets
  for each row execute function private.tg_touch_family_revision_from_family_id();

create trigger family_data_revisions_on_budget_categories
  after insert or update or delete on public.budget_categories
  for each row execute function private.tg_touch_family_revision_from_budget();

create trigger family_data_revisions_on_recurring
  after insert or update or delete on public.recurring_transactions
  for each row execute function private.tg_touch_family_revision_from_family_id();

create trigger family_data_revisions_on_profiles
  after update or delete on public.profiles
  for each row execute function private.tg_touch_family_revision_from_profile();

insert into public.family_data_revisions (family_id, revision)
select id, 1 from public.families
on conflict (family_id) do nothing;

-- 通知按 user_id 过滤 Realtime；非主键列的 UPDATE/DELETE 需要完整 replica identity。
alter table public.notifications replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'family_data_revisions'
  ) then
    execute 'alter publication supabase_realtime add table public.family_data_revisions';
  end if;
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.notifications';
  end if;
end;
$$;
