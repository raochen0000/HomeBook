-- 0022 · Storage 读写策略：SELECT 放行 + 写按 owner 列把关
-- ----------------------------------------------------------------------------
-- 背景（实测结论）：
--   1) storage 上传走 upsert：`insert ... on conflict do update ... returning *`。
--      ON CONFLICT 要读冲突行、RETURNING 要把行读回 —— 这两步都要求 objects 上有
--      一条 SELECT 策略。只建 insert/update 的"只写"策略，upsert 会因读不到而被 RLS
--      拒，报 "new row violates row-level security policy"。这是本项目反复踩的真正坑：
--      之前唯一能成的「全开」策略，胜在它顺手建了 SELECT，而非因为它 TO public。
--   2) storage 执行时角色就是 authenticated、JWT 声明也在，但本实例的 auth.uid() 在
--      storage 上下文里取不到 sub（GUC 名不一致），故不依赖 auth.uid()；改用 storage
--      服务端盖在 objects.owner / owner_id 列上的真实 uid（客户端伪造不了）来判归属。
--
-- 设计：
--   · 读：两个 public 桶本就走公开 CDN，这里的 SELECT 策略只为放行 upsert 的读，TO public。
--   · 写：TO public（角色判定无意义，已知是 authenticated），用 owner 列做归属。
--       头像 —— 文件名(去扩展名) = owner；封面 —— owner 须为该家庭 active 户主。
--   · 不开放客户端 DELETE（App 不需要；删除走控制台 service_role）。
--   · 归属 id 取 coalesce(owner::text, owner_id)；文件名取 split_part(name,'.',1)。
--   · 零信任需求请改走 Edge Function + service_role 服务端代传，再把写策略收紧为拒绝。

-- 户主判定：显式传入用户，不依赖 auth.uid()（与 0007 的 is_family_owner 同逻辑、入参不同）
create or replace function private.is_user_family_owner(_user uuid, _family uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.family_id = _family
      and m.user_id = _user
      and m.role = 'owner'
      and m.status = 'active'
  );
$$;
grant execute on function private.is_user_family_owner(uuid, uuid) to public;

-- ── 清理：0020/0021 的旧策略 + 排查期手动建的临时策略（幂等，drop if exists） ──
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and ( policyname in (
              'avatars_select','avatars_insert_own','avatars_update_own','avatars_delete_own',
              'covers_select','covers_insert_owner','covers_update_owner','covers_delete_owner',
              'avatars_insert_anon_TEST'
            )
            or policyname like 'full-access-policy%' )   -- UI 建的全开临时策略（带哈希后缀）
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

-- ── 用户头像 ─────────────────────────────────────────────────────────────────
-- SELECT：放行 upsert 的读（桶本就公开），TO public
create policy "avatars_select" on storage.objects
  for select to public
  using (bucket_id = 'homebook-user-avatars');

-- INSERT/UPDATE：文件名必须等于上传者本人（owner）
create policy "avatars_insert_own" on storage.objects
  for insert to public
  with check (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = coalesce(owner::text, owner_id)
  );

create policy "avatars_update_own" on storage.objects
  for update to public
  using (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = coalesce(owner::text, owner_id)
  )
  with check (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = coalesce(owner::text, owner_id)
  );

-- ── 家庭封面 ─────────────────────────────────────────────────────────────────
create policy "covers_select" on storage.objects
  for select to public
  using (bucket_id = 'homebook-family-covers');

-- 写：上传者须为该家庭的 active 户主
create policy "covers_insert_owner" on storage.objects
  for insert to public
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_user_family_owner(
          coalesce(owner::text, owner_id)::uuid,
          (split_part(name, '.', 1))::uuid)
  );

create policy "covers_update_owner" on storage.objects
  for update to public
  using (
    bucket_id = 'homebook-family-covers'
    and private.is_user_family_owner(
          coalesce(owner::text, owner_id)::uuid,
          (split_part(name, '.', 1))::uuid)
  )
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_user_family_owner(
          coalesce(owner::text, owner_id)::uuid,
          (split_part(name, '.', 1))::uuid)
  );
