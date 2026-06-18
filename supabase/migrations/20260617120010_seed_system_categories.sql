-- 0010 · 系统预设分类（family_id = null, is_system = true）
-- ----------------------------------------------------------------------------
-- 起步默认集（待产品最终确认）。图标用 SF Symbols 名占位。
-- 储蓄两项为资金闭环 RPC 依赖项（按名称 '储蓄·目标存入' / '储蓄·目标取出' 查找），勿改名。
-- 幂等：on conflict 命中 categories_uniq_system_name 部分唯一索引时跳过。

insert into public.categories (family_id, name, icon, type, is_system, status) values
  -- 支出
  (null, '餐饮',   'fork.knife',                 'expense', true, 'active'),
  (null, '交通',   'car.fill',                   'expense', true, 'active'),
  (null, '购物',   'bag.fill',                   'expense', true, 'active'),
  (null, '居家',   'house.fill',                 'expense', true, 'active'),
  (null, '娱乐',   'gamecontroller.fill',        'expense', true, 'active'),
  (null, '医疗',   'cross.case.fill',            'expense', true, 'active'),
  (null, '教育',   'book.fill',                  'expense', true, 'active'),
  (null, '人情',   'gift.fill',                  'expense', true, 'active'),
  (null, '其他支出', 'ellipsis.circle.fill',      'expense', true, 'active'),
  -- 收入
  (null, '工资',   'dollarsign.circle.fill',     'income',  true, 'active'),
  (null, '奖金',   'star.fill',                  'income',  true, 'active'),
  (null, '理财',   'chart.line.uptrend.xyaxis',  'income',  true, 'active'),
  (null, '其他收入', 'ellipsis.circle.fill',      'income',  true, 'active'),
  -- 储蓄（资金闭环专用，RPC 依赖名称）
  (null, '储蓄·目标存入', 'arrow.down.circle.fill', 'expense', true, 'active'),
  (null, '储蓄·目标取出', 'arrow.up.circle.fill',   'income',  true, 'active')
on conflict do nothing;
