-- 离开当前家庭时冻结当时的昵称。
-- 自己退出、被户主移出、解散家庭、注销后自动退出，都把 profiles.nickname 抄到 memberships.nickname。
-- 注销仍会把 profile 改成「已注销用户」；家庭账本读的是这里冻结的名称，并在界面加上「（已退出）」。
-- delete_account 必须先把 membership 标为 left，再匿名化 profile。当前函数已是这个顺序，触发器才能抄到原名。

alter table public.memberships add column nickname text;

comment on column public.memberships.nickname is
  '离开当前家庭时冻结的昵称。active 时为空，展示用 profiles.nickname；left/removed 后家庭账本用此名称。';

update public.memberships as membership
   set nickname = profile.nickname
  from public.profiles as profile
 where profile.id = membership.user_id
   and membership.status in ('left', 'removed')
   and profile.nickname is not null
   and btrim(profile.nickname) <> '';

alter table public.memberships
  add constraint memberships_departed_nickname_check
  check (
    status = 'active'
    or (nickname is not null and btrim(nickname) <> '')
  );

create or replace function private.freeze_membership_nickname()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_nickname text;
begin
  if new.status = 'active' then
    new.nickname := null;
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'active'
     and new.status in ('left', 'removed') then
    select profile.nickname
      into v_nickname
      from public.profiles as profile
     where profile.id = new.user_id;
    new.nickname := nullif(btrim(coalesce(v_nickname, '')), '');
    if new.nickname is null then
      raise exception '离开家庭时缺少可保留的名称';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.freeze_membership_nickname() from public, anon, authenticated;

create trigger memberships_freeze_nickname
  before insert or update of status on public.memberships
  for each row execute function private.freeze_membership_nickname();
