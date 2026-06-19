-- 0013 · 户主移除成员 RPC（PRD 流程 6）+ 关键通知（流程 13）
-- ----------------------------------------------------------------------------
-- SECURITY DEFINER：服务端完成多表事务，函数内自鉴权与归属校验。沿用 0012 生命周期 RPC 风格。
-- 移除 = 软删（status=removed）+ 解绑被移除者 current_family_id + 写 removed 通知。
-- 被移除者历史流水保留在家庭（DATAMODEL §3.3）；其新单人家庭由前台首次记账时自动创建
-- （与 leave_family 一致，不在此处建，避免重复逻辑）。

create or replace function public.remove_member(p_user_id uuid)
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
  if p_user_id = v_uid then
    raise exception '不能移除自己，请走退出或解散';
  end if;

  -- 调用者必须是 active 户主
  select m.family_id, f.name into v_family, v_name
    from public.memberships m
    join public.families f on f.id = m.family_id
    where m.user_id = v_uid and m.role = 'owner' and m.status = 'active';
  if v_family is null then
    raise exception '仅户主可移除成员' using errcode = '42501';
  end if;

  -- 目标必须是同家庭 active 成员
  if not exists (select 1 from public.memberships
                 where family_id = v_family and user_id = p_user_id and status = 'active') then
    raise exception '目标不是本家庭成员';
  end if;

  -- 软删除该成员、维护计数、解绑其当前家庭
  update public.memberships set status = 'removed', left_at = now()
    where family_id = v_family and user_id = p_user_id and status = 'active';
  update public.families set member_count = greatest(member_count - 1, 0)
    where id = v_family;
  update public.profiles set current_family_id = null where id = p_user_id;

  -- 通知被移除者（流程 13：被移出家庭）
  insert into public.notifications (user_id, type, channel, payload)
    values (p_user_id, 'removed', 'in_app',
            jsonb_build_object('reason', 'removed', 'family_name', v_name));
end;
$$;

-- 收紧 EXECUTE 授权：撤销 PUBLIC，仅授予 authenticated
revoke execute on function public.remove_member(uuid) from public;
grant execute on function public.remove_member(uuid) to authenticated;
