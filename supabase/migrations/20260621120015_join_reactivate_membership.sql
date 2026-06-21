-- 0015 · 修复：退出/被移除后用同一邀请码重新加入会撞唯一约束
-- ----------------------------------------------------------------------------
-- memberships 上有全表唯一约束 unique (family_id, user_id)（约束名
-- memberships_family_id_user_id_key），不区分 status。leave_family / remove_member
-- 均为软删除（保留行，status 置 'left' / 'removed'），因此再次加入同一家庭时，
-- 0009 版 join_family_by_code 直接 INSERT 会与历史行冲突，报
-- 「duplicate key value violates unique constraint "memberships_family_id_user_id_key"」。
--
-- 修复：改用 INSERT ... ON CONFLICT (family_id, user_id) DO UPDATE，命中历史行时
-- 复活为 active（重置 role/joined_at，清空 left_at），而非新增行。
-- 仅当当前无 active 行才会走到这里（前置校验保证），故复活后仍满足
-- memberships_one_active_per_user 部分唯一索引。成员上限由前置计数 + 0006
-- BEFORE INSERT 触发器（on-conflict 的 insert 尝试阶段仍会触发）双重兜底。

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

  -- 成员上限（同时由 0006 触发器兜底）
  select count(*) into v_count from public.memberships
    where family_id = v_inv.family_id and status = 'active';
  if v_count >= 8 then
    raise exception '家庭成员已达上限（8 人）';
  end if;

  -- 复活历史成员行（曾退出/被移除），否则新增；避免与 unique(family_id,user_id) 冲突
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

-- 重新收紧 EXECUTE 授权（create or replace 不改授权，此处幂等重申）
revoke execute on function public.join_family_by_code(text) from public;
grant  execute on function public.join_family_by_code(text) to authenticated;
