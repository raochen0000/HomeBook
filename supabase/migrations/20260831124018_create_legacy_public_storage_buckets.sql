-- 0044 · 将历史 Studio 手工创建的公开媒体 bucket 纳入版本化 migration
-- -----------------------------------------------------------------------------
-- 0020/0022 已定义这两个 bucket 的 storage.objects policy，但旧阿里云环境中 bucket
-- 是通过 Studio 手工创建的，导致干净项目重放仓库 migration 后缺少对象存储容器。
-- 路径 A 以仓库为唯一重建来源：此 migration 保证 Cloud 从零重建时能得到一致的公开 bucket。
-- 现有对象 policy 不在这里重建，仍由先前 migration 管理。

insert into storage.buckets (id, name, public)
values
  ('homebook-user-avatars', 'homebook-user-avatars', true),
  ('homebook-family-covers', 'homebook-family-covers', true)
on conflict (id) do update
  set name = excluded.name,
      public = excluded.public;
