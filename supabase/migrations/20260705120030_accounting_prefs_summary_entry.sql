-- 0030 · 记账偏好补列：首页月度总结横幅入口开关（PRD §18.3.1 / DATAMODEL §5.8）
-- ----------------------------------------------------------------------------
-- 数据库端口被防火墙拦截，请在 Supabase Studio → SQL Editor 执行本文件（不要走 psql/CLI）。
--
-- 0028 的 accounting_preferences 已应用，故此处以 ALTER 增列（幂等 if not exists）。
-- 语义：控制首页 Hero 卡下方「上月总结来啦」月度总结入口横幅的显隐；默认开（保持既有行为）。

alter table public.accounting_preferences
  add column if not exists show_monthly_summary_entry boolean not null default true;
