-- 0031 · 家庭头像与封面分离
--
-- 背景：families.cover_url 一直被当「家庭头像」（方块小图）在用，但按 PRD §3.5
-- 「封面」应是家庭页 hero 背景 + 加入家庭预览卡的大图，两个概念被混用了。
--
-- 方案：cover_url 归位为「家庭封面」（大图）；新增 avatar_url 存「家庭头像」。
-- 存量数据：现有 cover_url 里的图是按头像上传的（方形裁 512），整体搬到 avatar_url，
-- cover_url 清空（封面从未真正存在过，回落品牌蓝渐变 / 预览卡兜底底色）。
--
-- Storage 不需要新策略：0022 的写策略用 split_part(name,'.',1)::uuid 取家庭 id，
-- 新封面路径约定为 {familyId}.cover.jpg —— 首段仍是家庭 id，天然通过校验；
-- 头像沿用旧路径 {familyId}.jpg（存量公开 URL 不失效）。

alter table public.families add column if not exists avatar_url text;

comment on column public.families.avatar_url is '家庭头像（方块小图）公开 URL；封面大图见 cover_url';
comment on column public.families.cover_url is '家庭封面（hero 背景 / 加入预览卡大图）公开 URL；头像见 avatar_url';

-- 存量迁移：把「其实是头像」的 cover_url 搬到 avatar_url，cover_url 清空
update public.families
   set avatar_url = cover_url,
       cover_url  = null
 where cover_url is not null
   and avatar_url is null;
