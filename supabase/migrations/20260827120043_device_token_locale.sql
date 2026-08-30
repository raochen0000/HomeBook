-- 0043 · 推送令牌携带界面语言，供系统推送按设备语言投递
-- ----------------------------------------------------------------------------
-- 语义：locale 为短码 zh | en，默认 zh（兼容旧行与旧客户端）。
-- 写仍只走 SECURITY DEFINER RPC。增加 p_locale 且带 default，旧三参数调用从 SQL 侧仍合法；
-- 先 drop 三参数函数，避免 PostgREST 命中不含 locale 的旧重载。

alter table public.device_tokens
  add column if not exists locale text not null default 'zh';

alter table public.device_tokens
  drop constraint if exists device_tokens_locale_check;

alter table public.device_tokens
  add constraint device_tokens_locale_check check (locale in ('zh', 'en'));

drop function if exists public.register_device_token(text, text, text);

create or replace function public.register_device_token(
  p_token    text,
  p_platform text,
  p_provider text default 'expo',
  p_locale   text default 'zh'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_locale text := case when p_locale in ('zh', 'en') then p_locale else 'zh' end;
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

  insert into public.device_tokens (token, user_id, platform, provider, locale)
  values (btrim(p_token), v_uid, p_platform, coalesce(p_provider, 'expo'), v_locale)
  on conflict (token) do update
    set user_id    = excluded.user_id,
        platform   = excluded.platform,
        provider   = excluded.provider,
        locale     = excluded.locale,
        updated_at = now();
end;
$$;

revoke execute on function public.register_device_token(text, text, text, text) from public;
grant  execute on function public.register_device_token(text, text, text, text) to authenticated;
