-- 自定义分类识别色：保存颜色令牌，由客户端按浅色 / 深色主题解析实际色值。
-- 系统分类继续使用既有的名称映射；历史自定义分类按 id 稳定分配一色，避免升级后仍显示灰色。

alter table public.categories
  add column color_key text;

alter table public.categories
  add constraint categories_color_key_check
  check (
    color_key is null
    or color_key in (
      'food', 'apricot', 'coral', 'shopping', 'rose', 'entertainment',
      'plum', 'lavender', 'periwinkle', 'transit', 'sky', 'education',
      'aqua', 'mint', 'home', 'olive', 'ochre', 'amber',
      'saving', 'sand', 'medical', 'incomeGeneric', 'slate', 'social'
    )
  );

with palette as (
  select array[
    'food', 'apricot', 'coral', 'shopping', 'rose', 'entertainment',
    'plum', 'lavender', 'periwinkle', 'transit', 'sky', 'education',
    'aqua', 'mint', 'home', 'olive', 'ochre', 'amber',
    'saving', 'sand', 'medical', 'incomeGeneric', 'slate', 'social'
  ]::text[] as keys
)
update public.categories as category
set color_key = palette.keys[1 + mod((hashtextextended(category.id::text, 0) & 2147483647), 24)::int]
from palette
where not category.is_system
  and category.color_key is null;

alter table public.categories
  add constraint categories_custom_color_key_required
  check (is_system or color_key is not null);
