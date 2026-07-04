-- 0025 · 意见反馈：feedback 表 + submit_feedback RPC + 反馈图片桶存储策略（PRD §18.3.7 / DATAMODEL §5.5）
-- ----------------------------------------------------------------------------
-- 数据库端口被防火墙拦截，请在 Supabase Studio → SQL Editor 执行本文件（不要走 psql/CLI）。
--
-- 语义（产品定稿）：MVP 单向提交——客户端只经 submit_feedback RPC 写入，不读回历史；
-- 运营侧经控制台 service_role 查看跟进。反馈始终关联提交者 user_id（服务端 auth.uid() 落定，
-- 客户端伪造不了）；contact_ok 仅表达「可否被账号回访」，不影响身份关联。

-- ── FEEDBACK（意见反馈）──────────────────────────────────────────────────────
create table public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  family_id   uuid references public.families(id) on delete set null,   -- 提交时家庭快照，可空
  type        text not null check (type in ('feature','bug','suggestion','other')),
  content     text not null check (char_length(btrim(content)) between 5 and 200),
  image_paths text[] not null default '{}'
                check (coalesce(array_length(image_paths, 1), 0) <= 5),  -- 反馈图片桶内对象路径，≤ 5
  contact_ok  boolean not null default true,
  device      jsonb not null default '{}',                              -- app_version/build/platform/os_version/device_model/brand/timezone
  status      text not null default 'open'
                check (status in ('open','in_progress','resolved','closed')),  -- 运营侧流转态，MVP 客户端不展示
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 防刷频率查询 + 运营侧按时间浏览
create index feedback_user_created_idx on public.feedback (user_id, created_at desc);
create index feedback_status_created_idx on public.feedback (status, created_at desc);

create trigger set_updated_at before update on public.feedback
  for each row execute function public.set_updated_at();

-- RLS 开启但「不建任何客户端策略」：写入只走下面的 SECURITY DEFINER RPC（属主 postgres 绕过 RLS），
-- 读取只走 service_role（控制台）。故 authenticated 直接 select/insert 一律被拒。
alter table public.feedback enable row level security;

-- ── submit_feedback：本人提交一条反馈（服务端集中校验 + 防刷）───────────────────
-- SECURITY DEFINER（postgres 属主）：绕过 RLS 落库，并从 auth.uid() 取真实提交者与当前家庭。
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

  -- 字段校验（与表 CHECK 双保险，且给出可读报错）
  if p_type is null or p_type not in ('feature','bug','suggestion','other') then
    raise exception '反馈类型不合法' using errcode = '22023';
  end if;
  if char_length(v_content) < 5 or char_length(v_content) > 200 then
    raise exception '问题描述需 5–200 字' using errcode = '22023';
  end if;
  if coalesce(array_length(p_image_paths, 1), 0) > 5 then
    raise exception '最多上传 5 张图片' using errcode = '22023';
  end if;

  -- 防刷：相邻两条最短间隔 30s
  if exists (
    select 1 from public.feedback
    where user_id = v_uid and created_at > now() - interval '30 seconds'
  ) then
    raise exception '提交过于频繁，请稍后再试' using errcode = '429';
  end if;
  -- 防刷：每人每日 ≤ 20 条
  select count(*) into v_recent from public.feedback
    where user_id = v_uid and created_at > now() - interval '1 day';
  if v_recent >= 20 then
    raise exception '今日反馈已达上限' using errcode = '429';
  end if;

  -- 当前家庭快照（单人无家庭时为 null）
  select current_family_id into v_family from public.profiles where id = v_uid;

  insert into public.feedback (user_id, family_id, type, content, image_paths, contact_ok, device)
  values (v_uid, v_family, p_type, v_content, coalesce(p_image_paths, '{}'), coalesce(p_contact_ok, true), coalesce(p_device, '{}'))
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.submit_feedback(text, text, text[], boolean, jsonb) from public;
grant  execute on function public.submit_feedback(text, text, text[], boolean, jsonb) to authenticated;

-- ── 反馈图片桶：homebook-feedback-images（public，与 0022 头像/封面同策略范式）──────
-- 建桶（幂等）。设为 public：本实例 storage 上下文取不到 auth.uid()，做不了「仅本人可读」的
-- 私有 RLS（见 0022）；MVP 用「公开桶 + 不可猜随机路径」，URL 公开但不可枚举。真·私有（仅
-- service_role 可读）需后续走 Edge Function 服务端代传，届时把本桶改私有并收紧写策略。
insert into storage.buckets (id, name, public)
values ('homebook-feedback-images', 'homebook-feedback-images', true)
on conflict (id) do nothing;

-- 清理可能的旧策略（幂等）
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('feedback_images_select','feedback_images_insert_own')
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- SELECT：放行上传时的 RETURNING 读（桶本就公开），TO public
create policy "feedback_images_select" on storage.objects
  for select to public
  using (bucket_id = 'homebook-feedback-images');

-- INSERT：文件名须以「上传者本人 uid + 下划线」开头（路径 {userId}_{uuid}.jpg，根目录避开 prefixes RLS）
create policy "feedback_images_insert_own" on storage.objects
  for insert to public
  with check (
    bucket_id = 'homebook-feedback-images'
    and starts_with(name, coalesce(owner::text, owner_id) || '_')
  );
