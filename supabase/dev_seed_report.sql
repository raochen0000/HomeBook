-- ============================================================================
-- dev_seed_report.sql · 报表页专用「大数据量」Mock 生成器
-- ----------------------------------------------------------------------------
-- 用途：给「报表」页（趋势 / 分类占比 / 累计同期 / 分类环比 / 成员贡献 / 大额 Top / 收入结构 /
--       结余率 / 预算）做数据总结·分析·展示的功能测试。覆盖 2024-01 → 当前月，逐月批量生成，
--       带季节性波动、多记账人、工资涨薪、年终奖尖峰、储蓄目标进度、逐月预算。约 1400+ 笔流水。
--
-- 前置：先跑 supabase/dev_seed.sql（本脚本复用它建好的家庭「示例之家」+ dev.a~e 五名成员）。
-- 运行：Supabase Studio → SQL Editor 粘贴执行（DB 端口被防火墙拦，勿走 psql/CLI）。
-- 幂等：开头 teardown 掉该家庭的全部流水/储蓄/预算/定时收支后重建；随机用固定种子，可复现。
--
-- ⚠️ 报表页 fetchTransactions() 有 TXN_FETCH_LIMIT=200（只取最近 200 条），要在报表里看到
--    2024/2025 的历史，需先调大该上限或改成按周期拉取（见交付说明）。数据本身与 DB 侧不受影响。
--
-- 口径对齐（PRD §11 / report.tsx）：
--   * 结余 / 结余率：全部流水（含储蓄类，用于对账）
--   * 趋势 / 分类占比 / 累计同期 / 分类环比 / 成员贡献 / 大额 Top：仅「支出 + source=normal」
--   * 收入结构：仅「source=normal 收入」
--   故本脚本把储蓄存取记为 source=savings_deposit/withdraw（会被上述卡片正确排除，用于测排除逻辑）。
-- ============================================================================

do $rep$
declare
  v_family_id uuid := 'f0000000-0000-0000-0000-0000000000f1';
  u1 uuid := '11111111-1111-1111-1111-111111111111';  -- 大伟（户主）
  u2 uuid := '22222222-2222-2222-2222-222222222222';  -- 小美
  u3 uuid := '33333333-3333-3333-3333-333333333333';  -- 阿强
  u4 uuid := '44444444-4444-4444-4444-444444444444';  -- 婷婷
  u5 uuid := '55555555-5555-5555-5555-555555555555';  -- 老王
  v_uids uuid[];
  v_tz text := 'Asia/Shanghai';

  -- 系统分类
  c_food uuid; c_transport uuid; c_shopping uuid; c_home uuid; c_fun uuid;
  c_medical uuid; c_edu uuid; c_gift uuid; c_other_exp uuid;
  c_salary uuid; c_bonus uuid; c_invest uuid; c_other_inc uuid;
  c_sav_in uuid; c_sav_out uuid;
  -- 自定义分类（不存在则建）
  c_pet uuid; c_travel uuid; c_sub uuid; c_side uuid;

  -- 支出分类配置（并行数组）：id / 名称 / 基准金额(分) / 月均笔数 / 是否随季节放大
  ex_ids   uuid[]; ex_names text[]; ex_base int[]; ex_cnt int[]; ex_seas boolean[];

  -- 定时收支规则
  r_sal_a uuid; r_sal_b uuid; r_sub uuid;

  -- 储蓄目标 + 累计
  g_emerg uuid  := 'c0000000-0000-0000-0000-0000000000e1';
  g_house uuid  := 'c0000000-0000-0000-0000-0000000000e2';
  g_travel uuid := 'c0000000-0000-0000-0000-0000000000e3';
  g_car uuid    := 'c0000000-0000-0000-0000-0000000000e4';
  saved_emerg bigint := 0; saved_house bigint := 0; saved_travel bigint := 0; saved_car bigint := 0;
  achieved_travel timestamptz := null;

  -- 循环 / 临时
  m date;
  last_m date := date_trunc('month', current_date)::date;
  v_yr int; v_mo int; v_dmax int; v_d int; v_hh int; v_mi int;
  i int; j int; v_n int;
  v_amt bigint; v_base int; v_seas double precision; v_rnd double precision; v_fill double precision;
  v_rec uuid; v_occ timestamptz; v_note text; v_sal bigint; v_dep bigint;
  v_tx uuid; v_period text;
  n_txn int := 0;
  suffixes text[] := array['日常','家用','聚会','临时','计划','采购','孩子','老人','周末','出差','请客','囤货'];
begin
  perform setseed(0.424242);
  v_uids := array[u1, u2, u3, u4, u5];

  -- ── 前置校验 ────────────────────────────────────────────────────────────
  if not exists (select 1 from public.families where id = v_family_id) then
    raise exception '未找到家庭 %，请先执行 supabase/dev_seed.sql 建好家庭与成员', v_family_id;
  end if;
  select timezone into v_tz from public.families where id = v_family_id;

  -- ── 系统分类 id ──────────────────────────────────────────────────────────
  select id into c_food      from public.categories where family_id is null and is_system and name = '餐饮';
  select id into c_transport from public.categories where family_id is null and is_system and name = '交通';
  select id into c_shopping  from public.categories where family_id is null and is_system and name = '购物';
  select id into c_home      from public.categories where family_id is null and is_system and name = '居家';
  select id into c_fun       from public.categories where family_id is null and is_system and name = '娱乐';
  select id into c_medical   from public.categories where family_id is null and is_system and name = '医疗';
  select id into c_edu       from public.categories where family_id is null and is_system and name = '教育';
  select id into c_gift      from public.categories where family_id is null and is_system and name = '人情';
  select id into c_other_exp from public.categories where family_id is null and is_system and name = '其他支出';
  select id into c_salary    from public.categories where family_id is null and is_system and name = '工资';
  select id into c_bonus     from public.categories where family_id is null and is_system and name = '奖金';
  select id into c_invest    from public.categories where family_id is null and is_system and name = '理财';
  select id into c_other_inc from public.categories where family_id is null and is_system and name = '其他收入';
  select id into c_sav_in    from public.categories where family_id is null and is_system and name = '储蓄·目标存入';
  select id into c_sav_out   from public.categories where family_id is null and is_system and name = '储蓄·目标取出';

  -- ── 自定义分类：存在即取，缺失即建 ────────────────────────────────────────
  select id into c_pet from public.categories where family_id = v_family_id and name = '宠物' and status = 'active' limit 1;
  if c_pet is null then insert into public.categories (family_id,name,icon,type,is_system,status)
    values (v_family_id,'宠物','pawprint.fill','expense',false,'active') returning id into c_pet; end if;
  select id into c_travel from public.categories where family_id = v_family_id and name = '旅行' and status = 'active' limit 1;
  if c_travel is null then insert into public.categories (family_id,name,icon,type,is_system,status)
    values (v_family_id,'旅行','airplane','expense',false,'active') returning id into c_travel; end if;
  select id into c_sub from public.categories where family_id = v_family_id and name = '订阅' and status = 'active' limit 1;
  if c_sub is null then insert into public.categories (family_id,name,icon,type,is_system,status)
    values (v_family_id,'订阅','creditcard.fill','expense',false,'active') returning id into c_sub; end if;
  select id into c_side from public.categories where family_id = v_family_id and name = '副业' and status = 'active' limit 1;
  if c_side is null then insert into public.categories (family_id,name,icon,type,is_system,status)
    values (v_family_id,'副业','briefcase.fill','income',false,'active') returning id into c_side; end if;

  -- ── TEARDOWN：清掉该家庭的历史交易/储蓄/预算/定时收支（保留成员/分类/偏好）──────────
  delete from public.savings_entries where goal_id in (select id from public.savings_goals where family_id = v_family_id);
  delete from public.recurring_runs   where rule_id in (select id from public.recurring_transactions where family_id = v_family_id);
  delete from public.transactions          where family_id = v_family_id;
  delete from public.recurring_transactions where family_id = v_family_id;
  delete from public.budget_categories where budget_id in (select id from public.budgets where family_id = v_family_id);
  delete from public.budgets           where family_id = v_family_id;
  delete from public.monthly_summaries where family_id = v_family_id;
  delete from public.savings_goals     where family_id = v_family_id;

  -- ── 定时收支规则（工资 x2 / 订阅），start 2024-01；台账随月循环补齐 ──────────────────
  insert into public.recurring_transactions
    (family_id,type,amount,category_id,note,recorder_user_id,created_by,day_of_month,start_date,enabled)
    values (v_family_id,'income',1400000,c_salary,'工资·大伟',u1,u1,25,'2024-01-01',true) returning id into r_sal_a;
  insert into public.recurring_transactions
    (family_id,type,amount,category_id,note,recorder_user_id,created_by,day_of_month,start_date,enabled)
    values (v_family_id,'income',900000,c_salary,'工资·小美',u2,u2,15,'2024-01-01',true) returning id into r_sal_b;
  insert into public.recurring_transactions
    (family_id,type,amount,category_id,note,recorder_user_id,created_by,day_of_month,start_date,enabled)
    values (v_family_id,'expense',2500,c_sub,'视频会员',u2,u2,1,'2024-01-01',true) returning id into r_sub;

  -- ── 储蓄目标（saved_amount 先置 0，循环累计后回填）────────────────────────────────
  insert into public.savings_goals (id,family_id,name,target_amount,deadline,note,saved_amount,status,created_at)
    values (g_emerg, v_family_id,'应急金',   3000000, null,        '半年生活备用金', 0,'active', make_timestamptz(2024,1,5,10,0,0,v_tz));
  insert into public.savings_goals (id,family_id,name,target_amount,deadline,note,saved_amount,status,created_at)
    values (g_house, v_family_id,'买房首付', 60000000,'2028-12-31','攒首付',         0,'active', make_timestamptz(2024,1,5,10,0,0,v_tz));
  insert into public.savings_goals (id,family_id,name,target_amount,deadline,note,saved_amount,status,created_at)
    values (g_travel,v_family_id,'日本旅行', 2000000, '2025-06-30','一家人樱花季',   0,'active', make_timestamptz(2024,1,5,10,0,0,v_tz));
  insert into public.savings_goals (id,family_id,name,target_amount,deadline,note,saved_amount,status,created_at)
    values (g_car,   v_family_id,'换车基金', 20000000,'2027-12-31','换新能源车',     0,'active', make_timestamptz(2025,1,5,10,0,0,v_tz));

  -- ── 支出分类配置 ────────────────────────────────────────────────────────
  ex_ids   := array[c_food, c_transport, c_shopping, c_home, c_fun, c_medical, c_edu, c_gift, c_pet, c_travel, c_other_exp];
  ex_names := array['餐饮','交通','购物','居家','娱乐','医疗','教育','人情','宠物','旅行','其他支出'];
  ex_base  := array[3500,  1500,  15000,  8000,  6000,  12000, 30000, 20000, 12000, 80000, 5000];
  ex_cnt   := array[12,    8,     4,      3,     3,     1,     1,     1,     1,     1,     2];
  ex_seas  := array[false, false, true,   false, true,  false, false, true,  false, true,  false];

  -- ════════════════════════════════════════════════════════════════════════
  -- 月循环：2024-01 → 当前月
  -- ════════════════════════════════════════════════════════════════════════
  m := date '2024-01-01';
  while m <= last_m loop
    v_yr := extract(year from m)::int;
    v_mo := extract(month from m)::int;
    -- 当前月只到今天；历史月到 28 号（规避大小月边界）
    v_dmax := case when m = last_m then least(28, extract(day from current_date)::int) else 28 end;
    if v_dmax < 1 then v_dmax := 1; end if;
    -- 当前月按已过天数比例缩量，模拟「进行中的本月」
    v_fill := case when m = last_m then v_dmax / 28.0 else 1.0 end;
    -- 季节系数：春节前后 / 暑期 / 双11 / 年末走高
    v_seas := case v_mo
                when 1 then 1.35 when 2 then 1.55
                when 6 then 1.15 when 7 then 1.30 when 8 then 1.25
                when 10 then 1.10 when 11 then 1.40 when 12 then 1.25
                else 1.0 end;

    -- ── 支出 ──────────────────────────────────────────────────────────────
    for i in 1 .. array_length(ex_ids, 1) loop
      v_n := ex_cnt[i];
      if ex_seas[i] and v_seas > 1.2 then v_n := v_n + 1; end if;         -- 旺季给季节性分类加一笔
      v_n := greatest(0, round(v_n * v_fill)::int);                        -- 本月缩量
      for j in 1 .. v_n loop
        v_rnd  := random();
        v_base := ex_base[i];
        -- 季节性分类吃满季节系数，其它只吃 35%
        v_amt := greatest(1::bigint, round(
                   v_base
                   * (case when ex_seas[i] then v_seas else 1.0 + (v_seas - 1.0) * 0.35 end)
                   * (0.6 + random() * 0.8)
                 )::bigint);
        v_d  := 1 + floor(random() * v_dmax)::int;
        v_hh := 8 + floor(random() * 14)::int;
        v_mi := floor(random() * 60)::int;
        v_occ := make_timestamptz(v_yr, v_mo, v_d, v_hh, v_mi, 0, v_tz);
        -- 记账人加权：大伟最多，其余递减（喂「成员贡献」卡）
        v_rec := v_uids[ case when v_rnd < 0.30 then 1 when v_rnd < 0.52 then 2
                              when v_rnd < 0.72 then 3 when v_rnd < 0.88 then 4 else 5 end ];
        v_note := ex_names[i] || case when random() < 0.5 then ''
                                      else ' · ' || suffixes[1 + floor(random() * array_length(suffixes,1))::int] end;
        insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source)
          values (v_family_id,'expense',v_amt,ex_ids[i],v_note,v_occ,v_rec,'normal');
        n_txn := n_txn + 1;
      end loop;
    end loop;

    -- ── 订阅（定时收支·支出，每月 1 号）────────────────────────────────────
    v_occ := make_timestamptz(v_yr, v_mo, 1, 10, 0, 0, v_tz);
    insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source)
      values (v_family_id,'expense',2500,c_sub,'视频会员',v_occ,u2,'normal') returning id into v_tx;
    insert into public.recurring_runs (rule_id,period_key,transaction_id) values (r_sub, to_char(m,'YYYY-MM'), v_tx);
    n_txn := n_txn + 1;

    -- ── 工资·大伟（涨薪，每月 25 号；本月 25 号未到则跳过）───────────────────
    if m < last_m or 25 <= v_dmax then
      v_sal := case v_yr when 2024 then 1400000 when 2025 then 1550000 else 1700000 end;
      v_occ := make_timestamptz(v_yr, v_mo, 25, 12, 0, 0, v_tz);
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source)
        values (v_family_id,'income',v_sal,c_salary,'工资·大伟',v_occ,u1,'normal') returning id into v_tx;
      insert into public.recurring_runs (rule_id,period_key,transaction_id) values (r_sal_a, to_char(m,'YYYY-MM'), v_tx);
      n_txn := n_txn + 1;
    end if;

    -- ── 工资·小美（涨薪，每月 15 号）───────────────────────────────────────
    if m < last_m or 15 <= v_dmax then
      v_sal := case v_yr when 2024 then 900000 when 2025 then 1000000 else 1100000 end;
      v_occ := make_timestamptz(v_yr, v_mo, 15, 12, 0, 0, v_tz);
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source)
        values (v_family_id,'income',v_sal,c_salary,'工资·小美',v_occ,u2,'normal') returning id into v_tx;
      insert into public.recurring_runs (rule_id,period_key,transaction_id) values (r_sal_b, to_char(m,'YYYY-MM'), v_tx);
      n_txn := n_txn + 1;
    end if;

    -- ── 年终奖（2 月）/ 年中奖（7 月）尖峰 ─────────────────────────────────
    if v_mo = 2 and (m < last_m or 10 <= v_dmax) then
      v_occ := make_timestamptz(v_yr, 2, 10, 12, 0, 0, v_tz);
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source)
        values (v_family_id,'income', (case v_yr when 2024 then 2800000 when 2025 then 3200000 else 3600000 end),
                c_bonus,'年终奖·大伟',v_occ,u1,'normal');
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source)
        values (v_family_id,'income',900000,c_bonus,'年终奖·小美',v_occ,u2,'normal');
      n_txn := n_txn + 2;
    end if;
    if v_mo = 7 and (m < last_m or 10 <= v_dmax) then
      v_occ := make_timestamptz(v_yr, 7, 10, 12, 0, 0, v_tz);
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source)
        values (v_family_id,'income',500000,c_bonus,'年中奖',v_occ,u1,'normal');
      n_txn := n_txn + 1;
    end if;

    -- ── 理财收益（约 75% 的月份）+ 副业（约 35% 的月份）─────────────────────
    if random() < 0.75 then
      v_d := 1 + floor(random() * v_dmax)::int;
      v_occ := make_timestamptz(v_yr, v_mo, v_d, 20, 0, 0, v_tz);
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source)
        values (v_family_id,'income', (2000 + floor(random()*28000))::bigint, c_invest,'理财收益',v_occ,u1,'normal');
      n_txn := n_txn + 1;
    end if;
    if random() < 0.35 then
      v_d := 1 + floor(random() * v_dmax)::int;
      v_occ := make_timestamptz(v_yr, v_mo, v_d, 21, 0, 0, v_tz);
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source)
        values (v_family_id,'income', (30000 + floor(random()*120000))::bigint, c_side,'副业·阿强',v_occ,u3,'normal');
      n_txn := n_txn + 1;
    end if;

    -- ── 储蓄存入（source=savings_deposit，报表消费口径会排除）──────────────
    -- 应急金（每月约 90%）
    if random() < 0.90 then
      v_dep := (30000 + floor(random()*50000))::bigint;
      v_occ := make_timestamptz(v_yr, v_mo, least(5, v_dmax), 20, 0, 0, v_tz);
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source,savings_goal_id)
        values (v_family_id,'expense',v_dep,c_sav_in,'应急金存入',v_occ,u1,'savings_deposit',g_emerg) returning id into v_tx;
      insert into public.savings_entries (goal_id,direction,amount,note,transaction_id)
        values (g_emerg,'deposit',v_dep,'应急金存入',v_tx);
      saved_emerg := saved_emerg + v_dep; n_txn := n_txn + 1;
    end if;
    -- 买房首付（每月）
    v_dep := (150000 + floor(random()*150000))::bigint;
    v_occ := make_timestamptz(v_yr, v_mo, least(6, v_dmax), 20, 0, 0, v_tz);
    insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source,savings_goal_id)
      values (v_family_id,'expense',v_dep,c_sav_in,'首付存入',v_occ,u2,'savings_deposit',g_house) returning id into v_tx;
    insert into public.savings_entries (goal_id,direction,amount,note,transaction_id)
      values (g_house,'deposit',v_dep,'首付存入',v_tx);
    saved_house := saved_house + v_dep; n_txn := n_txn + 1;
    -- 日本旅行（2024 年内攒够即达成，之后不再存）
    if saved_travel < 2000000 then
      v_dep := (120000 + floor(random()*100000))::bigint;
      v_occ := make_timestamptz(v_yr, v_mo, least(7, v_dmax), 20, 0, 0, v_tz);
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source,savings_goal_id)
        values (v_family_id,'expense',v_dep,c_sav_in,'旅行基金存入',v_occ,u1,'savings_deposit',g_travel) returning id into v_tx;
      insert into public.savings_entries (goal_id,direction,amount,note,transaction_id)
        values (g_travel,'deposit',v_dep,'旅行基金存入',v_tx);
      saved_travel := saved_travel + v_dep; n_txn := n_txn + 1;
      if saved_travel >= 2000000 and achieved_travel is null then
        achieved_travel := v_occ;
      end if;
    end if;
    -- 换车基金（2025-01 起，每月）
    if m >= date '2025-01-01' then
      v_dep := (150000 + floor(random()*150000))::bigint;
      v_occ := make_timestamptz(v_yr, v_mo, least(8, v_dmax), 20, 0, 0, v_tz);
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source,savings_goal_id)
        values (v_family_id,'expense',v_dep,c_sav_in,'换车基金存入',v_occ,u1,'savings_deposit',g_car) returning id into v_tx;
      insert into public.savings_entries (goal_id,direction,amount,note,transaction_id)
        values (g_car,'deposit',v_dep,'换车基金存入',v_tx);
      saved_car := saved_car + v_dep; n_txn := n_txn + 1;
    end if;

    -- ── 一次应急金取出（2025-06，模拟大额医疗周转）source=savings_withdraw ──
    if v_yr = 2025 and v_mo = 6 then
      v_dep := 200000;
      v_occ := make_timestamptz(2025, 6, 12, 15, 0, 0, v_tz);
      insert into public.transactions (family_id,type,amount,category_id,note,occurred_at,recorder_user_id,source,savings_goal_id)
        values (v_family_id,'income',v_dep,c_sav_out,'应急金取出·就医周转',v_occ,u1,'savings_withdraw',g_emerg) returning id into v_tx;
      insert into public.savings_entries (goal_id,direction,amount,note,transaction_id)
        values (g_emerg,'withdraw',v_dep,'应急金取出·就医周转',v_tx);
      saved_emerg := saved_emerg - v_dep; n_txn := n_txn + 1;
    end if;

    -- ── 逐月预算（总额按年增长 + 三个分类预算，喂预算/超支视图）───────────────
    insert into public.budgets (family_id, period, total_amount, alert_enabled)
      values (v_family_id, to_char(m,'YYYY-MM'),
              (case v_yr when 2024 then 380000 when 2025 then 430000 else 480000 end), true)
      returning id into v_tx;
    insert into public.budget_categories (budget_id, category_id, amount) values
      (v_tx, c_food,     55000),
      (v_tx, c_shopping, 60000),
      (v_tx, c_transport,25000);

    m := (m + interval '1 month')::date;
  end loop;

  -- ── 回填储蓄目标累计与达成时间 ───────────────────────────────────────────
  update public.savings_goals set saved_amount = greatest(0, saved_emerg) where id = g_emerg;
  update public.savings_goals set saved_amount = greatest(0, saved_house) where id = g_house;
  update public.savings_goals set saved_amount = saved_travel, achieved_at = achieved_travel where id = g_travel;
  update public.savings_goals set saved_amount = greatest(0, saved_car)   where id = g_car;

  raise notice '报表 mock 生成完成：家庭 % · 期间 2024-01 → % · 共写入约 % 笔流水（另含逐月预算与 4 个储蓄目标）。',
    v_family_id, to_char(last_m,'YYYY-MM'), n_txn;
end
$rep$;

-- ── 验证：按年/维度看看分布是否合理 ─────────────────────────────────────────
select to_char(occurred_at at time zone 'Asia/Shanghai','YYYY') as yr,
       count(*)                                              as 笔数,
       count(*) filter (where type='expense' and source='normal') as 消费笔数,
       count(*) filter (where type='income' and source='normal')  as 收入笔数,
       count(*) filter (where source like 'savings%')             as 储蓄笔数,
       to_char(sum(amount) filter (where type='expense' and source='normal')/100.0,'FM999,999,990.00') as 消费合计元
from public.transactions
where family_id = 'f0000000-0000-0000-0000-0000000000f1'
group by 1 order by 1;
