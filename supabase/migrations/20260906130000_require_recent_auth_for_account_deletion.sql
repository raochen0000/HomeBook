-- 0055 · 敏感账号操作：注销前必须使用刚完成重新认证的新 Cloud 会话
-- -----------------------------------------------------------------------------
-- 客户端在注销前以当前密码或 Apple 原生授权重新登录；GoTrue 为该动作创建新 session。
-- 这里直接从已验证 JWT 的 session_id 取 auth.sessions.created_at，而不是接受客户端时间戳。
-- 仅保护 delete_account：邮箱换绑和改密由 Cloud Auth 的 Secure email/password change 分别保护；
-- Apple 解绑仍由 GoTrue 的“至少两个 identity”约束与客户端重新授权共同保护。

create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid                uuid := (select auth.uid());
  v_session_id         uuid := nullif((select auth.jwt() ->> 'session_id'), '')::uuid;
  v_session_created_at timestamptz;
  v_mem                public.memberships;
  v_multi              boolean;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  select created_at
    into v_session_created_at
    from auth.sessions
   where id = v_session_id
     and user_id = v_uid;

  if v_session_created_at is null or v_session_created_at < now() - interval '10 minutes' then
    raise exception '请重新验证身份后再注销账号' using errcode = '28000';
  end if;

  -- 当前 active 成员关系（单人无家庭时可能没有）
  select * into v_mem from public.memberships
    where user_id = v_uid and status = 'active';

  if found then
    if v_mem.role = 'owner' then
      select count(*) > 1 into v_multi from public.memberships
        where family_id = v_mem.family_id and status = 'active';
      if v_multi then
        raise exception '你是家庭户主，请先转让户主或解散家庭后再注销'
          using errcode = '42501';
      end if;

      update public.invitations set status = 'revoked'
        where family_id = v_mem.family_id and status = 'valid';
      update public.families set status = 'dissolved', member_count = 0
        where id = v_mem.family_id;
    else
      update public.families set member_count = greatest(member_count - 1, 0)
        where id = v_mem.family_id;
    end if;

    update public.memberships set status = 'left', left_at = now()
      where id = v_mem.id;
  end if;

  -- 保留完全匿名的 profile 墓碑，以维持历史流水的外键和展示。
  update public.profiles
     set nickname          = '已注销用户',
         avatar_url        = null,
         current_family_id = null,
         status            = 'deactivated',
         updated_at        = now()
   where id = v_uid;

  delete from auth.identities where user_id = v_uid;
  delete from auth.sessions   where user_id = v_uid;
  update auth.users
     set phone              = null,
         phone_confirmed_at = null,
         email              = null,
         email_confirmed_at = null,
         encrypted_password = null,
         banned_until       = 'infinity',
         updated_at         = now()
   where id = v_uid;
end;
$$;
