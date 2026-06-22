-- 0018 · 邀请码改为 6 位（排除易混 0/O/1/I），对齐 PRD §5.4
-- ----------------------------------------------------------------------------
-- 原 0011/0015 的 create_invitation 生成 8 位十六进制码；PRD 要求 6 位、大写
-- A–Z + 0–9 且排除易混的 0/O/1/I（便于口述 / 手抄 / 3+3 分段展示）。
-- 本迁移只改「生成码」的字符集与长度，其余逻辑（仅户主、满 8 拦截、24h 有效、
-- 复用未过期有效码、强制刷新作废重生）完全保持不变。
--
-- 字母表 = A–Z 去掉 O/I（24）+ 2–9（8）= 32 字符。6 位 → 32^6 ≈ 1.07e9，冲突重试。
-- 注：邀请码非安全敏感（24h 失效 + 防枚举限频另议），random() 足够。

create or replace function public.create_invitation(p_force_new boolean default false)
returns public.invitations
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_family   uuid;
  v_alpha    text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- 32 字符，排除 0 O 1 I
  v_code     text;
  v_inv      public.invitations;
  v_attempts int := 0;
  i          int;
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

  -- 家庭已满则无需邀请
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

  -- 生成 6 位安全字母表码；唯一冲突重试
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
