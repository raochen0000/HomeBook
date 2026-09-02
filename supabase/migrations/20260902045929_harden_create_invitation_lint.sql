-- 0048 · 消除 create_invitation 的 plpgsql lint 警告
-- ----------------------------------------------------------------------------
-- 保持 0032 的邀请语义不变：仅移除由整数 FOR 循环隐式声明的重复变量，
-- 并为静态分析补齐理论上不可达的失败出口。

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
      if v_attempts >= 8 then
        raise;
      end if;
    end;
  end loop;

  raise exception '邀请码生成失败，请重试' using errcode = 'P0001';
end;
$$;

revoke execute on function public.create_invitation(boolean) from public;
grant execute on function public.create_invitation(boolean) to authenticated;
