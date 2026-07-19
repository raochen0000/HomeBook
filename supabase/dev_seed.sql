-- ============================================================================
-- dev_seed.sql · 开发/测试 Mock 数据种子
-- ----------------------------------------------------------------------------
-- 用途：一键在测试实例灌入「一个多成员家庭 + 覆盖各业务场景」的数据，供联调 / 走查。
-- 运行方式：Supabase Studio → SQL Editor 粘贴执行（DB 端口被防火墙拦，勿走 psql/CLI）。
--
-- 账号（密码统一 test123，邮箱已确认可直接登录）：
--   dev.a@homebook.test  大伟  —— 户主（owner）
--   dev.b@homebook.test  小美  —— 成员
--   dev.c@homebook.test  阿强  —— 成员
--   dev.d@homebook.test  婷婷  —— 成员
--   dev.e@homebook.test  老王  —— 成员
--   全部属于同一个家庭「示例之家」（member_count = 5，上限 8，留位测邀请/加入）。
--
-- 特性：
--   * 幂等可重复执行——脚本开头按外键顺序 teardown 掉这批固定 UUID 的旧数据后重建。
--   * 直接写 auth.users（bcrypt 口令）+ auth.identities（email provider）；
--     public.profiles 由 0006 的 on_auth_user_created 触发器自动建，随后补 current_family_id。
--   * 金额单位一律「分」（bigint）。
--
-- 覆盖场景：多成员多月流水（含多记账人 / 被他人编辑）、自定义分类、隐藏系统分类、
--   预算 + 分类预算（含 >80% 预警态）、储蓄目标（进行中 / 已达成 / 含取出 / 已删除）、
--   定时收支（工资 / 订阅已生成台账 + 停用规则）、月度总结快照、通知（各 type）、
--   通知偏好 / 记账偏好、意见反馈、邀请码（有效 / 过期 / 撤销）、设备令牌、待处理继任申请。
-- ============================================================================

-- crypt() / gen_salt() 依赖 pgcrypto；确保存在并让 search_path 能解析到它。
create extension if not exists pgcrypto with schema extensions;
set search_path = public, extensions;

do $seed$
declare
  -- ── 固定标识（便于 teardown 与关联）───────────────────────────────────────
  v_family_id uuid := 'f0000000-0000-0000-0000-0000000000f1';
  v_uids   uuid[] := array[
    '11111111-1111-1111-1111-111111111111',  -- dev.a 户主
    '22222222-2222-2222-2222-222222222222',  -- dev.b
    '33333333-3333-3333-3333-333333333333',  -- dev.c
    '44444444-4444-4444-4444-444444444444',  -- dev.d
    '55555555-5555-5555-5555-555555555555'   -- dev.e
  ];
  v_emails text[] := array[
    'dev.a@homebook.test','dev.b@homebook.test','dev.c@homebook.test',
    'dev.d@homebook.test','dev.e@homebook.test'
  ];
  v_nicks  text[] := array['大伟','小美','阿强','婷婷','老王'];
  -- crypt/gen_salt 不写死 schema：靠上面的 search_path = public, extensions 解析（两种安装位置都兼容）
  v_pw_hash text := crypt('test123', gen_salt('bf'));
  v_tz text := 'Asia/Shanghai';
  i int;

  -- 系统预设分类 id（migration 0010 已灌入，family_id is null）
  c_food uuid; c_transport uuid; c_shopping uuid; c_home uuid; c_fun uuid;
  c_medical uuid; c_edu uuid; c_gift uuid; c_other_exp uuid;
  c_salary uuid; c_bonus uuid; c_invest uuid; c_other_inc uuid;
  c_sav_in uuid; c_sav_out uuid;

  -- 自定义分类 id（本家庭）
  c_pet uuid; c_travel uuid; c_sub uuid; c_side uuid;

  -- 储蓄目标 id
  g_travel uuid := 'a0000000-0000-0000-0000-000000000001';  -- 进行中
  g_phone  uuid := 'a0000000-0000-0000-0000-000000000002';  -- 已达成
  g_emerg  uuid := 'a0000000-0000-0000-0000-000000000003';  -- 含取出
  g_old    uuid := 'a0000000-0000-0000-0000-000000000004';  -- 已删除

  -- 预算 id
  b_jul uuid := 'b0000000-0000-0000-0000-000000000007';
  b_jun uuid := 'b0000000-0000-0000-0000-000000000006';

  -- 定时收支规则 id
  r_salary uuid; r_sub uuid; r_gym uuid;

  -- teardown 用：实际要清理的用户 / 家庭全集（固定 id + 同邮箱旧账号 + 其名下家庭）
  v_all_uids uuid[];
  v_all_fams uuid[];

  -- 临时
  v_tx uuid;
begin
  -- ════════════════════════════════════════════════════════════════════════
  -- 0) TEARDOWN —— 幂等可重跑（⚠️ 仅供测试实例：会连带清掉这些账号名下的家庭数据）
  -- 之前若用 dev 自动登录/注册建过 dev.a~e，其 id 是 Supabase 随机生成的，与本脚本
  -- 写死的固定 id 不同。故这里「按邮箱」把旧账号也纳入清理，避免 email 唯一约束冲突。
  -- ════════════════════════════════════════════════════════════════════════
  -- 相关用户全集：固定 id ∪ 同邮箱的已存在账号
  select coalesce(array_agg(distinct id), '{}'::uuid[]) into v_all_uids
  from (
    select unnest(v_uids) as id
    union
    select id from auth.users where lower(email) = any(v_emails)
  ) s;

  -- 相关家庭全集：固定家庭 ∪ 这些用户 拥有/所属/当前 的家庭
  select coalesce(array_agg(distinct fid), '{}'::uuid[]) into v_all_fams
  from (
    select v_family_id as fid
    union select id from public.families  where owner_user_id = any(v_all_uids)
    union select family_id from public.memberships where user_id = any(v_all_uids)
    union select current_family_id from public.profiles
            where id = any(v_all_uids) and current_family_id is not null
  ) s;

  -- 家庭级数据（按外键依赖顺序；同时按 recorder/created_by/applicant 兜底删挡住用户删除的引用）
  delete from public.savings_entries
    where goal_id in (select id from public.savings_goals where family_id = any(v_all_fams));
  delete from public.recurring_runs
    where rule_id in (select id from public.recurring_transactions where family_id = any(v_all_fams));
  delete from public.transactions
    where family_id = any(v_all_fams) or recorder_user_id = any(v_all_uids);
  delete from public.recurring_transactions
    where family_id = any(v_all_fams) or recorder_user_id = any(v_all_uids) or created_by = any(v_all_uids);
  delete from public.budget_categories
    where budget_id in (select id from public.budgets where family_id = any(v_all_fams));
  delete from public.budgets                  where family_id = any(v_all_fams);
  delete from public.monthly_summaries        where family_id = any(v_all_fams);
  delete from public.family_hidden_categories where family_id = any(v_all_fams);
  delete from public.savings_goals            where family_id = any(v_all_fams);
  delete from public.categories               where family_id = any(v_all_fams);
  delete from public.invitations              where family_id = any(v_all_fams);
  delete from public.succession_requests
    where family_id = any(v_all_fams) or applicant_user_id = any(v_all_uids);
  -- 用户级数据（多数会随 profile 级联，这里显式删更稳）
  delete from public.feedback                 where user_id = any(v_all_uids);
  delete from public.notifications            where user_id = any(v_all_uids);
  delete from public.device_tokens            where user_id = any(v_all_uids);
  delete from public.notification_preferences where user_id = any(v_all_uids);
  delete from public.accounting_preferences   where user_id = any(v_all_uids);
  delete from public.memberships
    where family_id = any(v_all_fams) or user_id = any(v_all_uids);
  update public.profiles set current_family_id = null where id = any(v_all_uids);
  delete from public.families                 where id = any(v_all_fams);
  delete from auth.users                      where id = any(v_all_uids);  -- 级联 profiles + identities

  -- ════════════════════════════════════════════════════════════════════════
  -- 1) 认证用户 auth.users + auth.identities（profiles 由触发器自动建）
  -- ════════════════════════════════════════════════════════════════════════
  for i in 1 .. array_length(v_uids, 1) loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, last_sign_in_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token,
      email_change_confirm_status, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uids[i], 'authenticated', 'authenticated',
      v_emails[i], v_pw_hash, now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nickname', v_nicks[i], 'email_verified', true),
      now() - interval '60 days', now(), now(),
      '', '', '', '', '', '', 0, false, false
    );

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uids[i], v_uids[i]::text,
      jsonb_build_object('sub', v_uids[i]::text, 'email', v_emails[i], 'email_verified', true),
      'email', now(), now() - interval '60 days', now()
    );
  end loop;

  -- ════════════════════════════════════════════════════════════════════════
  -- 2) 家庭 + 成员 + profiles 归属
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.families (id, name, owner_user_id, timezone, member_count, status, created_at)
  values (v_family_id, '示例之家', v_uids[1], v_tz, 5, 'active', now() - interval '55 days');

  update public.profiles set current_family_id = v_family_id where id = any(v_uids);
  -- 户主故意「40 天未登录」→ 触发继任资格场景；成员近期活跃。
  update public.profiles set last_login_at = now() - interval '40 days' where id = v_uids[1];
  update public.profiles set last_login_at = now() - interval '2 hours'  where id = any(v_uids[2:5]);

  insert into public.memberships (family_id, user_id, role, status, joined_at) values
    (v_family_id, v_uids[1], 'owner',  'active', now() - interval '55 days'),
    (v_family_id, v_uids[2], 'member', 'active', now() - interval '50 days'),
    (v_family_id, v_uids[3], 'member', 'active', now() - interval '48 days'),
    (v_family_id, v_uids[4], 'member', 'active', now() - interval '30 days'),
    (v_family_id, v_uids[5], 'member', 'active', now() - interval '15 days');

  -- ════════════════════════════════════════════════════════════════════════
  -- 3) 系统分类 id 取用 + 自定义分类 + 隐藏系统分类
  -- ════════════════════════════════════════════════════════════════════════
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

  -- 自定义分类（本家庭）
  insert into public.categories (family_id, name, icon, type, is_system, status)
    values (v_family_id, '宠物', 'pawprint.fill',        'expense', false, 'active') returning id into c_pet;
  insert into public.categories (family_id, name, icon, type, is_system, status)
    values (v_family_id, '旅行', 'airplane',             'expense', false, 'active') returning id into c_travel;
  insert into public.categories (family_id, name, icon, type, is_system, status)
    values (v_family_id, '订阅', 'creditcard.fill',      'expense', false, 'active') returning id into c_sub;
  insert into public.categories (family_id, name, icon, type, is_system, status)
    values (v_family_id, '副业', 'briefcase.fill',       'income',  false, 'active') returning id into c_side;
  -- 已归档（软删）的自定义分类：测「历史流水仍能解析、但选择器不再出现」
  insert into public.categories (family_id, name, icon, type, is_system, status)
    values (v_family_id, '烟酒', 'wineglass.fill',       'expense', false, 'archived');

  -- 家庭隐藏系统分类「人情」：选择器里不再出现，但 6 月那笔人情历史流水仍能显示名称/图标
  insert into public.family_hidden_categories (family_id, category_id) values (v_family_id, c_gift);

  -- ════════════════════════════════════════════════════════════════════════
  -- 4) 普通流水（5 / 6 / 7 三个月，多记账人）—— 工资/订阅走定时收支段落，不在此
  -- ════════════════════════════════════════════════════════════════════════
  -- 2026-07（本月）
  insert into public.transactions
    (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source, last_editor_user_id) values
    (v_family_id, 'expense', 4580,  c_food,      '公司楼下早午餐', make_timestamptz(2026,7,2,9,20,0,v_tz),  v_uids[2], 'normal', null),
    (v_family_id, 'expense', 1200,  c_transport, '地铁通勤',       make_timestamptz(2026,7,3,8,10,0,v_tz),  v_uids[1], 'normal', null),
    (v_family_id, 'expense', 23800, c_shopping,  '夏装',           make_timestamptz(2026,7,5,15,0,0,v_tz),  v_uids[4], 'normal', null),
    (v_family_id, 'expense', 8900,  c_food,      '周末家庭聚餐',   make_timestamptz(2026,7,6,19,30,0,v_tz), v_uids[1], 'normal', null),
    (v_family_id, 'expense', 6000,  c_fun,       '电影票 x2',      make_timestamptz(2026,7,7,20,0,0,v_tz),  v_uids[3], 'normal', null),
    (v_family_id, 'expense', 15600, c_pet,       '猫粮 + 猫砂',    make_timestamptz(2026,7,8,11,0,0,v_tz),  v_uids[2], 'normal', null),
    (v_family_id, 'expense', 32000, c_medical,   '年度体检',       make_timestamptz(2026,7,9,10,0,0,v_tz),  v_uids[5], 'normal', null),
    -- 这笔由小美（dev.b）记，后被户主大伟（dev.a）编辑过 → last_editor 展示他人头像
    (v_family_id, 'expense', 5200,  c_food,      '外卖',           make_timestamptz(2026,7,10,12,30,0,v_tz),v_uids[2], 'normal', v_uids[1]),
    (v_family_id, 'expense', 45000, c_edu,       '孩子网课',       make_timestamptz(2026,7,11,9,0,0,v_tz),  v_uids[4], 'normal', null),
    (v_family_id, 'income',  80000, c_side,      '设计外包尾款',   make_timestamptz(2026,7,4,18,0,0,v_tz),  v_uids[3], 'normal', null),
    (v_family_id, 'income',  3500,  c_invest,    '基金收益',       make_timestamptz(2026,7,8,21,0,0,v_tz),  v_uids[1], 'normal', null);

  -- 2026-06（上月，月度总结口径）
  insert into public.transactions
    (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source) values
    (v_family_id, 'expense', 6800,   c_food,      '午餐',         make_timestamptz(2026,6,3,12,0,0,v_tz),  v_uids[1], 'normal'),
    (v_family_id, 'expense', 45000,  c_shopping,  '日用囤货',     make_timestamptz(2026,6,5,16,0,0,v_tz),  v_uids[2], 'normal'),
    (v_family_id, 'expense', 3400,   c_transport, '打车',         make_timestamptz(2026,6,8,22,10,0,v_tz), v_uids[3], 'normal'),
    (v_family_id, 'expense', 5600,   c_food,      '晚餐',         make_timestamptz(2026,6,10,19,0,0,v_tz), v_uids[4], 'normal'),
    (v_family_id, 'expense', 12000,  c_fun,       'KTV',          make_timestamptz(2026,6,12,21,0,0,v_tz), v_uids[1], 'normal'),
    (v_family_id, 'expense', 28000,  c_home,      '扫地机器人',   make_timestamptz(2026,6,15,14,0,0,v_tz), v_uids[2], 'normal'),
    (v_family_id, 'expense', 8800,   c_medical,   '感冒买药',     make_timestamptz(2026,6,18,10,0,0,v_tz), v_uids[5], 'normal'),
    (v_family_id, 'expense', 60000,  c_gift,      '同事结婚红包', make_timestamptz(2026,6,20,11,0,0,v_tz), v_uids[1], 'normal'),  -- 隐藏分类的历史流水
    (v_family_id, 'expense', 7200,   c_food,      '火锅',         make_timestamptz(2026,6,22,19,30,0,v_tz),v_uids[3], 'normal'),
    (v_family_id, 'expense', 156000, c_travel,    '周末周边游',   make_timestamptz(2026,6,25,9,0,0,v_tz),  v_uids[1], 'normal'),  -- 最大单笔
    (v_family_id, 'expense', 9900,   c_shopping,  '给娃买鞋',     make_timestamptz(2026,6,28,15,0,0,v_tz), v_uids[4], 'normal'),
    (v_family_id, 'income',  300000, c_bonus,     'Q2 季度奖',    make_timestamptz(2026,6,15,10,0,0,v_tz), v_uids[1], 'normal'),
    (v_family_id, 'income',  50000,  c_side,      '副业收入',     make_timestamptz(2026,6,20,20,0,0,v_tz), v_uids[3], 'normal');

  -- 2026-05（上上月，环比参照，较轻）
  insert into public.transactions
    (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source) values
    (v_family_id, 'expense', 5000,  c_food,      '午餐', make_timestamptz(2026,5,5,12,0,0,v_tz),  v_uids[1], 'normal'),
    (v_family_id, 'expense', 32000, c_shopping,  '换季衣物', make_timestamptz(2026,5,12,16,0,0,v_tz),v_uids[2], 'normal'),
    (v_family_id, 'expense', 2800,  c_transport, '公交地铁', make_timestamptz(2026,5,15,8,0,0,v_tz), v_uids[3], 'normal'),
    (v_family_id, 'expense', 9000,  c_fun,       '游乐场', make_timestamptz(2026,5,20,14,0,0,v_tz), v_uids[4], 'normal'),
    (v_family_id, 'expense', 6600,  c_food,      '外卖', make_timestamptz(2026,5,25,12,30,0,v_tz),  v_uids[1], 'normal');

  -- ════════════════════════════════════════════════════════════════════════
  -- 5) 储蓄目标 + 存取记录（每笔存取 = 一条 transactions + 一条 savings_entries）
  -- ════════════════════════════════════════════════════════════════════════
  -- 目标 1：旅行基金（进行中，saved 350000 / target 1000000，有 deadline）
  insert into public.savings_goals (id, family_id, name, target_amount, deadline, note, saved_amount, status)
    values (g_travel, v_family_id, '旅行基金', 1000000, '2026-12-31', '年底全家出游', 350000, 'active');
  insert into public.transactions
    (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source, savings_goal_id)
    values (v_family_id,'expense',200000,c_sav_in,'旅行基金存入',make_timestamptz(2026,6,15,20,0,0,v_tz),v_uids[1],'savings_deposit',g_travel)
    returning id into v_tx;
  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (g_travel, 'deposit', 200000, '旅行基金存入', v_tx);
  insert into public.transactions
    (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source, savings_goal_id)
    values (v_family_id,'expense',150000,c_sav_in,'旅行基金存入',make_timestamptz(2026,7,1,20,0,0,v_tz),v_uids[2],'savings_deposit',g_travel)
    returning id into v_tx;
  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (g_travel, 'deposit', 150000, '旅行基金存入', v_tx);

  -- 目标 2：新款手机（已达成，saved = target = 800000，achieved_at 落定 → 触发过庆祝）
  insert into public.savings_goals (id, family_id, name, target_amount, deadline, note, saved_amount, achieved_at, status)
    values (g_phone, v_family_id, '新款手机', 800000, null, '换手机', 800000, make_timestamptz(2026,6,25,20,0,0,v_tz), 'active');
  insert into public.transactions
    (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source, savings_goal_id)
    values (v_family_id,'expense',500000,c_sav_in,'手机基金存入',make_timestamptz(2026,5,20,20,0,0,v_tz),v_uids[1],'savings_deposit',g_phone)
    returning id into v_tx;
  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (g_phone, 'deposit', 500000, '手机基金存入', v_tx);
  insert into public.transactions
    (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source, savings_goal_id)
    values (v_family_id,'expense',300000,c_sav_in,'手机基金存入',make_timestamptz(2026,6,25,20,0,0,v_tz),v_uids[1],'savings_deposit',g_phone)
    returning id into v_tx;
  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (g_phone, 'deposit', 300000, '手机基金存入', v_tx);

  -- 目标 3：应急金（进行中，含一笔取出；saved = 500000+300000-100000 = 700000，无 deadline）
  insert into public.savings_goals (id, family_id, name, target_amount, deadline, note, saved_amount, status)
    values (g_emerg, v_family_id, '应急金', 2000000, null, '至少存够半年开销', 700000, 'active');
  insert into public.transactions
    (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source, savings_goal_id)
    values (v_family_id,'expense',500000,c_sav_in,'应急金存入',make_timestamptz(2026,5,10,20,0,0,v_tz),v_uids[1],'savings_deposit',g_emerg)
    returning id into v_tx;
  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (g_emerg, 'deposit', 500000, '应急金存入', v_tx);
  insert into public.transactions
    (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source, savings_goal_id)
    values (v_family_id,'expense',300000,c_sav_in,'应急金存入',make_timestamptz(2026,6,10,20,0,0,v_tz),v_uids[3],'savings_deposit',g_emerg)
    returning id into v_tx;
  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (g_emerg, 'deposit', 300000, '应急金存入', v_tx);
  insert into public.transactions
    (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source, savings_goal_id)
    values (v_family_id,'income',100000,c_sav_out,'应急金取出（临时周转）',make_timestamptz(2026,7,5,20,0,0,v_tz),v_uids[1],'savings_withdraw',g_emerg)
    returning id into v_tx;
  insert into public.savings_entries (goal_id, direction, amount, note, transaction_id)
    values (g_emerg, 'withdraw', 100000, '应急金取出（临时周转）', v_tx);

  -- 目标 4：旧旅行基金（已删除，不计入进行中上限，列表不展示）
  insert into public.savings_goals (id, family_id, name, target_amount, deadline, saved_amount, status)
    values (g_old, v_family_id, '旧旅行基金', 500000, null, 0, 'deleted');

  -- ════════════════════════════════════════════════════════════════════════
  -- 6) 预算：本月 + 上月（含分类预算，造出 >80% 预警态）
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.budgets (id, family_id, period, total_amount, alert_enabled)
    values (b_jul, v_family_id, '2026-07', 500000, true);
  -- 本月各分类实际（普通支出）：餐饮 18680 / 购物 23800 / 娱乐 6000 / 医疗 32000
  insert into public.budget_categories (budget_id, category_id, amount) values
    (b_jul, c_food,     20000),  -- 已用 18680 → 93%（预警）
    (b_jul, c_shopping, 30000),  -- 已用 23800 → 79%（临界）
    (b_jul, c_fun,      6000),   -- 已用 6000  → 100%（超支预警）
    (b_jul, c_medical,  40000);  -- 已用 32000 → 80%（预警）

  insert into public.budgets (id, family_id, period, total_amount, alert_enabled)
    values (b_jun, v_family_id, '2026-06', 480000, true);
  insert into public.budget_categories (budget_id, category_id, amount) values
    (b_jun, c_food, 30000);

  -- ════════════════════════════════════════════════════════════════════════
  -- 7) 定时收支规则 + 已生成台账（工资、订阅）+ 一条停用规则
  -- ════════════════════════════════════════════════════════════════════════
  -- 工资：每月 10 号 +15000，dev.a，start 2026-05；已生成 5/6/7 三期
  insert into public.recurring_transactions
    (family_id, type, amount, category_id, note, recorder_user_id, created_by, day_of_month, start_date, end_date, enabled)
    values (v_family_id, 'income', 1500000, c_salary, '月薪', v_uids[1], v_uids[1], 10, '2026-05-01', null, true)
    returning id into r_salary;
  for i in 0..2 loop  -- 5、6、7 月
    insert into public.transactions
      (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source)
      values (v_family_id, 'income', 1500000, c_salary, '月薪',
              make_timestamptz(2026, 5 + i, 10, 12, 0, 0, v_tz), v_uids[1], 'normal')
      returning id into v_tx;
    insert into public.recurring_runs (rule_id, period_key, transaction_id)
      values (r_salary, to_char(make_date(2026, 5 + i, 1), 'YYYY-MM'), v_tx);
  end loop;

  -- 视频会员订阅：每月 1 号 -25，dev.b，start 2026-06；已生成 6/7 两期
  insert into public.recurring_transactions
    (family_id, type, amount, category_id, note, recorder_user_id, created_by, day_of_month, start_date, end_date, enabled)
    values (v_family_id, 'expense', 2500, c_sub, '视频会员', v_uids[2], v_uids[2], 1, '2026-06-01', null, true)
    returning id into r_sub;
  for i in 0..1 loop  -- 6、7 月
    insert into public.transactions
      (family_id, type, amount, category_id, note, occurred_at, recorder_user_id, source)
      values (v_family_id, 'expense', 2500, c_sub, '视频会员',
              make_timestamptz(2026, 6 + i, 1, 12, 0, 0, v_tz), v_uids[2], 'normal')
      returning id into v_tx;
    insert into public.recurring_runs (rule_id, period_key, transaction_id)
      values (r_sub, to_char(make_date(2026, 6 + i, 1), 'YYYY-MM'), v_tx);
  end loop;

  -- 停用规则：健身房月卡（enabled=false，无台账）→ 测「已停用」展示
  insert into public.recurring_transactions
    (family_id, type, amount, category_id, note, recorder_user_id, created_by, day_of_month, start_date, end_date, enabled)
    values (v_family_id, 'expense', 30000, c_fun, '健身房月卡', v_uids[4], v_uids[4], 5, '2026-05-01', '2026-06-30', false)
    returning id into r_gym;

  -- ════════════════════════════════════════════════════════════════════════
  -- 8) 月度总结快照（2026-06）—— 客户端 MVP 实时计算不读它，这里存快照供运营/回归
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.monthly_summaries
    (family_id, period, total_expense, total_income, balance,
     max_single_expense, top_category, top_recorder, mom_compare, warm_text)
  values (
    v_family_id, '2026-06', 345200, 1850000, 1504800,
    jsonb_build_object('amount', 156000, 'category', '旅行', 'note', '周末周边游', 'recorder', '大伟', 'date', '2026-06-25'),
    jsonb_build_object('name', '旅行', 'amount', 156000),
    jsonb_build_object('user_id', v_uids[1]::text, 'nickname', '大伟', 'count', 6),
    jsonb_build_object('prev_expense', 55400, 'delta', 289800, 'direction', 'up'),
    '这个月旅行花了不少，但和家人在一起的时光最珍贵 ✨'
  );

  -- ════════════════════════════════════════════════════════════════════════
  -- 9) 通知（App 内 in_app；type 仅限 removed/transfer/succession/goal_achieved/budget_alert/monthly_summary）
  --    payload 全为 string 值（客户端按 Record<string,string> 读）；pushed_at 置 now() 避免被 push-fc 补推
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.notifications (user_id, type, channel, payload, read_at, created_at, pushed_at) values
    (v_uids[1], 'budget_alert',    'in_app',
       jsonb_build_object('text','娱乐 本月预算已用满（¥60 / ¥60）','period','2026-07'),
       null, now() - interval '2 hours', now()),
    (v_uids[1], 'monthly_summary', 'in_app',
       jsonb_build_object('period','2026-06'),
       null, now() - interval '1 day', now()),
    (v_uids[1], 'goal_achieved',   'in_app',
       jsonb_build_object('goal_name','新款手机'),
       now() - interval '10 days', now() - interval '17 days', now()),
    (v_uids[1], 'succession',      'in_app',
       jsonb_build_object('applicant','阿强','family_name','示例之家'),
       null, now() - interval '3 hours', now()),
    (v_uids[2], 'goal_achieved',   'in_app',
       jsonb_build_object('goal_name','新款手机'),
       null, now() - interval '17 days', now()),
    (v_uids[5], 'budget_alert',    'in_app',
       jsonb_build_object('text','餐饮 本月预算已用 93%','period','2026-07'),
       null, now() - interval '5 hours', now());

  -- 待处理继任申请：阿强（dev.c）发起，异议期 7 天内（与上面 succession 通知呼应）
  insert into public.succession_requests (family_id, applicant_user_id, objection_deadline, status)
    values (v_family_id, v_uids[3], now() + interval '7 days', 'pending');

  -- ════════════════════════════════════════════════════════════════════════
  -- 10) 通知偏好 / 记账偏好（部分用户显式落行，其余走客户端默认回落）
  -- ════════════════════════════════════════════════════════════════════════
  -- dev.b 关掉预算预警 + 月度总结提醒，其余保持
  insert into public.notification_preferences
    (user_id, family_activity, budget_alert, savings_progress, monthly_summary, member_change, account_security)
    values (v_uids[2], true, false, true, false, true, true);

  -- dev.a：金额隐私开、自定义报表卡片排序/隐藏、显示月度总结横幅
  insert into public.accounting_preferences
    (user_id, default_txn_type, after_record_behavior, amount_privacy, report_card_order, report_card_hidden, show_monthly_summary_entry)
    values (v_uids[1], 'expense', 'close', true,
            array['trend','expense_category','member','balance_rate','top_expenses'],
            array['cumulative','category_mom','income_structure'],
            true);
  -- dev.b：默认记收入、记完继续记下一笔
  insert into public.accounting_preferences
    (user_id, default_txn_type, after_record_behavior, amount_privacy)
    values (v_uids[2], 'income', 'continue', false);

  -- ════════════════════════════════════════════════════════════════════════
  -- 11) 意见反馈（不同用户 / 类型）
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.feedback (user_id, family_id, type, content, contact_ok, device, status) values
    (v_uids[1], v_family_id, 'feature', '希望增加把账单导出为 Excel 的功能，方便报销贴发票。', true,
       jsonb_build_object('app_version','1.0.0','build','100','platform','ios','os_version','18.0','device_model','iPhone16,2'), 'open'),
    (v_uids[2], v_family_id, 'bug',     '切换家庭后首页金额偶尔不刷新，要下拉一次才更新。', true,
       jsonb_build_object('app_version','1.0.0','build','100','platform','ios','os_version','17.5','device_model','iPhone15,3'), 'in_progress'),
    (v_uids[3], v_family_id, 'suggestion', '预算超支的提醒能不能加一个声音或者震动？容易漏看。', false,
       jsonb_build_object('app_version','1.0.0','build','100','platform','android','os_version','15','device_model','Pixel 8'), 'open');

  -- ════════════════════════════════════════════════════════════════════════
  -- 12) 邀请码（有效 / 过期 / 撤销 三态）
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.invitations (family_id, code, expires_at, status) values
    (v_family_id, 'HB2026', now() + interval '24 hours', 'valid'),
    (v_family_id, 'OLD999', now() - interval '1 day',    'expired'),
    (v_family_id, 'REV555', now() + interval '12 hours', 'revoked');

  -- ════════════════════════════════════════════════════════════════════════
  -- 13) 推送设备令牌（dev.a 一台 iOS）
  -- ════════════════════════════════════════════════════════════════════════
  insert into public.device_tokens (token, user_id, platform, provider)
    values ('ExponentPushToken[DEV-A-MOCK-000000001]', v_uids[1], 'ios', 'expo');

  raise notice 'HomeBook dev seed 完成：家庭 % / 5 名成员 / 全量场景已灌入。', v_family_id;
end
$seed$;

-- ── 验证：跑完可看这几行确认灌入成功 ────────────────────────────────────────
select 'users'        as entity, count(*) from auth.users        where email like 'dev.%@homebook.test'
union all select 'members',      count(*) from public.memberships where family_id = 'f0000000-0000-0000-0000-0000000000f1'
union all select 'transactions', count(*) from public.transactions where family_id = 'f0000000-0000-0000-0000-0000000000f1'
union all select 'savings_goals',count(*) from public.savings_goals where family_id = 'f0000000-0000-0000-0000-0000000000f1'
union all select 'budgets',      count(*) from public.budgets     where family_id = 'f0000000-0000-0000-0000-0000000000f1'
union all select 'recurring',    count(*) from public.recurring_transactions where family_id = 'f0000000-0000-0000-0000-0000000000f1'
union all select 'notifications',count(*) from public.notifications where user_id in
  ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555');
