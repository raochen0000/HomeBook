-- 0019 · 修复：解散家庭时 member_count=0 违反 families_member_count_check
-- ----------------------------------------------------------------------------
-- dissolve_family（0012）末句把家庭置 `status='dissolved', member_count=0`（已无成员），
-- 但 0002 的列级 check 要求 `member_count between 1 and 8`，导致解散整体回滚，报：
--   new row for relation "families" violates check constraint "families_member_count_check"
--
-- 修复：放宽约束——仅「active」家庭受 1–8 约束；已解散家庭允许 0。
-- 解散 RPC 在同一条 UPDATE 同时写 status='dissolved' 与 member_count=0，约束按行最终态校验，故通过。
-- leave_family / remove_member 仅在 ≥2 人时递减（单人户主须走解散/转让），不会触达 0，行为不变。

alter table public.families drop constraint if exists families_member_count_check;

alter table public.families
  add constraint families_member_count_check
  check (status = 'dissolved' or member_count between 1 and 8);
