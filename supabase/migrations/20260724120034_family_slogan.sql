-- 0034 · 家庭口号 + 邀请预览家庭头像
-- -----------------------------------------------------------------------------
-- 家庭口号是家庭封面上的公共文案，由户主维护；与家庭名称一样需有稳定的长度边界。
-- `not valid` 避免历史家庭名称阻塞迁移，但约束会校验之后的新增/更新值。

alter table public.families
  add column if not exists slogan text not null default '一起记录生活，温暖每一天';

alter table public.families
  drop constraint if exists families_name_length_check,
  add constraint families_name_length_check
    check (char_length(btrim(name)) between 2 and 12) not valid;

alter table public.families
  drop constraint if exists families_slogan_length_check,
  add constraint families_slogan_length_check
    check (char_length(btrim(slogan)) between 2 and 24) not valid;

comment on column public.families.slogan is '家庭口号，展示在家庭封面；户主可改，去首尾空格后 2–24 字符';

-- 加入前预览属于跨家庭受控读取；在既有 SECURITY DEFINER 契约里仅新增家庭公共头像与口号，
-- 不泄露成员昵称、联系方式或账本数据。
create or replace function public.preview_family_by_code(p_code text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid          uuid := (select auth.uid());
  v_inv          public.invitations;
  v_family       public.families;
  v_owner        public.profiles;
  v_member_count int;
  v_avatars      jsonb;
  v_cur_family   uuid;
  v_cur_role     text;
  v_cur_count    int;
  v_has_tx       boolean;
  v_impact       text;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  select * into v_inv from public.invitations where code = upper(trim(p_code));
  if not found or v_inv.status = 'revoked' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_inv.status = 'expired' or v_inv.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;

  select * into v_family from public.families where id = v_inv.family_id;
  if not found or v_family.status <> 'active' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_owner from public.profiles where id = v_family.owner_user_id;

  if exists (
    select 1 from public.memberships
    where family_id = v_family.id and user_id = v_uid and status = 'active'
  ) then
    return jsonb_build_object(
      'status', 'already_member',
      'family', jsonb_build_object('id', v_family.id, 'name', v_family.name)
    );
  end if;

  select count(*) into v_member_count from public.memberships
    where family_id = v_family.id and status = 'active';
  if v_member_count >= 5 then
    return jsonb_build_object('status', 'full');
  end if;

  select coalesce(jsonb_agg(a.avatar_url), '[]'::jsonb) into v_avatars
  from (
    select p.avatar_url
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.family_id = v_family.id and m.status = 'active'
    order by m.joined_at
    limit 5
  ) a;

  select current_family_id into v_cur_family from public.profiles where id = v_uid;
  if v_cur_family is null then
    v_impact := 'none';
  else
    select role into v_cur_role from public.memberships
      where user_id = v_uid and status = 'active';
    select count(*) into v_cur_count from public.memberships
      where family_id = v_cur_family and status = 'active';

    if v_cur_role = 'owner' and v_cur_count > 1 then
      v_impact := 'blocked_owner';
    elsif v_cur_count > 1 then
      v_impact := 'auto_leave';
    else
      select exists (
        select 1 from public.transactions
        where family_id = v_cur_family and is_deleted = false
      ) into v_has_tx;
      v_impact := case when v_has_tx then 'delete_origin' else 'none' end;
    end if;
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'impact', v_impact,
    'family', jsonb_build_object(
      'id',             v_family.id,
      'name',           v_family.name,
      'slogan',         v_family.slogan,
      'avatar_url',     v_family.avatar_url,
      'cover_url',      v_family.cover_url,
      'member_count',   v_member_count,
      'max_members',    5,
      'owner', jsonb_build_object(
        'nickname',   v_owner.nickname,
        'avatar_url', v_owner.avatar_url
      ),
      'member_avatars', v_avatars
    )
  );
end;
$$;

revoke execute on function public.preview_family_by_code(text) from public;
grant execute on function public.preview_family_by_code(text) to authenticated;
