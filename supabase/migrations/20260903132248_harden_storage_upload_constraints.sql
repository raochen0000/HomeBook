-- 0049 · 收紧 Storage 上传文件类型与体积
-- -----------------------------------------------------------------------------
-- 客户端所有头像、家庭图片与反馈截图均压缩为 JPEG；反馈图已在客户端限制为 2 MB。
-- 在 bucket 层重复约束，避免攻击者绕过客户端以 publishable key 上传任意 MIME 或超大文件。

do $$
declare
  v_bucket_count integer;
begin
  select count(*) into v_bucket_count
  from storage.buckets
  where id in (
    'homebook-user-avatars',
    'homebook-family-covers',
    'homebook-family-background',
    'homebook-feedback-images'
  );

  if v_bucket_count <> 4 then
    raise exception 'expected four HomeBook Storage buckets, found %', v_bucket_count;
  end if;

  update storage.buckets
  set file_size_limit = 2 * 1024 * 1024,
      allowed_mime_types = array['image/jpeg']::text[]
  where id in (
    'homebook-user-avatars',
    'homebook-family-covers',
    'homebook-family-background',
    'homebook-feedback-images'
  );
end;
$$;
