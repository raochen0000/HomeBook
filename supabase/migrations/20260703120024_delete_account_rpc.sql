-- 0024 · delete_account RPC —— 账号注销（软注销 / 匿名化墓碑 + 断开登录身份）
-- ----------------------------------------------------------------------------
-- 数据库端口被防火墙拦截，请在 Supabase Studio → SQL Editor 执行本文件（不要走 psql/CLI）。
--
-- 语义（产品定稿）：注销后
--   · 家庭流水等共享数据「保留」，原家庭成员仍可见（transactions RLS 按家庭成员判定，与记录人无关）；
--   · 注销者从成员名单「消失」（membership → left）；
--   · 登录身份「永久删除」：手机号/邮箱/密码清空、第三方身份与会话删除、账号封禁 → 无法再登录。
--
-- 为什么不能硬删 auth.users：profiles.id → auth.users ON DELETE CASCADE，而
-- transactions.recorder_user_id → profiles(id) 为 NO ACTION，只要记过账，级联删 profiles 会被
-- 流水外键挡住、整个删除失败。故 profiles 行「永久保留为匿名墓碑」，承载流水外键与展示回退。

-- ── delete_account：本人注销自己的账号 ───────────────────────────────────────
-- SECURITY DEFINER（postgres 属主）：绕过 RLS 完成多表事务，并可直接操作 auth.*。
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_mem   public.memberships;
  v_multi boolean;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  -- 当前 active 成员关系（单人无家庭时可能没有）
  select * into v_mem from public.memberships
    where user_id = v_uid and status = 'active';

  if found then
    if v_mem.role = 'owner' then
      select count(*) > 1 into v_multi from public.memberships
        where family_id = v_mem.family_id and status = 'active';
      if v_multi then
        -- 多人家庭户主不能直接注销：沿用生命周期红线，先转让或解散
        raise exception '你是家庭户主，请先转让户主或解散家庭后再注销'
          using errcode = '42501';
      end if;
      -- 单人家庭户主：顺带解散家庭（作废邀请码 + 标记 dissolved），无第二人会看这些数据
      update public.invitations set status = 'revoked'
        where family_id = v_mem.family_id and status = 'valid';
      update public.families set status = 'dissolved', member_count = 0
        where id = v_mem.family_id;
    else
      -- 多人家庭普通成员：退出即可，流水留在家庭供其他成员查看
      update public.families set member_count = greatest(member_count - 1, 0)
        where id = v_mem.family_id;
    end if;

    update public.memberships set status = 'left', left_at = now()
      where id = v_mem.id;
  end if;

  -- 匿名化 profile 墓碑：保留行（供流水 recorder_user_id 外键与展示回退），清空 PII
  update public.profiles
     set nickname          = '已注销用户',
         avatar_url        = null,
         current_family_id = null,
         status            = 'deactivated',
         updated_at        = now()
   where id = v_uid;

  -- 断开登录身份（definer=postgres 身份直接操作 auth.*）
  delete from auth.identities where user_id = v_uid;   -- 解绑 Apple 等第三方
  delete from auth.sessions   where user_id = v_uid;   -- refresh_tokens 级联，现有登录立即失效
  -- 清空凭据 + 封禁：手机号/邮箱释放可再注册；即使某版本无 banned_until，清空凭据+删身份亦无从登录
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

-- 收紧 EXECUTE 授权：撤销 PUBLIC，仅授予 authenticated
revoke execute on function public.delete_account() from public;
grant  execute on function public.delete_account() to authenticated;

-- ── 墓碑 profile 可见性 ───────────────────────────────────────────────────────
-- 注销后 membership 变 left，private.shares_family 对旧家人返回 false，原 profiles_select
-- 便读不到墓碑行 → 首页流水记录人一栏会走空。墓碑已完全匿名（nickname='已注销用户'、无头像、
-- 无 PII），故额外放开：任何登录用户可读 status='deactivated' 的 profile，保证流水展示完整。
drop policy if exists "profiles_select_deactivated" on public.profiles;
create policy "profiles_select_deactivated" on public.profiles
  for select to authenticated
  using (status = 'deactivated');
