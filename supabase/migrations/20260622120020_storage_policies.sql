-- 0020 · Storage 对象权限策略（头像 / 家庭封面）
-- ----------------------------------------------------------------------------
-- 背景：两个 public 桶已在 Studio 手动创建：
--   homebook-user-avatars   用户头像，路径 {用户id}/avatar.ext
--   homebook-family-covers  家庭封面，路径 {家庭id}/cover.ext
-- public 桶的「读」走公开 CDN 端点（/object/public/...），绕过 RLS，无需 select 策略；
-- 但「写 / 删」仍受 storage.objects 的 RLS 管控，故此处只配 insert/update/delete。
--
-- 隔离思路（与 0008 一致）：
--   ① auth.uid() 一律包 (select auth.uid())。
--   ② 一律 TO authenticated（anon 不授权写）。
--   ③ 路径第一层文件夹 = 归属 id —— (storage.foldername(name))[1]。
--   ④ 头像：第一层 = 本人 uid；封面：第一层家庭须由当前用户任户主，复用 private.is_family_owner。
--
-- 注：storage.objects 默认已启用 RLS，此处不重复 alter（需表 owner 权限）。
-- 注：所有策略先 drop if exists 再 create，便于 Studio 重复粘贴执行（幂等）。

-- ── 用户头像：只能写自己 uid 文件夹下的对象 ───────────────────────────────────
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homebook-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'homebook-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'homebook-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'homebook-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ── 家庭封面：仅该家庭户主可写（第一层文件夹 = family_id）──────────────────────
drop policy if exists "covers_insert_owner" on storage.objects;
create policy "covers_insert_owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "covers_update_owner" on storage.objects;
create policy "covers_update_owner" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "covers_delete_owner" on storage.objects;
create policy "covers_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner(((storage.foldername(name))[1])::uuid)
  );
