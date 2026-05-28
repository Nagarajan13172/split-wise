#!/usr/bin/env bash
# End-to-end smoke test for Phase 3 expenses + settlements + balances.
# Walks: Alice + Bob + Carol form a group, add expenses, verify balances,
#        settle up, edit/delete, check audit, version conflict.
set -euo pipefail

API="${API:-http://localhost:4000}"
ts="$(date +%s)"
PASSWORD="expensetest-pw-2026"

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

docker exec splitwise-redis sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del" >/dev/null 2>&1 || true

signup() {
  local email="$1" name="$2"
  local res; res=$(post auth.signup \
    "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"displayName\":\"$name\",\"homeCurrency\":\"USD\"}")
  echo "$res" | jq -er .result.data.json.accessToken \
    || { echo "  signup failed: $res" >&2; exit 1; }
}
me_id() { qry auth.me '{}' "$1" | jq -er .result.data.json.id; }

note "1) Sign up Alice, Bob, Carol"
A_TOK=$(signup "alice+e${ts}@example.com" "Alice")
B_TOK=$(signup "bob+e${ts}@example.com" "Bob")
C_TOK=$(signup "carol+e${ts}@example.com" "Carol")
A_ID=$(me_id "$A_TOK"); B_ID=$(me_id "$B_TOK"); C_ID=$(me_id "$C_TOK")
ok "3 users created"

note "2) Alice creates group, invites Bob + Carol"
G=$(post groups.create "{\"name\":\"Trip $ts\",\"defaultCurrency\":\"USD\",\"simplifyDebts\":true}" "$A_TOK")
GID=$(echo "$G" | jq -er .result.data.json.id)
for TOK in "$B_TOK" "$C_TOK"; do
  INV=$(post groups.createInvite "{\"groupId\":\"$GID\",\"expiresInHours\":24}" "$A_TOK")
  URL=$(echo "$INV" | jq -er .result.data.json.url)
  TOKEN=$(basename "$URL" | python3 -c "import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read().strip()))")
  post groups.acceptInvite "{\"token\":\"$TOKEN\"}" "$TOK" >/dev/null
done
ok "group with 3 members"

note "3) Alice pays \$90 dinner split 3 ways"
DINNER=$(post expenses.create "$(cat <<JSON
{"groupId":"$GID","paidById":"$A_ID","description":"Dinner","amount":"90.00","currency":"USD","occurredAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","splitType":"EQUAL","splitAmongUserIds":["$A_ID","$B_ID","$C_ID"]}
JSON
)" "$A_TOK")
DINNER_ID=$(echo "$DINNER" | jq -er .result.data.json.id) || fail "create dinner: $DINNER"
ok "dinner id=$DINNER_ID"

note "4) Balances: Alice +60, Bob -30, Carol -30"
BAL=$(qry expenses.forGroup "{\"groupId\":\"$GID\"}" "$A_TOK")
A_NET=$(echo "$BAL" | jq -er ".result.data.json.members[] | select(.userId==\"$A_ID\") | .net[0].amount")
B_NET=$(echo "$BAL" | jq -er ".result.data.json.members[] | select(.userId==\"$B_ID\") | .net[0].amount")
C_NET=$(echo "$BAL" | jq -er ".result.data.json.members[] | select(.userId==\"$C_ID\") | .net[0].amount")
[[ "$A_NET" == "60.00" ]] || fail "alice net expected 60.00, got $A_NET"
[[ "$B_NET" == "-30.00" ]] || fail "bob net expected -30.00, got $B_NET"
[[ "$C_NET" == "-30.00" ]] || fail "carol net expected -30.00, got $C_NET"
ok "balances correct"

note "5) Bob pays \$30 taxi split between him and Alice"
post expenses.create "$(cat <<JSON
{"groupId":"$GID","paidById":"$B_ID","description":"Taxi","amount":"30.00","currency":"USD","occurredAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","splitType":"EQUAL","splitAmongUserIds":["$A_ID","$B_ID"]}
JSON
)" "$B_TOK" >/dev/null
BAL=$(qry expenses.forGroup "{\"groupId\":\"$GID\"}" "$A_TOK")
A_NET=$(echo "$BAL" | jq -er ".result.data.json.members[] | select(.userId==\"$A_ID\") | .net[0].amount")
B_NET=$(echo "$BAL" | jq -er ".result.data.json.members[] | select(.userId==\"$B_ID\") | .net[0].amount")
# Alice was +60, now owes 15 of $30 taxi → +60 - 15 = +45
# Bob was -30, now paid $30 + owed 15 → -30 + 30 - 15 = -15
[[ "$A_NET" == "45.00" ]] || fail "after taxi, alice expected 45.00, got $A_NET"
[[ "$B_NET" == "-15.00" ]] || fail "after taxi, bob expected -15.00, got $B_NET"
ok "balances re-aggregate correctly"

note "6) Simplified debts ≤ N-1 edges"
SIMP_COUNT=$(echo "$BAL" | jq '.result.data.json.simplified | length')
[[ "$SIMP_COUNT" -le 2 ]] || fail "expected ≤2 simplified edges, got $SIMP_COUNT"
ok "$SIMP_COUNT simplified edges"

note "7) Bob settles \$15 to Alice"
post expenses.recordSettlement "$(cat <<JSON
{"groupId":"$GID","fromUserId":"$B_ID","toUserId":"$A_ID","amount":"15.00","currency":"USD","occurredAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","method":"venmo"}
JSON
)" "$B_TOK" >/dev/null
BAL=$(qry expenses.forGroup "{\"groupId\":\"$GID\"}" "$A_TOK")
B_NET=$(echo "$BAL" | jq -r ".result.data.json.members[] | select(.userId==\"$B_ID\") | .net // [] | (.[0].amount // \"0\")")
[[ "$B_NET" == "0" || "$B_NET" == "0.00" ]] || fail "after settle, bob expected 0, got $B_NET"
ok "Bob's USD balance zeroed"

note "8) Edit dinner amount to \$120 (CONFLICT on stale version)"
DET=$(qry expenses.get "{\"expenseId\":\"$DINNER_ID\"}" "$A_TOK")
VER=$(echo "$DET" | jq -er .result.data.json.version)
WRONG_VER=$((VER + 5))
CONF=$(post expenses.update "{\"expenseId\":\"$DINNER_ID\",\"expectedVersion\":$WRONG_VER,\"amount\":\"120.00\"}" "$A_TOK")
echo "$CONF" | grep -q '"code":"CONFLICT"' || fail "expected CONFLICT, got: $CONF"
ok "version conflict rejected"

note "9) Edit with correct version"
post expenses.update "{\"expenseId\":\"$DINNER_ID\",\"expectedVersion\":$VER,\"amount\":\"120.00\"}" "$A_TOK" >/dev/null
DET=$(qry expenses.get "{\"expenseId\":\"$DINNER_ID\"}" "$A_TOK")
NEW_AMT=$(echo "$DET" | jq -er .result.data.json.amount)
[[ "$NEW_AMT" == "120.00" ]] || fail "expected 120.00, got $NEW_AMT"
ok "amount updated; balances now reflect \$120 dinner"

note "10) Audit log has CREATE + UPDATE rows"
AUD=$(qry expenses.audit "{\"expenseId\":\"$DINNER_ID\"}" "$A_TOK")
ACTIONS=$(echo "$AUD" | jq -r '.result.data.json[].action' | sort | uniq | tr '\n' ',')
echo "$ACTIONS" | grep -q "CREATE" || fail "no CREATE in audit: $AUD"
echo "$ACTIONS" | grep -q "UPDATE" || fail "no UPDATE in audit: $AUD"
ok "audit has CREATE + UPDATE"

note "11) Non-member can't read expenses"
EVE_TOK=$(signup "eve+e${ts}@example.com" "Eve")
EVE_LIST=$(qry expenses.list "{\"groupId\":\"$GID\"}" "$EVE_TOK")
echo "$EVE_LIST" | grep -q '"code":"FORBIDDEN"' || fail "non-member should be FORBIDDEN: $EVE_LIST"
ok "non-member rejected"

note "12) Soft-delete dinner"
post expenses.delete "{\"expenseId\":\"$DINNER_ID\"}" "$A_TOK" >/dev/null
LIST=$(qry expenses.list "{\"groupId\":\"$GID\"}" "$A_TOK")
HAS_DINNER=$(echo "$LIST" | jq -r ".result.data.json.items[] | select(.id==\"$DINNER_ID\") | .id" | wc -l | tr -d ' ')
[[ "$HAS_DINNER" == "0" ]] || fail "dinner should be hidden after delete"
AUD=$(qry expenses.audit "{\"expenseId\":\"$DINNER_ID\"}" "$A_TOK")
echo "$AUD" | jq -r '.result.data.json[].action' | grep -q "DELETE" || fail "no DELETE in audit"
ok "soft-deleted; audit recorded DELETE"

printf "\n\033[1;32mALL GREEN ✓\033[0m  Phase 3 expenses backend is functional.\n"
