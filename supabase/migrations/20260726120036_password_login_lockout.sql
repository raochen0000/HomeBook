-- 0036 · 邮箱密码登录失败锁定
-- -----------------------------------------------------------------------------
-- GoTrue 在校验出密码是否正确后、签发 session 前调用 password verification hook。
-- 因此计数与拦截都在服务端完成，不能通过直接调用 Auth API 或更换客户端绕过。
-- 连续五次错误即锁定 24 小时；锁定期结束后的下一次尝试会原子地清零并自动恢复。

create table public.password_login_attempts (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  failed_attempts smallint not null default 0 check (failed_attempts between 0 and 5),
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table public.password_login_attempts is
  '仅由 GoTrue password verification hook 使用的邮箱密码登录失败次数与锁定期限。';

alter table public.password_login_attempts enable row level security;

-- Hook 不使用 SECURITY DEFINER：严格仅授予 GoTrue 实际连接角色表和函数权限。
create policy "password_login_attempts_auth_admin" on public.password_login_attempts
  for all to supabase_auth_admin
  using (true)
  with check (true);

revoke all on table public.password_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on table public.password_login_attempts to supabase_auth_admin;

create or replace function public.password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_valid boolean;
  v_failed_attempts smallint;
  v_locked_until timestamptz;
begin
  v_user_id := (event->>'user_id')::uuid;
  v_valid := coalesce((event->>'valid')::boolean, false);

  -- 先确保该账户有一行，再锁行读取；并发请求不能绕过五次阈值。
  loop
    select failed_attempts, locked_until
      into v_failed_attempts, v_locked_until
      from public.password_login_attempts
     where user_id = v_user_id
       for update;
    exit when found;

    insert into public.password_login_attempts (user_id)
    values (v_user_id)
    on conflict (user_id) do nothing;
  end loop;

  -- 锁定未过期时，无论这次密码是否正确都不允许登录。
  if v_locked_until is not null and v_locked_until > now() then
    return jsonb_build_object(
      'decision', 'reject',
      'message', '密码错误次数过多，账号已锁定，请于 24 小时后再试',
      'should_logout_user', false
    );
  end if;

  -- 到期即在本次请求内清除锁定状态：无需定时任务，下一次登录自然恢复。
  if v_locked_until is not null then
    v_failed_attempts := 0;
    update public.password_login_attempts
       set failed_attempts = 0,
           locked_until = null,
           updated_at = now()
     where user_id = v_user_id;
  end if;

  -- 正确密码清除历史失败记录；同一账号之后重新从零计数。
  if v_valid then
    delete from public.password_login_attempts where user_id = v_user_id;
    return jsonb_build_object('decision', 'continue');
  end if;

  v_failed_attempts := v_failed_attempts + 1;
  if v_failed_attempts >= 5 then
    update public.password_login_attempts
       set failed_attempts = 5,
           locked_until = now() + interval '24 hours',
           updated_at = now()
     where user_id = v_user_id;

    -- 第五次错误本身就拒绝，并阻止 GoTrue 创建会话。
    return jsonb_build_object(
      'decision', 'reject',
      'message', '密码错误次数过多，账号已锁定，请于 24 小时后再试',
      'should_logout_user', false
    );
  end if;

  update public.password_login_attempts
     set failed_attempts = v_failed_attempts,
         updated_at = now()
   where user_id = v_user_id;

  return jsonb_build_object('decision', 'continue');
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.password_verification_attempt(jsonb) to supabase_auth_admin;
revoke execute on function public.password_verification_attempt(jsonb) from public, anon, authenticated;
