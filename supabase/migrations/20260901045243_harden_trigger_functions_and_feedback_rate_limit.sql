-- 0046 · 收紧内部触发器函数权限，并修复反馈限流异常码
-- -----------------------------------------------------------------------------
-- 这三个 SECURITY DEFINER 函数仅由数据库 trigger 调用，不是客户端 RPC。
-- PostgreSQL 默认向 PUBLIC 授予函数 EXECUTE，须显式撤销，避免被 Data API 调用。
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.enforce_member_limit() from public;
revoke execute on function public.enforce_goal_limit() from public;

-- 旧的非 SECURITY DEFINER trigger 函数同样固定 search_path，消除 role-mutable
-- search_path 风险；函数体中的外部引用均已使用 schema 限定，或为内建函数。
alter function public.set_updated_at() set search_path = '';
alter function public.prevent_family_id_change() set search_path = '';
alter function public.set_transaction_last_editor() set search_path = '';

-- PostgreSQL SQLSTATE 必须是 5 个字符；HTTP 状态码 429 不能直接作为 errcode。
-- 客户端展示原始中文提示，不依赖该 SQLSTATE 映射 HTTP 状态。
create or replace function public.submit_feedback(
  p_type        text,
  p_content     text,
  p_image_paths text[]  default '{}',
  p_contact_ok  boolean default true,
  p_device      jsonb   default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_content text := btrim(coalesce(p_content, ''));
  v_family  uuid;
  v_recent  int;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  if p_type is null or p_type not in ('feature', 'bug', 'suggestion', 'other') then
    raise exception '反馈类型不合法' using errcode = '22023';
  end if;
  if char_length(v_content) < 5 or char_length(v_content) > 200 then
    raise exception '问题描述需 5–200 字' using errcode = '22023';
  end if;
  if coalesce(array_length(p_image_paths, 1), 0) > 5 then
    raise exception '最多上传 5 张图片' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.feedback
    where user_id = v_uid
      and created_at > now() - interval '30 seconds'
  ) then
    raise exception '提交过于频繁，请稍后再试' using errcode = 'P0001';
  end if;

  select count(*)
  into v_recent
  from public.feedback
  where user_id = v_uid
    and created_at > now() - interval '1 day';

  if v_recent >= 20 then
    raise exception '今日反馈已达上限' using errcode = 'P0001';
  end if;

  select current_family_id
  into v_family
  from public.profiles
  where id = v_uid;

  insert into public.feedback (
    user_id,
    family_id,
    type,
    content,
    image_paths,
    contact_ok,
    device
  )
  values (
    v_uid,
    v_family,
    p_type,
    v_content,
    coalesce(p_image_paths, '{}'),
    coalesce(p_contact_ok, true),
    coalesce(p_device, '{}')
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.submit_feedback(text, text, text[], boolean, jsonb) from public;
grant execute on function public.submit_feedback(text, text, text[], boolean, jsonb) to authenticated;
