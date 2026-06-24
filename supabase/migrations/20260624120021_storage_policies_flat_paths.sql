-- 0021 · Storage 写权限策略改为「桶根目录 + 文件名归属」（替换 0020 的文件夹方案）
-- ----------------------------------------------------------------------------
-- 背景：本自托管实例的 storage.prefixes 表开了 RLS，却归 supabase_storage_admin 独占、
--   postgres（含 Studio SQL Editor）无权加策略。路径一旦含子文件夹（{id}/avatar.jpg），
--   插入 storage.objects 时其 BEFORE INSERT 触发器会先向 prefixes 写目录前缀行，该步被
--   RLS 拒 → 整笔上传回滚，报 "new row violates row-level security policy"；且这步发生在
--   objects 策略被检查之前，无法用 objects 策略绕过。
-- 对策：上传改落桶根目录（{id}.jpg，见 src/adapters/storage.ts）。根对象 foldername 为空，
--   不触发 prefixes 写入，从根上规避该限制。相应地，本迁移把 objects 的归属判定从
--   「第一层文件夹」(storage.foldername(name))[1] 改为「文件名去扩展名」split_part(name,'.',1)，
--   即归属 id（uuid 不含点，故按首个 '.' 切分即得纯 id）。
-- 注：本迁移只动 storage.objects（postgres 可管），不碰 storage.prefixes，可在 Studio 直接执行。
-- 注：策略名沿用 0020，drop if exists 后 create，幂等替换旧定义（含 upsert 覆盖需要的 update）。

-- ── 用户头像：只能写文件名 = 本人 uid 的根对象 ────────────────────────────────
drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = (select auth.uid())::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = (select auth.uid())::text
  )
  with check (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = (select auth.uid())::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'homebook-user-avatars'
    and split_part(name, '.', 1) = (select auth.uid())::text
  );

-- ── 家庭封面：仅该家庭户主可写（文件名 = family_id）───────────────────────────
drop policy if exists "covers_insert_owner" on storage.objects;
create policy "covers_insert_owner" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner((split_part(name, '.', 1))::uuid)
  );

drop policy if exists "covers_update_owner" on storage.objects;
create policy "covers_update_owner" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner((split_part(name, '.', 1))::uuid)
  )
  with check (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner((split_part(name, '.', 1))::uuid)
  );

drop policy if exists "covers_delete_owner" on storage.objects;
create policy "covers_delete_owner" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'homebook-family-covers'
    and private.is_family_owner((split_part(name, '.', 1))::uuid)
  );
