-- 0027 · 推送设备令牌：device_tokens 表 + register/unregister RPC（PRD §18.3.3 层级二 / DATAMODEL §5.7）
-- ----------------------------------------------------------------------------
-- 数据库端口被防火墙拦截，请在 Supabase Studio → SQL Editor 执行本文件（不要走 psql/CLI）。
--
-- 语义（产品定稿）：每台设备一行（token 主键）的推送令牌，供投递侧按 notification_preferences
-- 决定后向该用户的设备发系统推送。写（注册/注销）只走下面两个 SECURITY DEFINER RPC——避免
-- 「同设备换登录用户时认领他人 token 行」触发 RLS 死角（USING 用旧行 user_id 判定会挡住新用户）。
-- 客户端登录注册、登出/注销注销；投递侧以 service_role 读。令牌获取（getExpoPushTokenAsync / APNs）
-- 依赖付费 Apple Developer，故本表 + RPC 先建、客户端 PUSH_DELIVERY_ENABLED 开关灰度（默认关）。

-- ── DEVICE_TOKENS（推送设备令牌）──────────────────────────────────────────────
create table public.device_tokens (
  token       text primary key,                                              -- Expo push token 或 APNs device token（设备唯一）
  user_id     uuid not null references public.profiles(id) on delete cascade,-- 当前登录者（注销随账号级联）
  platform    text not null check (platform in ('ios','android')),
  provider    text not null default 'expo' check (provider in ('expo','apns')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index device_tokens_user_idx on public.device_tokens (user_id);

create trigger set_updated_at before update on public.device_tokens
  for each row execute function public.set_updated_at();

-- 表权限：本表建于 0008「grant ... on all tables」之后不被覆盖，仅显式补 SELECT（读策略要用）；
-- 写不授客户端权（走下面 SECURITY DEFINER RPC，以属主 postgres 身份落库）。
grant select on public.device_tokens to authenticated;

-- ── RLS：仅本人可读（便于客户端自查）；写只走 RPC，投递读走 service_role ──────────
alter table public.device_tokens enable row level security;

create policy "device_tokens_select_self" on public.device_tokens
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ── register_device_token：注册/更新本设备令牌（同设备换用户时改挂当前登录者）────────
create or replace function public.register_device_token(
  p_token    text,
  p_platform text,
  p_provider text default 'expo'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if p_token is null or btrim(p_token) = '' then
    raise exception 'token 不能为空' using errcode = '22023';
  end if;
  if p_platform not in ('ios','android') then
    raise exception 'platform 不合法' using errcode = '22023';
  end if;
  if coalesce(p_provider, 'expo') not in ('expo','apns') then
    raise exception 'provider 不合法' using errcode = '22023';
  end if;

  insert into public.device_tokens (token, user_id, platform, provider)
  values (btrim(p_token), v_uid, p_platform, coalesce(p_provider, 'expo'))
  on conflict (token) do update
    set user_id    = excluded.user_id,      -- 同设备换登录用户 → 改挂新用户
        platform   = excluded.platform,
        provider   = excluded.provider,
        updated_at = now();
end;
$$;

revoke execute on function public.register_device_token(text, text, text) from public;
grant  execute on function public.register_device_token(text, text, text) to authenticated;

-- ── unregister_device_token：登出/注销时注销本设备令牌（仅注销本人挂着的行）───────────
create or replace function public.unregister_device_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  delete from public.device_tokens
    where token = btrim(coalesce(p_token, '')) and user_id = v_uid;
end;
$$;

revoke execute on function public.unregister_device_token(text) from public;
grant  execute on function public.unregister_device_token(text) to authenticated;
