-- 0033 · 家庭背景图独立桶
--
-- homebook-family-covers 历史上同时承载家庭头像与家庭 hero 背景，命名容易混淆。
-- 之后 family.cover_url 对应的背景图统一上传到 homebook-family-background；
-- family.avatar_url 对应的家庭头像暂保留在 homebook-family-covers，以免存量头像 URL 失效。

insert into storage.buckets (id, name, public)
values ('homebook-family-background', 'homebook-family-background', true)
on conflict (id) do update set public = true;

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'family_background_select',
        'family_background_insert_owner',
        'family_background_update_owner'
      )
  loop
    execute format('drop policy %I on storage.objects', r.policyname);
  end loop;
end $$;

create policy "family_background_select" on storage.objects
  for select to public
  using (bucket_id = 'homebook-family-background');

create policy "family_background_insert_owner" on storage.objects
  for insert to public
  with check (
    bucket_id = 'homebook-family-background'
    and private.is_user_family_owner(
          coalesce(owner::text, owner_id)::uuid,
          (split_part(name, '.', 1))::uuid)
  );

create policy "family_background_update_owner" on storage.objects
  for update to public
  using (
    bucket_id = 'homebook-family-background'
    and private.is_user_family_owner(
          coalesce(owner::text, owner_id)::uuid,
          (split_part(name, '.', 1))::uuid)
  )
  with check (
    bucket_id = 'homebook-family-background'
    and private.is_user_family_owner(
          coalesce(owner::text, owner_id)::uuid,
          (split_part(name, '.', 1))::uuid)
  );
