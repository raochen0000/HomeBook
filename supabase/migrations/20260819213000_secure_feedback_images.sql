-- 0039 · 发布前收紧反馈截图访问控制
-- -----------------------------------------------------------------------------
-- 反馈截图可能包含账单、联系方式或设备信息；公开 bucket 会让持有 URL 的任何人读取对象。
-- 客户端只需上传并把路径交给 submit_feedback，读取仅供运营侧使用 service_role，故不需要
-- 客户端 SELECT 策略，也不应继续使用 public bucket。

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'homebook-feedback-images') then
    raise exception 'storage bucket homebook-feedback-images does not exist';
  end if;
end
$$;

update storage.buckets
set public = false
where id = 'homebook-feedback-images';

drop policy if exists "feedback_images_select" on storage.objects;
drop policy if exists "feedback_images_insert_own" on storage.objects;

-- 上传必须来自已登录用户；owner / owner_id 由 Storage 服务端根据 JWT 填入，客户端不能伪造。
create policy "feedback_images_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'homebook-feedback-images'
    and starts_with(name, coalesce(owner::text, owner_id) || '_')
  );
