-- 0011 · create_invitation RPC（户主生成邀请码）
-- ----------------------------------------------------------------------------
-- 对应 PRD §5「流程 3：户主邀请家人加入」：
--   * 仅户主可生成（前置条件 5.2）
--   * 家庭满 8 人则拦截（异常 5.5「家庭人数已满」）
--   * 24h 有效期；不限次数，户主可随时刷新
--   * 打开邀请页复用当前有效码；显式刷新（p_force_new=true）则作废旧码再生成新码（流程图 L「作废旧码 重新生成」）
-- 与 join_family_by_code（0009）配套，闭合邀请→加入链路。

create or replace function public.create_invitation(p_force_new boolean default false)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_family   uuid;
  v_code     text;
  v_inv      public.invitations;
  v_attempts int := 0;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  -- 仅户主（active owner）可生成
  select family_id into v_family from public.memberships
    where user_id = v_uid and role = 'owner' and status = 'active';
  if v_family is null then
    raise exception '仅户主可生成邀请码' using errcode = '42501';
  end if;

  -- 家庭已满则无需邀请（PRD 异常 5.5）
  if (select member_count from public.families where id = v_family) >= 8 then
    raise exception '家庭成员已达上限（8 人），需先移除成员';
  end if;

  -- 非强制刷新：复用当前未过期的有效码（打开邀请页场景）
  if not p_force_new then
    select * into v_inv from public.invitations
      where family_id = v_family and status = 'valid' and expires_at > now()
      order by expires_at desc limit 1;
    if found then
      return v_inv;
    end if;
  end if;

  -- 刷新或无有效码：作废家庭现有 valid 码，再生成新码
  update public.invitations set status = 'revoked'
    where family_id = v_family and status = 'valid';

  -- 生成 8 位大写十六进制码（取自随机 UUID，仅用核心函数，无 pgcrypto 依赖）；冲突重试
  loop
    v_attempts := v_attempts + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    begin
      insert into public.invitations (family_id, code, expires_at, status)
        values (v_family, v_code, now() + interval '24 hours', 'valid')
        returning * into v_inv;
      return v_inv;
    exception when unique_violation then
      if v_attempts >= 5 then raise; end if;
    end;
  end loop;
end;
$$;

revoke execute on function public.create_invitation(boolean) from public;
grant execute on function public.create_invitation(boolean) to authenticated;
