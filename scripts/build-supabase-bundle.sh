#!/usr/bin/env bash
# 重新生成 supabase/_bundle.sql。
#
# _bundle.sql 是「首次建库」用的整段脚本：把 supabase/migrations/ 下所有迁移
# 按文件名（= 时间）顺序拼接，整体包在一个 begin;/commit; 事务里，便于在
# 自托管实例的 Studio → SQL Editor 一次性粘贴执行。
#
# 请勿手改 _bundle.sql —— 改迁移后重跑本脚本即可，避免漏合并导致建库缺表/缺策略。
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
mig_dir="$repo_root/supabase/migrations"
out="$repo_root/supabase/_bundle.sql"

# 按文件名（字典序 = 时间序）收集迁移。
shopt -s nullglob
migrations=("$mig_dir"/*.sql)
shopt -u nullglob

if [ "${#migrations[@]}" -eq 0 ]; then
  echo "未在 $mig_dir 找到任何 .sql 迁移" >&2
  exit 1
fi
count="${#migrations[@]}"

{
  printf -- '-- 家账 HomeBook · 全量建库脚本（%s 个迁移按序合并）\n' "$count"
  printf -- '-- 用法：在自托管实例的 Studio → SQL Editor 整段粘贴执行一次。\n'
  printf -- '-- 全程包在一个事务里，任一步出错整体回滚，便于安全重试。\n'
  printf -- '-- 注意：表无 IF NOT EXISTS，仅供首次建库；重复执行会因对象已存在而报错（属预期）。\n'
  printf -- '-- 本文件由 scripts/build-supabase-bundle.sh 自动生成，请勿手改；改迁移后重跑脚本。\n'
  printf -- '\n'
  printf -- 'begin;\n'

  for f in "${migrations[@]}"; do
    name="$(basename "$f")"
    printf -- '\n'
    printf -- '-- ============================================================\n'
    printf -- '-- >>> migrations/%s\n' "$name"
    printf -- '-- ============================================================\n'
    # 迁移正文：去掉结尾的空行，再补一个换行，使块间恰好空一行。
    awk 'NF{last=NR} {line[NR]=$0} END{for(i=1;i<=last;i++) print line[i]}' "$f"
  done

  printf -- '\n'
  printf -- 'commit;\n'
} > "$out"

echo "已生成 $out（合并 $count 个迁移）。"
