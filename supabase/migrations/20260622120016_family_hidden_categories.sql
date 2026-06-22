-- 0016 · FAMILY_HIDDEN_CATEGORIES（家庭隐藏的系统预设分类 · PRD 流程 11 / MVP §2.4）
-- ----------------------------------------------------------------------------
-- 背景：系统预设分类是全局单行（categories.family_id is null, is_system=true），
-- 不能直接把它 status='hidden'——那会对「所有家庭」生效。此表做按家庭覆盖：
-- 一行 = 「该 family 在记账/预算选择器中隐藏了该系统分类」。
-- 全局分类行保持 active，历史流水仍能解析其名称/图标（显示零回归）。
-- 自定义分类的「删除」仍走软删除 categories.status='archived'，不进此表。

create table public.family_hidden_categories (
  family_id   uuid not null references public.families(id)   on delete cascade,
  category_id uuid not null references public.categories(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (family_id, category_id)
);

comment on table public.family_hidden_categories is
  '家庭对系统预设分类的隐藏覆盖：仅系统分类（categories.family_id is null）可入此表；自定义分类用 categories.status=archived 软删除。';

-- 完整性：只允许隐藏「系统预设分类」，挡住误把自定义分类写进来。
create or replace function private.assert_hideable_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.categories
    where id = new.category_id and family_id is null and is_system = true
  ) then
    raise exception '只能隐藏系统预设分类（category_id=% 非系统分类）', new.category_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger family_hidden_categories_system_only
  before insert on public.family_hidden_categories
  for each row execute function private.assert_hideable_category();

-- ── RLS：家庭成员可读/隐藏/取消隐藏本家庭的覆盖行（与停用自定义分类一致，户主门禁在前端）──
alter table public.family_hidden_categories enable row level security;

create policy "fhc_select_member" on public.family_hidden_categories
  for select to authenticated
  using (private.is_family_member(family_id));

create policy "fhc_insert_member" on public.family_hidden_categories
  for insert to authenticated
  with check (private.is_family_member(family_id));

create policy "fhc_delete_member" on public.family_hidden_categories
  for delete to authenticated
  using (private.is_family_member(family_id));
