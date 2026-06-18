-- 0009 · RPC 事务函数（保证原子性与完整性）
-- ----------------------------------------------------------------------------
-- 均为 SECURITY DEFINER：绕过 RLS 在服务端完成多表事务，函数体内自行做鉴权与归属校验。
-- 默认 PG 会把 EXECUTE 授予 PUBLIC，故逐个 revoke from public 再 grant authenticated。
-- 本文件实现 M1 所需核心 4 个；其余（leave/remove/transfer/succession 等）后续按流程补。

-- ── create_family：建家庭 + 户主成员 + 置 current_family_id ────────────────────
create or replace function public.create_family(p_name text, p_timezone text)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_family public.families;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  -- 一人一家
  if exists (select 1 from public.memberships
             where user_id = v_uid and status = 'active') then
    raise exception '当前用户已属于某个家庭';
  end if;

  insert into public.families (name, owner_user_id, timezone, member_count)
    values (p_name, v_uid, p_timezone, 1)
    returning * into v_family;

  insert into public.memberships (family_id, user_id, role, status)
    values (v_family.id, v_uid, 'owner', 'active');

  update public.profiles set current_family_id = v_family.id where id = v_uid;

  return v_family;
end;
$$;

-- ── join_family_by_code：凭邀请码入伙 ────────────────────────────────────────
create or replace function public.join_family_by_code(p_code text)
returns public.families
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_inv    public.invitations;
  v_family public.families;
  v_count  int;
begin
  if v_uid is null then
    raise exception '未认证' using errcode = '28000';
  end if;
  if exists (select 1 from public.memberships
             where user_id = v_uid and status = 'active') then
    raise exception '当前用户已属于某个家庭';
  end if;

  select * into v_inv from public.invitations
    where code = p_code and status = 'valid' for update;
  if not found then
    raise exception '邀请码无效';
  end if;
  if v_inv.expires_at < now() then
    update public.invitations set status = 'expired' where id = v_inv.id;
    raise exception '邀请码已过期';
  end if;

  -- 成员上限（同时由 0006 触发器兜底）
  select count(*) into v_count from public.memberships
    where family_id = v_inv.family_id and status = 'active';
  if v_count >= 8 then
    raise exception '家庭成员已达上限（8 人）';
  end if;

  insert into public.memberships (family_id, user_id, role, status)
    values (v_inv.family_id, v_uid, 'member', 'active');

  update public.families set member_count = member_count + 1
    where id = v_inv.family_id
    returning * into v_family;

  update public.profiles set current_family_id = v_inv.family_id where id = v_uid;

  return v_family;
end;
$$;

-- ── savings_deposit：存入（支出类流水 + entry + 更新目标，乐观锁）────────────────
create or replace function public.savings_deposit(
  p_goal_id          uuid,
  p_amount           bigint,
  p_note             text,
  p_expected_version int
)
returns public.savings_goals
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
  if p_amount <= 0 then
    raise exception '金额必须大于 0';
  end if;

  select * into v_goal from public.savings_goals
    where id = p_goal_id and status = 'active' for update;
  if not found then
    raise exception '储蓄目标不存在或已删除';
  end if;
  if not private.is_family_member(v_goal.family_id) then
    raise exception '无权操作该家庭数据' using errcode = '42501';
  end if;
  if v_goal.version <> p_expected_version then
    raise exception '版本冲突，请刷新后重试' using errcode = '40001';
  end if;

  select id into v_cat_id from public.categories
    where is_system and family_id is null and name = '储蓄·目标存入' limit 1;

  -- 存入：资金离开可支配池 → expense，source=savings_deposit（排除于消费分析）
  insert into public.transactions
    (family_id, type, amount, category_id, note, recorder_user_id, source, savings_goal_id)
    values (v_goal.family_id, 'expense', p_amount, v_cat_id, p_note, v_uid,
            'savings_deposit', p_goal_id)
    returning id into v_tx_id;

  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (p_goal_id, 'deposit', p_amount, p_note, v_tx_id);

  update public.savings_goals
    set saved_amount = saved_amount + p_amount,
        version      = version + 1,
        achieved_at  = case
                         when achieved_at is null
                              and saved_amount + p_amount >= target_amount
                         then now() else achieved_at end
    where id = p_goal_id
    returning * into v_goal;

  return v_goal;
end;
$$;

-- ── savings_withdraw：取出（收入类流水 + entry + 更新目标，乐观锁）──────────────
create or replace function public.savings_withdraw(
  p_goal_id          uuid,
  p_amount           bigint,
  p_note             text,
  p_expected_version int
)
returns public.savings_goals
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
  if p_amount <= 0 then
    raise exception '金额必须大于 0';
  end if;

  select * into v_goal from public.savings_goals
    where id = p_goal_id and status = 'active' for update;
  if not found then
    raise exception '储蓄目标不存在或已删除';
  end if;
  if not private.is_family_member(v_goal.family_id) then
    raise exception '无权操作该家庭数据' using errcode = '42501';
  end if;
  if v_goal.version <> p_expected_version then
    raise exception '版本冲突，请刷新后重试' using errcode = '40001';
  end if;
  if v_goal.saved_amount < p_amount then
    raise exception '取出金额超过已存金额';
  end if;

  select id into v_cat_id from public.categories
    where is_system and family_id is null and name = '储蓄·目标取出' limit 1;

  -- 取出：资金回到可支配池 → income，source=savings_withdraw（排除于消费分析）
  insert into public.transactions
    (family_id, type, amount, category_id, note, recorder_user_id, source, savings_goal_id)
    values (v_goal.family_id, 'income', p_amount, v_cat_id, p_note, v_uid,
            'savings_withdraw', p_goal_id)
    returning id into v_tx_id;

  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (p_goal_id, 'withdraw', p_amount, p_note, v_tx_id);

  update public.savings_goals
    set saved_amount = saved_amount - p_amount,
        version      = version + 1
    where id = p_goal_id
    returning * into v_goal;

  return v_goal;
end;
$$;

-- 收紧 EXECUTE 授权：撤销 PUBLIC，仅授予 authenticated
revoke execute on function public.create_family(text, text)              from public;
revoke execute on function public.join_family_by_code(text)              from public;
revoke execute on function public.savings_deposit(uuid, bigint, text, int)  from public;
revoke execute on function public.savings_withdraw(uuid, bigint, text, int) from public;

grant execute on function public.create_family(text, text)               to authenticated;
grant execute on function public.join_family_by_code(text)               to authenticated;
grant execute on function public.savings_deposit(uuid, bigint, text, int)   to authenticated;
grant execute on function public.savings_withdraw(uuid, bigint, text, int)  to authenticated;
