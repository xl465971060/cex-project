#!/usr/bin/env bash
# M1-T2 鉴权全旅程验证(L3):注册→验证码→建号→登录→me→忘记密码→重置→旧 token 失效
# 前置:cex-mysql / cex-redis 健康,api 已启动(make api 或 pnpm --filter @cex/api dev)
# 验证码从 MailLog outbox 表读取(M1 决策:邮件只落库)
set -euo pipefail
cd "$(dirname "$0")/../.."

API="${API:-http://localhost:4000}"
MYSQL_USER="${MYSQL_USER:-cex}"
MYSQL_PASS="${MYSQL_PASS:-cex_dev_123}"
MYSQL_DB="${MYSQL_DB:-cex}"
EMAIL="verify-auth-$(date +%s)@test.local"
PW="Abcd1234"

say() { printf "\n\033[1;36m[auth.sh]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[auth.sh][FAIL]\033[0m %s\n" "$*"; exit 1; }

req() { # req <method> <path> <json> [token] → 打印 body,响应码存 CODE
  local method="$1" path="$2" body="${3:-}" token="${4:-}"
  local args=(-s -o /tmp/resp.json -w '%{http_code}' -X "$method" "$API$path" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}" > /tmp/resp_code
  cat /tmp/resp.json
  echo
}
codeOf() { cat /tmp/resp_code; }

sql() { docker exec cex-mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASS" -N -s "$MYSQL_DB" -e "$1" 2>/dev/null; }

say "邮箱: $EMAIL"

# ── 1. 注册阶段一:发验证码 ────────────────────────────────────────────
say "1) POST /auth/register/init(密码弱应 400)"
req POST /auth/register/init "{\"email\":\"$EMAIL\",\"password\":\"123\"}"  >/dev/null
[ "$(codeOf)" = "400" ] || die "弱密码未拒绝,实际 $(codeOf)"
say "   → 弱密码 400 拒绝 ✅"

req POST /auth/register/init "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" >/dev/null
[ "$(codeOf)" = "201" ] || [ "$(codeOf)" = "200" ] || die "register/init 失败,实际 $(codeOf)"
say "   → 验证码已发送(邮件落 outbox)✅"

# ── 2. 从 MailLog 读验证码 ───────────────────────────────────────────
CODE_6=$(sql "SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.code')) FROM MailLog WHERE \`to\`='$EMAIL' AND type='REGISTER_CODE' ORDER BY id DESC LIMIT 1")
[[ "$CODE_6" =~ ^[0-9]{6}$ ]] || die "未从 MailLog 读到验证码: '$CODE_6'"
say "2) MailLog 读到验证码 $CODE_6 ✅"

# ── 3. 注册阶段二:确认建号 ───────────────────────────────────────────
say "3) POST /auth/register/confirm(错码应 400)"
req POST /auth/register/confirm "{\"email\":\"$EMAIL\",\"code\":\"000000\"}" >/dev/null
[ "$(codeOf)" = "400" ] || die "错码未拒绝,实际 $(codeOf)"
say "   → 错码 400 ✅"

UID_JSON=$(req POST /auth/register/confirm "{\"email\":\"$EMAIL\",\"code\":\"$CODE_6\"}")
[ "$(codeOf)" = "201" ] || [ "$(codeOf)" = "200" ] || die "register/confirm 失败,实际 $(codeOf): $(cat /tmp/resp.json)"
NEW_UID=$(echo "$UID_JSON" | grep -o '"uid":"[^"]*' | cut -d'"' -f4)
[ -n "$NEW_UID" ] || die "未返回 uid: $UID_JSON"
say "   → 建号成功 uid=$NEW_UID ✅"

# ── 4. 登录 ─────────────────────────────────────────────────────────
say "4) POST /auth/login(错密码应 401)"
req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"Wrong999\"}" >/dev/null
[ "$(codeOf)" = "401" ] || die "错密码未拒绝,实际 $(codeOf)"
say "   → 错密码 401 INVALID_CREDENTIALS ✅"

LOGIN=$(req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}")
[ "$(codeOf)" = "200" ] || [ "$(codeOf)" = "201" ] || die "登录失败,实际 $(codeOf)"
TOKEN=$(echo "$LOGIN" | grep -o '"token":"[^"]*' | cut -d'"' -f4)
[ -n "$TOKEN" ] || die "未返回 token: $LOGIN"
say "   → 登录成功,拿到 JWT ✅"

# ── 5. me(带 token) ────────────────────────────────────────────────
say "5) GET /auth/me(无 token 401,带 token 200)"
req GET /auth/me "" >/dev/null
[ "$(codeOf)" = "401" ] || die "无 token 应 401,实际 $(codeOf)"
req GET /auth/me "" "$TOKEN" >/dev/null
[ "$(codeOf)" = "200" ] || die "带 token 应 200,实际 $(codeOf)"
say "   → me 返回当前用户 ✅"

# ── 6. 忘记密码 → 重置 → 旧 token 失效 ───────────────────────────────
say "6) POST /auth/password/forgot + /auth/password/reset"
req POST /auth/password/forgot "{\"email\":\"$EMAIL\"}" >/dev/null
[ "$(codeOf)" = "200" ] || die "forgot 失败,实际 $(codeOf)"
RESET_CODE=$(sql "SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.code')) FROM MailLog WHERE \`to\`='$EMAIL' AND type='RESET_CODE' ORDER BY id DESC LIMIT 1")
[[ "$RESET_CODE" =~ ^[0-9]{6}$ ]] || die "未读到重置码"
req POST /auth/password/reset "{\"email\":\"$EMAIL\",\"code\":\"$RESET_CODE\",\"newPassword\":\"New56789\"}" >/dev/null
[ "$(codeOf)" = "200" ] || die "reset 失败,实际 $(codeOf)"
say "   → 密码已重置 ✅"

say "7) 旧 token 应 401 SESSION_EXPIRED(tokenVersion 全端失效)"
req GET /auth/me "" "$TOKEN" >/dev/null
[ "$(codeOf)" = "401" ] || die "旧 token 仍有效,实际 $(codeOf)"
say "   → 旧 token 401 ✅"

say "8) 新密码可登录,且 UserSecurity.forbiddenUntil = 24h 禁提"
req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"New56789\"}" >/dev/null
[ "$(codeOf)" = "200" ] || [ "$(codeOf)" = "201" ] || die "新密码登录失败,实际 $(codeOf)"
FU=$(sql "SELECT forbiddenUntil IS NOT NULL FROM UserSecurity WHERE uid='$NEW_UID'")
[ "$FU" = "1" ] || die "forbiddenUntil 未设置"
say "   → 新密码登录 ✅ / 禁提窗口已设置 ✅"

echo
say "🎉 M1-T2 鉴权全旅程 8/8 通过"
