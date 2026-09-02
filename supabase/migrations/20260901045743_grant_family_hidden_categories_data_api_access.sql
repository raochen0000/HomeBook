-- 0047 · 暴露家庭分类隐藏覆盖表所需的最小 Data API 权限
-- -----------------------------------------------------------------------------
-- RLS policy 已将行访问限制为所属家庭成员。Cloud 项目关闭“Automatically
-- expose new tables”后，仍须为实际客户端直连的表单独授予表级权限。
-- upsert 需要 SELECT + INSERT + UPDATE；客户端还支持取消隐藏，因此需要 DELETE。
grant select, insert, update, delete on table public.family_hidden_categories to authenticated;
