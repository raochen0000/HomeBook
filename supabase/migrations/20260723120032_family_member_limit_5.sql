-- 0032 · 家庭成员上限调整为 5 人
--
-- 与产品限制同步：家庭成员最多 5 人（含户主）。本迁移重写数据库兜底触发器、
-- 邀请/加入 RPC 和加入预览 RPC，避免前端显示 5 但服务端仍允许到 8。

alter table public.families drop constraint if exists families_member_count_check;
alter table public.families
  add constraint families_member_count_check
  check (status = 'dissolved' or member_count between 1 and 5) not valid;

create or replace function public.enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if new.status = 'active' then
    select count(*) into v_count
      from public.memberships
     where family_id = new.family_id
       and status = 'active'
       and (tg_op = 'INSERT' or id <> new.id);

    if v_count >= 5 then
      raise exception '家庭成员已达上限（5 人）';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists memberships_member_limit on public.memberships;
create trigger memberships_member_limit
  before insert or update of family_id, status on public.memberships
  for each row execute function public.enforce_member_limit();

create or replace function public.join_family_by_code(p_code text)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_inv    public.invitations;
  v_family public.families;
  v_count  int;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if exists (select 1 from public.memberships
             where user_id = v_uid and status = 'active') then
    raise exception '当前用户已属于某个家庭';
  end if;

  select * into v_inv from public.invitations
    where code = p_code and status = 'valid' for update;
  if not found then
    raise exception '邀请码无效';
  end if;
  if v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception '邀请码已过期';
  end if;

  select count(*) into v_count from public.memberships
    where family_id = v_inv.family_id and status = 'active';
  if v_count >= 5 then
    raise exception '家庭成员已达上限（5 人）';
  end if;

  insert into public.memberships (family_id, user_id, role, status, joined_at, left_at)
    values (v_inv.family_id, v_uid, 'member', 'active', now(), null)
  on conflict (family_id, user_id) do update
    set role      = 'member',
        status    = 'active',
        joined_at = now(),
        left_at   = null;

  update public.families set member_count = member_count + 1
    where id = v_inv.family_id
    returning * into v_family;

  update public.profiles set current_family_id = v_inv.family_id where id = v_uid;

  return v_family;
end;
$$;

revoke execute on function public.join_family_by_code(text) from public;
grant  execute on function public.join_family_by_code(text) to authenticated;

create or replace function public.create_invitation(p_force_new boolean default false)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_family   uuid;
  v_alpha    text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_inv      public.invitations;
  v_attempts int := 0;
  i          int;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  select family_id into v_family from public.memberships
    where user_id = v_uid and role = 'owner' and status = 'active';
  if v_family is null then
    raise exception '仅户主可生成邀请码' using errcode = '42501';
  end if;

  if (select member_count from public.families where id = v_family) >= 5 then
    raise exception '家庭成员已达上限（5 人），需先移除成员';
  end if;

  if not p_force_new then
    select * into v_inv from public.invitations
      where family_id = v_family and status = 'valid' and expires_at > now()
      order by expires_at desc limit 1;
    if found then
      return v_inv;
    end if;
  end if;

  update public.invitations set status = 'revoked'
    where family_id = v_family and status = 'valid';

  loop
    v_attempts := v_attempts + 1;
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    begin
      insert into public.invitations (family_id, code, expires_at, status)
        values (v_family, v_code, now() + interval '24 hours', 'valid')
        returning * into v_inv;
      return v_inv;
    exception when unique_violation then
      if v_attempts >= 8 then raise; end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.create_invitation(boolean) from public;
grant execute on function public.create_invitation(boolean) to authenticated;

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
      'id',            v_family.id,
      'name',          v_family.name,
      'cover_url',     v_family.cover_url,
      'member_count',  v_member_count,
      'max_members',   5,
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
grant  execute on function public.preview_family_by_code(text) to authenticated;
