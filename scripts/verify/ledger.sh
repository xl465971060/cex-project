#!/usr/bin/env bash
# M1-T1 账务统一入口全旅程验证(L3):入账→幂等重放→冻结→解冻→冲正→越权拒绝
# 前置:cex-mysql 健康,api 已启动(pnpm --filter @cex/api dev),.env 含 ADMIN_TOKEN
# 金额单位:USDT 最小单位(1 USDT = 1000000)
set -euo pipefail
cd "$(dirname "$0")/../.."

API="${API:-http://localhost:4000}"
MYSQL_USER="${MYSQL_USER:-cex}"
MYSQL_PASS="${MYSQL_PASS:-cex_dev_123}"
MYSQL_DB="${MYSQL_DB:-cex}"
ADMIN_TOKEN="${ADMIN_TOKEN:-dev-admin-token}"
EMAIL="verify-ledger-$(date +%s)@test.local"
PW="Abcd1234"
TS=$(date +%s)

say() { printf "\n\033[1;36m[ledger.sh]\033[0m %s\n" "$*"; }
die() { printf "\033[1;31m[ledger.sh][FAIL]\033[0m %s\n" "$*"; exit 1; }

req() { # req <method> <path> <json> [token] [admin] → 打印 body,响应码存 CODE
  local method="$1" path="$2" body="${3:-}" token="${4:-}" admin="${5:-}"
  local args=(-s -o /tmp/resp.json -w '%{http_code}' -X "$method" "$API$path" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "$admin" ] && args+=(-H "x-admin-token: $admin")
  [ -n "$body" ] && args+=(-d "$body")
  curl "${args[@]}" > /tmp/resp_code
  cat /tmp/resp.json
  echo
}
codeOf() { cat /tmp/resp_code; }
sql() { docker exec cex-mysql mysql -u"$MYSQL_USER" -p"$MYSQL_PASS" -N -s "$MYSQL_DB" -e "$1" 2>/dev/null; }

# ── 0. 造一个真实用户(账务挂在用户上) ────────────────────────────────
say "0) 注册并登录拿 JWT"
req POST /auth/register/init "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" >/dev/null
[ "$(codeOf)" = "201" ] || [ "$(codeOf)" = "200" ] || die "register/init 失败: $(codeOf)"
CODE_6=$(sql "SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'\$.code')) FROM MailLog WHERE \`to\`='$EMAIL' AND type='REGISTER_CODE' ORDER BY id DESC LIMIT 1")
[[ "$CODE_6" =~ ^[0-9]{6}$ ]] || die "未读到验证码: '$CODE_6'"
req POST /auth/register/confirm "{\"email\":\"$EMAIL\",\"code\":\"$CODE_6\"}" >/dev/null
[ "$(codeOf)" = "201" ] || die "register/confirm 失败: $(codeOf)"
LUID=$(sql "SELECT id FROM User WHERE email='$EMAIL'")
req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" >/dev/null
TOKEN=$(sed -n 's/.*"token":"\([^"]*\)".*/\1/p' /tmp/resp.json)
[ -n "$TOKEN" ] || die "登录未返回 token"
say "   → 用户就绪($LUID)✅"

op() { # op <op> <bizNo> <amount十进制> [附加json片段]
  local o="$1" no="$2" amt="$3" extra="${4:-}"
  req POST /ledger/ops "{\"op\":\"$o\",\"uid\":\"$LUID\",\"coin\":\"USDT\",\"bizNo\":\"$no\",\"amount\":\"$amt\"${extra:+,$extra}}" "" "$ADMIN_TOKEN"
}
usdt_bal() { sql "SELECT CONCAT(available,'/',frozen) FROM Asset WHERE uid='$LUID' AND coin='USDT'"; }

# ── 1. 管理端无令牌应 401 ────────────────────────────────────────────
say "1) 无 x-admin-token 调 /ledger/ops → 401"
req POST /ledger/ops "{\"op\":\"CREDIT\",\"uid\":\"$LUID\",\"coin\":\"USDT\",\"bizNo\":\"x-$TS\",\"amount\":\"1\"}" >/dev/null
[ "$(codeOf)" = "401" ] || die "无令牌未拒绝: $(codeOf)"
say "   → AdminGuard 生效 ✅"

# ── 2. 入账 100 USDT ────────────────────────────────────────────────
say "2) CREDIT 100 USDT → available=100000000"
op CREDIT "l3-pay-$TS" "100" >/dev/null
[ "$(codeOf)" = "200" ] || die "credit 失败: $(codeOf) $(cat /tmp/resp.json)"
[ "$(usdt_bal)" = "100000000/0" ] || die "入账后余额错: $(usdt_bal)"
say "   → 余额 $(usdt_bal) ✅"

# ── 3. 幂等重放同一单号 → 余额不变 ───────────────────────────────────
say "3) 重放同 bizNo(幂等)→ 返回原流水,余额不变"
op CREDIT "l3-pay-$TS" "100" >/dev/null
[ "$(codeOf)" = "200" ] || die "幂等重放失败: $(codeOf)"
[ "$(sed -n 's/.*"type":"\([^"]*\)".*/\1/p' /tmp/resp.json)" = "CREDIT" ] || die "重放未返回原流水"
[ "$(usdt_bal)" = "100000000/0" ] || die "重放改变了余额: $(usdt_bal)"
N=$(sql "SELECT COUNT(*) FROM AssetFlow WHERE bizNo='l3-pay-$TS'")
[ "$N" = "1" ] || die "同单号流水条数=$N,幂等被破坏"
say "   → 只记 1 笔,余额未变 ✅"

# ── 4. 冻结 30 → 70/30(线路图 L3 断言) ──────────────────────────────
say "4) FREEZE 30 USDT → available=70000000 frozen=30000000"
op FREEZE "l3-frz-$TS" "30" >/dev/null
[ "$(codeOf)" = "200" ] || die "freeze 失败: $(codeOf)"
[ "$(usdt_bal)" = "70000000/30000000" ] || die "冻结后余额错: $(usdt_bal)"
say "   → 余额 $(usdt_bal)(总额守恒 100)✅"

# ── 5. 流水快照核验(可用/冻结双级 before/after) ──────────────────────
say "5) 流水含双级余额快照"
SNAP=$(sql "SELECT CONCAT(availBefore,'>',availAfter,',',frozenBefore,'>',frozenAfter) FROM AssetFlow WHERE bizNo='l3-frz-$TS'")
[ "$SNAP" = "100000000>70000000,0>30000000" ] || die "快照错: $SNAP"
say "   → 快照 $SNAP ✅"

# ── 6. 解冻 30 → 100/0 ──────────────────────────────────────────────
say "6) UNFREEZE 30 USDT → 回到 100/0"
op UNFREEZE "l3-unfrz-$TS" "30" >/dev/null
[ "$(codeOf)" = "200" ] || die "unfreeze 失败: $(codeOf)"
[ "$(usdt_bal)" = "100000000/0" ] || die "解冻后余额错: $(usdt_bal)"
say "   → 余额 $(usdt_bal) ✅"

# ── 7. 冲正入账 → 回到 0/0,原流水不变 ────────────────────────────────
say "7) REVERSE 入账单 → REVERSAL 流水,余额 0/0,原流水未被修改"
BEFORE=$(sql "SELECT CONCAT_WS('|',availDelta,frozenDelta,availAfter) FROM AssetFlow WHERE bizNo='l3-pay-$TS'")
req POST /ledger/reverse "{\"originalBizNo\":\"l3-pay-$TS\",\"newBizNo\":\"l3-rev-$TS\",\"reason\":\"L3 验证\"}" "" "$ADMIN_TOKEN" >/dev/null
[ "$(codeOf)" = "200" ] || die "reverse 失败: $(codeOf) $(cat /tmp/resp.json)"
[ "$(usdt_bal)" = "0/0" ] || die "冲正后余额错: $(usdt_bal)"
AFTER=$(sql "SELECT CONCAT_WS('|',availDelta,frozenDelta,availAfter) FROM AssetFlow WHERE bizNo='l3-pay-$TS'")
[ "$BEFORE" = "$AFTER" ] || die "原流水被修改: $BEFORE → $AFTER"
RT=$(sql "SELECT type FROM AssetFlow WHERE bizNo='l3-rev-$TS'")
[ "$RT" = "REVERSAL" ] || die "冲正流水类型错: $RT"
say "   → 原流水不变($BEFORE),冲正类型 REVERSAL ✅"

# ── 8. 余额穿负拒绝 ─────────────────────────────────────────────────
say "8) 空账户 DEBIT → 422 INSUFFICIENT_BALANCE"
op DEBIT "l3-neg-$TS" "1" >/dev/null
[ "$(codeOf)" = "422" ] || die "余额不足未拒绝: $(codeOf)"
say "   → 422 拒绝 ✅"

# ── 9. 未知币种 / 精度超限 ───────────────────────────────────────────
say "9) 未知币种 DOGE → 400 UNKNOWN_COIN;超精度 0.0000001 → 400"
op CREDIT "l3-doge-$TS" "1" >/dev/null
req POST /ledger/ops "{\"op\":\"CREDIT\",\"uid\":\"$LUID\",\"coin\":\"DOGE\",\"bizNo\":\"l3-doge2-$TS\",\"amount\":\"1\"}" "" "$ADMIN_TOKEN" >/dev/null
[ "$(codeOf)" = "400" ] || die "未知币种未拒绝: $(codeOf)"
op CREDIT "l3-prec-$TS" "0.0000001" >/dev/null
[ "$(codeOf)" = "400" ] || die "精度超限未拒绝: $(codeOf)"
say "   → 400 拒绝 ✅"

printf "\n\033[1;32m[ledger.sh] 全部 9 步通过 ✅  M1-T1 账务统一入口 L3 旅程完成\033[0m\n"
