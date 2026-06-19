-- 0014 · 删除储蓄目标 RPC（PRD 流程 7：仅户主可删，已存余额回吐为收入流水）
-- ----------------------------------------------------------------------------
-- 资金守恒（PRD §9.6）：删除时若 saved_amount > 0，按「取出」口径生成一笔收入流水
-- （分类「储蓄·目标取出」，source=savings_withdraw）+ savings_entry，再标记目标 deleted。
-- 复用 0009 savings_withdraw 的记账口径，整体在一个事务内完成。

create or replace function public.delete_savings_goal(p_goal_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_goal   public.savings_goals;
  v_cat_id uuid;
  v_tx_id  uuid;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;

  select * into v_goal from public.savings_goals
    where id = p_goal_id and status = 'active' for update;
  if not found then
    raise exception '储蓄目标不存在或已删除';
  end if;

  -- 仅户主可删除（PRD §9.3）
  if not exists (select 1 from public.memberships
                 where family_id = v_goal.family_id and user_id = v_uid
                   and role = 'owner' and status = 'active') then
    raise exception '仅户主可删除储蓄目标' using errcode = '42501';
  end if;

  -- 已存余额回吐为收入流水（资金守恒）
  if v_goal.saved_amount > 0 then
    select id into v_cat_id from public.categories
      where is_system and family_id is null and name = '储蓄·目标取出' limit 1;

    insert into public.transactions
      (family_id, type, amount, category_id, note, recorder_user_id, source, savings_goal_id)
      values (v_goal.family_id, 'income', v_goal.saved_amount, v_cat_id, '删除目标回吐余额',
              v_uid, 'savings_withdraw', p_goal_id)
      returning id into v_tx_id;

    insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
      values (p_goal_id, 'withdraw', v_goal.saved_amount, '删除目标回吐余额', v_tx_id);
  end if;

  update public.savings_goals
    set status = 'deleted', saved_amount = 0, version = version + 1
    where id = p_goal_id;
end;
$$;

revoke execute on function public.delete_savings_goal(uuid) from public;
grant execute on function public.delete_savings_goal(uuid) to authenticated;
