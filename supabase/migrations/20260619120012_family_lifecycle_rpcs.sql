-- 0012 · 家庭生命周期 RPC（PRD 流程 5：转让 / 退出 / 解散）+ 关键通知（流程 13）
-- ----------------------------------------------------------------------------
-- 均 SECURITY DEFINER：绕过 RLS 在服务端完成多表事务，函数内自行鉴权与归属校验。
-- member_count 手动维护（与 0009 一致，无计数触发器）。
-- 这些流转「必须在线」（不进离线队列，TECH §6.5）。

-- ── transfer_ownership：户主把户主身份转让给本家庭某成员 ──────────────────────
create or replace function public.transfer_ownership(p_new_owner uuid)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_family uuid;
  v_fam    public.families;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if p_new_owner = v_uid then
    raise exception '不能转让给自己';
  end if;

  -- 调用者必须是 active 户主
  select family_id into v_family from public.memberships
    where user_id = v_uid and role = 'owner' and status = 'active';
  if v_family is null then
    raise exception '仅户主可转让' using errcode = '42501';
  end if;

  -- 目标必须是同家庭 active 成员
  if not exists (select 1 from public.memberships
                 where family_id = v_family and user_id = p_new_owner and status = 'active') then
    raise exception '目标不是本家庭成员';
  end if;

  -- 先降原户主、再升新户主（避免「户主唯一」部分索引瞬时冲突）
  update public.memberships set role = 'member'
    where family_id = v_family and user_id = v_uid and status = 'active';
  update public.memberships set role = 'owner'
    where family_id = v_family and user_id = p_new_owner and status = 'active';

  update public.families set owner_user_id = p_new_owner
    where id = v_family
    returning * into v_fam;

  -- 通知新户主（流程 13）
  insert into public.notifications (user_id, type, channel, payload)
    values (p_new_owner, 'transfer', 'in_app',
            jsonb_build_object('family_id', v_family, 'family_name', v_fam.name));

  return v_fam;
end;
$$;

-- ── leave_family：普通成员退出（户主须先转让或解散）────────────────────────────
create or replace function public.leave_family()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_mem public.memberships;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  select * into v_mem from public.memberships
    where user_id = v_uid and status = 'active';
  if not found then
    raise exception '你当前不在任何家庭';
  end if;
  if v_mem.role = 'owner' then
    raise exception '户主需先转让户主或解散家庭';
  end if;

  update public.memberships set status = 'left', left_at = now()
    where id = v_mem.id;
  update public.families set member_count = greatest(member_count - 1, 0)
    where id = v_mem.family_id;
  update public.profiles set current_family_id = null where id = v_uid;
end;
$$;

-- ── dissolve_family：户主解散家庭（软解散 + 解绑成员 + 通知）────────────────────
-- DATAMODEL §7 要求最终物理清理家庭数据，可异步执行；此处先做软解散（标记 dissolved
-- + 解绑全部成员），解绑后 RLS（is_family_member）对所有人返回 false，数据即不可读。
create or replace function public.dissolve_family()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_family uuid;
  v_name   text;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  select m.family_id, f.name into v_family, v_name
    from public.memberships m
    join public.families f on f.id = m.family_id
    where m.user_id = v_uid and m.role = 'owner' and m.status = 'active';
  if v_family is null then
    raise exception '仅户主可解散家庭' using errcode = '42501';
  end if;

  -- 通知其他成员（流程 13：家庭已解散，按 removed 兜底 + payload 区分原因）
  insert into public.notifications (user_id, type, channel, payload)
    select m.user_id, 'removed', 'in_app',
           jsonb_build_object('reason', 'dissolved', 'family_name', v_name)
      from public.memberships m
     where m.family_id = v_family and m.status = 'active' and m.user_id <> v_uid;

  -- 解绑全部成员（含户主），并清空各自的 current_family_id
  update public.memberships set status = 'left', left_at = now()
    where family_id = v_family and status = 'active';
  update public.profiles set current_family_id = null
    where current_family_id = v_family;

  -- 作废未用邀请码，标记家庭解散
  update public.invitations set status = 'revoked'
    where family_id = v_family and status = 'valid';
  update public.families set status = 'dissolved', member_count = 0
    where id = v_family;
end;
$$;

-- 收紧 EXECUTE 授权：撤销 PUBLIC，仅授予 authenticated
revoke execute on function public.transfer_ownership(uuid) from public;
revoke execute on function public.leave_family()           from public;
revoke execute on function public.dissolve_family()        from public;

grant execute on function public.transfer_ownership(uuid) to authenticated;
grant execute on function public.leave_family()            to authenticated;
grant execute on function public.dissolve_family()         to authenticated;
