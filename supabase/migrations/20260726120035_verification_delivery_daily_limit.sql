-- 0035 · 验证码每日发送上限
-- -----------------------------------------------------------------------------
-- 由 SMS / Email Send Hook 的服务端身份调用。按 auth.users 用户、发送渠道和中国
-- 自然日计数；UPSERT 的条件更新是原子的，因此并发请求也最多只能成功五次。

create table if not exists public.verification_delivery_daily_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('sms', 'email')),
  sent_on date not null,
  sent_count smallint not null default 0 check (sent_count between 0 and 5),
  primary key (user_id, channel, sent_on)
);

comment on table public.verification_delivery_daily_limits is
  '验证码成功下发前消耗的每日配额；每个用户每天短信、邮箱各最多 5 次。';

alter table public.verification_delivery_daily_limits enable row level security;

-- 返回 true 表示本次已占用一个名额，false 表示当天该渠道已满。只允许 FC 使用的
-- service_role 调用；不要把此 RPC 暴露给客户端，否则可伪造用户 ID 消耗他人额度。
create or replace function public.consume_verification_delivery_quota(
  p_user_id uuid,
  p_channel text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent_on date := timezone('Asia/Shanghai', now())::date;
  v_consumed boolean;
begin
  if p_user_id is null then
    raise exception 'verification delivery requires a user id' using errcode = '22023';
  end if;

  if p_channel not in ('sms', 'email') then
    raise exception 'unsupported verification delivery channel' using errcode = '22023';
  end if;

  insert into public.verification_delivery_daily_limits (user_id, channel, sent_on, sent_count)
  values (p_user_id, p_channel, v_sent_on, 1)
  on conflict (user_id, channel, sent_on) do update
    set sent_count = public.verification_delivery_daily_limits.sent_count + 1
    where public.verification_delivery_daily_limits.sent_count < 5
  returning true into v_consumed;

  return coalesce(v_consumed, false);
end;
$$;

revoke all on table public.verification_delivery_daily_limits from public, anon, authenticated;
revoke all on function public.consume_verification_delivery_quota(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_verification_delivery_quota(uuid, text) to service_role;
