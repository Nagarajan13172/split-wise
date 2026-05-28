#!/usr/bin/env bash
# End-to-end smoke for Phase 5 receipts + itemized expenses.
# Walks:
#   1. Two users form a group.
#   2. Alice creates a receipt scan + presigned upload URL.
#   3. Script uploads a tiny PNG via the presigned URL (MinIO).
#   4. Script enqueues OCR; worker (stub provider) parses and marks PARSED.
#   5. Script polls until PARSED, asserts parsedTotal is present.
#   6. Script asserts a RECEIPT_READY notification row exists for Alice.
#   7. Alice creates an ITEMIZED expense linked to that scan.
#   8. Script asserts the expense.shares roll up to the expected total.
#
# Pre-reqs (all already part of `pnpm dev`):
#   - docker compose up (postgres + redis + minio)
#   - api running on :4000
#   - worker running with OCR_PROVIDER=stub (default)
#
# Run:  ./scripts/smoke-receipts.sh
set -euo pipefail

API="${API:-http://localhost:4000}"
ts="$(date +%s)"
PASSWORD="receipttest-pw-2026"

note() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
fail() { printf "  \033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }

post() {
  local proc="$1" body="$2" token="${3:-}"
  if [[ -n "$token" ]]; then
    curl -sS -X POST "${API}/trpc/${proc}" -H 'content-type: application/json' \
      -H "authorization: Bearer $token" --data "{\"json\":${body}}"
  else
    curl -sS -X POST "${API}/trpc/${proc}" -H 'content-type: application/json' \
      --data "{\"json\":${body}}"
  fi
}
qry() {
  local proc="$1" input="$2" token="${3:-}"
  local enc; enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote('{\"json\":'+sys.argv[1]+'}'))" "$input")
  if [[ -n "$token" ]]; then
    curl -sS "${API}/trpc/${proc}?input=${enc}" -H "authorization: Bearer $token"
  else
    curl -sS "${API}/trpc/${proc}?input=${enc}"
  fi
}

signup() {
  local email="$1" name="$2"
  local res; res=$(post auth.signup \
    "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"displayName\":\"$name\",\"homeCurrency\":\"USD\"}")
  echo "$res" | jq -er .result.data.json.accessToken \
    || { echo "  signup failed: $res" >&2; exit 1; }
}
me_id() { qry auth.me '{}' "$1" | jq -er .result.data.json.id; }

docker exec splitwise-redis sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del" >/dev/null 2>&1 || true

note "1) Sign up Alice + Bob, form a group"
A_TOK=$(signup "alice+r${ts}@example.com" "Alice")
B_TOK=$(signup "bob+r${ts}@example.com" "Bob")
A_ID=$(me_id "$A_TOK"); B_ID=$(me_id "$B_TOK")
G=$(post groups.create "{\"name\":\"Receipts $ts\",\"defaultCurrency\":\"USD\",\"simplifyDebts\":true}" "$A_TOK")
GID=$(echo "$G" | jq -er .result.data.json.id)
INV=$(post groups.createInvite "{\"groupId\":\"$GID\",\"expiresInHours\":24}" "$A_TOK")
URL=$(echo "$INV" | jq -er .result.data.json.url)
TOKEN=$(basename "$URL" | python3 -c "import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read().strip()))")
post groups.acceptInvite "{\"token\":\"$TOKEN\"}" "$B_TOK" >/dev/null
ok "group with 2 members"

note "2) Alice requests a presigned upload URL"
# Tiny 1x1 PNG (89 bytes). Worker stub provider ignores content but the API
# still validates contentType + byteSize, and we need *something* in S3.
TMPDIR=$(mktemp -d)
PNG="$TMPDIR/receipt.png"
python3 - <<PY > "$PNG"
import sys, base64
data = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABXvMqOgAAAABJRU5ErkJggg=="
)
sys.stdout.buffer.write(data)
PY
BYTES=$(stat -f%z "$PNG" 2>/dev/null || stat -c%s "$PNG")
PRES=$(post receipts.createUploadUrl "{\"contentType\":\"image/png\",\"byteSize\":${BYTES}}" "$A_TOK")
RSID=$(echo "$PRES" | jq -er .result.data.json.receiptScanId) || fail "createUploadUrl: $PRES"
UPLOAD=$(echo "$PRES" | jq -er .result.data.json.uploadUrl)
ok "scan id=$RSID"

note "3) PUT the image bytes to the presigned MinIO URL"
HTTP=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT "$UPLOAD" \
  -H 'content-type: image/png' --data-binary "@$PNG")
[[ "$HTTP" == "200" ]] || fail "S3 PUT expected 200, got $HTTP"
ok "uploaded $BYTES bytes"

note "4) Enqueue OCR + poll until PARSED"
post receipts.enqueue "{\"receiptScanId\":\"$RSID\"}" "$A_TOK" >/dev/null
STATUS=""
for i in $(seq 1 30); do
  SCAN=$(qry receipts.get "{\"receiptScanId\":\"$RSID\"}" "$A_TOK")
  STATUS=$(echo "$SCAN" | jq -r .result.data.json.status)
  [[ "$STATUS" == "PARSED" || "$STATUS" == "FAILED" ]] && break
  sleep 1
done
[[ "$STATUS" == "PARSED" ]] || fail "expected PARSED, got $STATUS (scan: $SCAN)"
PT=$(echo "$SCAN" | jq -r .result.data.json.parsedTotal)
[[ "$PT" != "null" && -n "$PT" ]] || fail "parsedTotal missing: $SCAN"
ok "PARSED · parsedTotal=$PT"

note "5) Notification row written"
# We don't yet expose a notifications.list endpoint, so check via psql directly.
NOTIF_COUNT=$(docker exec splitwise-postgres psql -U splitwise -d splitwise -tAc \
  "select count(*) from \"Notification\" where \"userId\"='$A_ID' and kind='RECEIPT_READY';")
[[ "${NOTIF_COUNT// /}" -ge 1 ]] || fail "expected ≥1 RECEIPT_READY notification, got $NOTIF_COUNT"
ok "RECEIPT_READY notification row exists"

note "6) Alice creates an ITEMIZED expense linked to that scan"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EXP=$(post expenses.create "$(cat <<JSON
{"groupId":"$GID","paidById":"$A_ID","description":"Dinner from receipt","amount":"56.94","currency":"USD","occurredAt":"$NOW","splitType":"ITEMIZED","items":[{"label":"Margherita Pizza","amount":"18.50","quantity":1,"assigneeIds":["$A_ID"]},{"label":"Caesar Salad","amount":"12.00","quantity":1,"assigneeIds":["$B_ID"]},{"label":"Tiramisu","amount":"8.50","quantity":1,"assigneeIds":["$A_ID","$B_ID"]},{"label":"Sparkling Water","amount":"6.00","quantity":2,"assigneeIds":["$A_ID","$B_ID"]}],"tax":"3.94","tip":"8.00","tipDistribution":"PRO_RATA","receiptScanId":"$RSID"}
JSON
)" "$A_TOK")
EXP_ID=$(echo "$EXP" | jq -er .result.data.json.id) || fail "ITEMIZED create: $EXP"
ok "expense id=$EXP_ID"

note "7) GET the expense and check shares aggregate to 56.94"
DET=$(qry expenses.get "{\"expenseId\":\"$EXP_ID\"}" "$A_TOK")
SUM=$(echo "$DET" | jq -r '[.result.data.json.shares[].amount | tonumber] | add')
# Compare to 56.94 with 1c tolerance.
DIFF=$(python3 -c "print(abs($SUM - 56.94))")
python3 -c "import sys; sys.exit(0 if $DIFF <= 0.01 else 1)" \
  || fail "shares sum $SUM != 56.94"
ok "per-user shares roll up to total 56.94"

note "8) Receipt is CONFIRMED after expense.create"
SCAN=$(qry receipts.get "{\"receiptScanId\":\"$RSID\"}" "$A_TOK")
NEW_STATUS=$(echo "$SCAN" | jq -r .result.data.json.status)
[[ "$NEW_STATUS" == "CONFIRMED" ]] || fail "expected CONFIRMED, got $NEW_STATUS"
ok "receipt CONFIRMED"

printf "\n\033[1;32mALL GREEN ✓\033[0m  Phase 5 receipts + itemized split end-to-end works.\n"
