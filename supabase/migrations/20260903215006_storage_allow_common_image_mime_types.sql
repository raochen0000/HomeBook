-- Storage · allow the image formats supported by the Cloud configuration
-- ---------------------------------------------------------------------------
-- 0049 establishes a 2 MB limit and a JPEG-only baseline. This migration keeps
-- the repository aligned with the verified Cloud configuration while retaining
-- an explicit allow-list instead of permitting every image/* MIME type.

do $$
declare
  expected_bucket_count constant integer := 4;
  actual_bucket_count integer;
begin
  select count(*)
    into actual_bucket_count
  from storage.buckets
  where id in (
    'homebook-user-avatars',
    'homebook-family-covers',
    'homebook-family-background',
    'homebook-feedback-images'
  );

  if actual_bucket_count <> expected_bucket_count then
    raise exception
      'Expected % HomeBook storage buckets, found %',
      expected_bucket_count,
      actual_bucket_count;
  end if;

  update storage.buckets
  set allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'image/gif'
  ]::text[]
  where id in (
    'homebook-user-avatars',
    'homebook-family-covers',
    'homebook-family-background',
    'homebook-feedback-images'
  );
end;
$$;
