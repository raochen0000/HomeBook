#!/usr/bin/env bash
# 开发期：用测试账号登录拿 access_token，并可选地用它发起已鉴权的 REST 调用。
# 仅用于开发/调试。读取项目根目录 .env 里的 EXPO_PUBLIC_SUPABASE_URL / _KEY。
#
# 用法：
#   scripts/dev-token.sh                                  # 仅打印 access_token
#   scripts/dev-token.sh GET  /rest/v1/families?select=*  # 已鉴权 GET
#   scripts/dev-token.sh POST /rest/v1/rpc/create_family '{"p_name":"家","p_timezone":"Asia/Shanghai"}'
#
# 切换账号：DEV_EMAIL=dev.b@homebook.test DEV_PASSWORD=devtest123456 scripts/dev-token.sh ...
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; source "$ROOT/.env"; set +a

BASE="${EXPO_PUBLIC_SUPABASE_URL:?缺少 EXPO_PUBLIC_SUPABASE_URL}"
KEY="${EXPO_PUBLIC_SUPABASE_KEY:?缺少 EXPO_PUBLIC_SUPABASE_KEY}"
EMAIL="${DEV_EMAIL:-dev.a@homebook.test}"
PASSWORD="${DEV_PASSWORD:-devtest123456}"

login() {
  curl -s --max-time 20 "$BASE/auth/v1/token?grant_type=password" \
    -H "apikey: $KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
}
signup() {
  curl -s --max-time 20 "$BASE/auth/v1/signup" \
    -H "apikey: $KEY" -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
}

RESP="$(login)"
TOKEN="$(printf '%s' "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)"
if [ -z "$TOKEN" ]; then
  RESP="$(signup)"   # 账号不存在则注册（autoconfirm 已开）
  TOKEN="$(printf '%s' "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null || true)"
fi
if [ -z "$TOKEN" ]; then
  echo "登录失败：$RESP" >&2; exit 1
fi

# 无额外参数：只打印 token
if [ "$#" -eq 0 ]; then
  echo "$TOKEN"; exit 0
fi

# 有参数：发起已鉴权请求
METHOD="$1"; PATH_="$2"; DATA="${3:-}"
ARGS=(-s --max-time 20 -X "$METHOD" "$BASE$PATH_"
  -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
[ -n "$DATA" ] && ARGS+=(-d "$DATA")
curl "${ARGS[@]}"
echo
