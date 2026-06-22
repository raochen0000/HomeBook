-- 0017 · preview_family_by_code RPC（流程 4「加入家庭」预览卡 + 加入影响）
-- ----------------------------------------------------------------------------
-- 对应 PRD §6「流程 4：加入家庭」：满 6 位码 → 先拉家庭预览卡 + 加入影响提示，
-- 用户确认后才调 join_family_by_code（0015）真正加入。本函数为**只读**（stable），
-- 不改邀请码 status、不写任何表，纯校验 + 取预览，避免「预览即副作用」。
--
-- 隐私折中档（PRD §6.4）：户主显昵称+头像；其他成员仅返回头像（堆叠），不含昵称。
-- 跨家庭读取目标家庭信息（调用者尚非其成员）→ security definer 绕 RLS，仅暴露受控字段。
--
-- 前置：families 历史上无 cover_url 列（0002 core_tables 未含；types 里的 cover_url 属
-- savings_goals）。预览卡需展示家庭封面，故此处幂等补列，供本 RPC 与家庭设置页共用。

alter table public.families add column if not exists cover_url text;

-- ── 返回契约（jsonb）─────────────────────────────────────────────────────────
-- { "status": "ok" | "invalid" | "expired" | "full" | "already_member",
--   "impact": "none" | "delete_origin" | "auto_leave" | "blocked_owner",   -- 仅 status=ok
--   "family": {                                                            -- status=ok / already_member
--     "id", "name", "cover_url", "member_count", "max_members",
--     "owner": { "nickname", "avatar_url" },
--     "member_avatars": ["url", ...]                                       -- 最多 8，按入家先后
--   }
-- }
--   impact 语义（PRD §6.3 四分支）：
--     none          调用者无家庭 / 单人无记账     → 直接加入
--     delete_origin 单人家庭且有记账             → ⚠ 加入后原家庭+数据删除，需二次确认
--     auto_leave    多人家庭普通成员             → ⚠ 加入后自动退出当前家庭
--     blocked_owner 多人家庭户主                 → ⛔ 禁用加入，先转让/解散
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

  -- 1) 邀请码校验（只读：过期/作废仅报告，不落库）
  select * into v_inv from public.invitations where code = upper(trim(p_code));
  if not found or v_inv.status = 'revoked' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_inv.status = 'expired' or v_inv.expires_at < now() then
    return jsonb_build_object('status', 'expired');
  end if;

  -- 2) 目标家庭 + 户主
  select * into v_family from public.families where id = v_inv.family_id;
  if not found or v_family.status <> 'active' then
    return jsonb_build_object('status', 'invalid');
  end if;
  select * into v_owner from public.profiles where id = v_family.owner_user_id;

  -- 3) 已是该家庭 active 成员？
  if exists (
    select 1 from public.memberships
    where family_id = v_family.id and user_id = v_uid and status = 'active'
  ) then
    return jsonb_build_object(
      'status', 'already_member',
      'family', jsonb_build_object('id', v_family.id, 'name', v_family.name)
    );
  end if;

  -- 4) 成员数 + 头像堆叠（满 8 则拦截）
  select count(*) into v_member_count from public.memberships
    where family_id = v_family.id and status = 'active';
  if v_member_count >= 8 then
    return jsonb_build_object('status', 'full');
  end if;

  select coalesce(jsonb_agg(a.avatar_url), '[]'::jsonb) into v_avatars
  from (
    select p.avatar_url
    from public.memberships m
    join public.profiles p on p.id = m.user_id
    where m.family_id = v_family.id and m.status = 'active'
    order by m.joined_at
    limit 8
  ) a;

  -- 5) 调用者加入影响（PRD §6.3 四分支）
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
      -- 单人家庭：有任一未删除流水即视为「有记账」
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
      'max_members',   8,
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
