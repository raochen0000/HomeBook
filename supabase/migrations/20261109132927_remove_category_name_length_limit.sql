-- Remove the category name length limit while retaining existing authorization.
create or replace function public.create_hierarchical_category(
  p_family_id uuid, p_name text, p_icon text, p_type text, p_color_key text,
  p_parent_category_id uuid default null, p_is_group boolean default false
) returns public.categories language plpgsql security invoker set search_path = '' as $$
declare v_category public.categories;
begin
  if not private.is_family_member(p_family_id) then raise exception '无家庭权限' using errcode = '42501'; end if;
  if p_is_group and p_parent_category_id is not null then raise exception '最多支持两级分类'; end if;
  if btrim(p_name) = '' or p_type not in ('expense', 'income') then
    raise exception '分类名称或类型无效';
  end if;
  insert into public.categories (family_id, name, icon, type, color_key, is_system, status)
    values (p_family_id, btrim(p_name), p_icon, p_type, p_color_key, false, 'active')
    returning * into v_category;
  if p_is_group or p_parent_category_id is not null then
    insert into public.family_category_layout (family_id, category_id, parent_category_id, is_group, legacy_entry)
      values (p_family_id, v_category.id, p_parent_category_id, p_is_group, false);
  end if;
  return v_category;
end;
$$;
