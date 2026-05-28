#!/usr/bin/env bash
# End-to-end smoke test for the Phase 2 groups + invites flow.
# Walks: Alice signs up -> creates group -> invites Bob by link ->
#        Bob signs up -> previews invite -> accepts -> both see group.
# Then: Alice removes Bob, Bob can't access, owner can't leave, group is deleted.
set -euo pipefail

API="${API:-http://localhost:4000}"

ts="$(date +%s)"
ALICE_EMAIL="alice+g${ts}@example.com"
BOB_EMAIL="bob+g${ts}@example.com"
PASSWORD="grouptest-password-2026"

note() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
fail() { printf "  \033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }

post() {
  local proc="$1" body="$2" token="${3:-}"
  if [[ -n "$token" ]]; then
    curl -sS -X POST "${API}/trpc/${proc}" \
      -H 'content-type: application/json' \
      -H "authorization: Bearer $token" \
      --data "{\"json\":${body}}"
  else
    curl -sS -X POST "${API}/trpc/${proc}" \
      -H 'content-type: application/json' \
      --data "{\"json\":${body}}"
  fi
}

qry() {
  local proc="$1" input="$2" token="${3:-}"
  # tRPC GET wants ?input={"json":...} URL-encoded
  local enc; enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote('{\"json\":'+sys.argv[1]+'}'))" "$input")
  if [[ -n "$token" ]]; then
    curl -sS "${API}/trpc/${proc}?input=${enc}" \
      -H "authorization: Bearer $token"
  else
    curl -sS "${API}/trpc/${proc}?input=${enc}"
  fi
}

# Reset rate-limit between runs.
docker exec splitwise-redis sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del" >/dev/null 2>&1 || true

note "1) Alice signs up"
ALICE_RES=$(post auth.signup "{\"email\":\"$ALICE_EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"Alice\",\"homeCurrency\":\"USD\"}")
ALICE_TOKEN=$(echo "$ALICE_RES" | jq -er .result.data.json.accessToken) || fail "alice signup: $ALICE_RES"
ok "alice token acquired"

note "2) Alice creates a group"
CREATE=$(post groups.create "{\"name\":\"Trip $ts\",\"defaultCurrency\":\"USD\",\"simplifyDebts\":true}" "$ALICE_TOKEN")
GROUP_ID=$(echo "$CREATE" | jq -er .result.data.json.id) || fail "create: $CREATE"
ok "group created id=$GROUP_ID"

note "3) Alice lists her groups"
LIST=$(qry groups.list '{}' "$ALICE_TOKEN")
COUNT=$(echo "$LIST" | jq '.result.data.json | length')
[[ "$COUNT" == "1" ]] || fail "expected 1 group, got $COUNT"
ok "alice sees 1 group"

note "4) Alice creates a multi-use invite link"
INV=$(post groups.createInvite "{\"groupId\":\"$GROUP_ID\",\"expiresInHours\":24}" "$ALICE_TOKEN")
INVITE_URL=$(echo "$INV" | jq -er .result.data.json.url) || fail "invite: $INV"
INVITE_TOKEN=$(basename "$INVITE_URL" | python3 -c "import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read().strip()))")
ok "invite token created"

note "5) Bob signs up"
BOB_RES=$(post auth.signup "{\"email\":\"$BOB_EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"Bob\",\"homeCurrency\":\"USD\"}")
BOB_TOKEN=$(echo "$BOB_RES" | jq -er .result.data.json.accessToken) || fail "bob signup: $BOB_RES"
ok "bob token acquired"

note "6) Bob previews invite (no auth required)"
PREV=$(qry groups.previewInvite "{\"token\":\"$INVITE_TOKEN\"}")
GROUP_NAME=$(echo "$PREV" | jq -er .result.data.json.groupName) || fail "preview: $PREV"
[[ "$GROUP_NAME" == "Trip $ts" ]] || fail "wrong group name back"
ok "preview shows group: $GROUP_NAME"

note "7) Bob accepts invite"
ACC=$(post groups.acceptInvite "{\"token\":\"$INVITE_TOKEN\"}" "$BOB_TOKEN")
ACC_GID=$(echo "$ACC" | jq -er .result.data.json.groupId) || fail "accept: $ACC"
[[ "$ACC_GID" == "$GROUP_ID" ]] || fail "accept returned wrong groupId"
ok "bob joined group"

note "8) Bob's group list now includes the group"
LIST=$(qry groups.list '{}' "$BOB_TOKEN")
COUNT=$(echo "$LIST" | jq '.result.data.json | length')
[[ "$COUNT" == "1" ]] || fail "bob expected 1 group, got $COUNT"
ok "bob sees 1 group"

note "9) Group detail shows both members"
DET=$(qry groups.get "{\"groupId\":\"$GROUP_ID\"}" "$ALICE_TOKEN")
MCOUNT=$(echo "$DET" | jq '.result.data.json.members | length')
[[ "$MCOUNT" == "2" ]] || fail "expected 2 members, got $MCOUNT"
ok "2 members"

note "10) Non-member can't read group"
EVE_RES=$(post auth.signup "{\"email\":\"eve+g${ts}@example.com\",\"password\":\"$PASSWORD\",\"displayName\":\"Eve\",\"homeCurrency\":\"USD\"}")
EVE_TOKEN=$(echo "$EVE_RES" | jq -er .result.data.json.accessToken)
EVE_GET=$(qry groups.get "{\"groupId\":\"$GROUP_ID\"}" "$EVE_TOKEN")
echo "$EVE_GET" | grep -q '"code":"FORBIDDEN"' || fail "non-member should be forbidden, got: $EVE_GET"
ok "non-member rejected"

note "11) Owner cannot leave"
LEAVE=$(post groups.leave "{\"groupId\":\"$GROUP_ID\"}" "$ALICE_TOKEN")
echo "$LEAVE" | grep -q "Owner cannot leave" || fail "owner-leave should be blocked, got: $LEAVE"
ok "owner-leave blocked"

note "12) Bob (member) can leave"
post groups.leave "{\"groupId\":\"$GROUP_ID\"}" "$BOB_TOKEN" >/dev/null
LIST=$(qry groups.list '{}' "$BOB_TOKEN")
COUNT=$(echo "$LIST" | jq '.result.data.json | length')
[[ "$COUNT" == "0" ]] || fail "bob should have 0 groups after leaving, got $COUNT"
ok "bob left"

note "13) Owner deletes the group"
post groups.delete "{\"groupId\":\"$GROUP_ID\"}" "$ALICE_TOKEN" >/dev/null
LIST=$(qry groups.list '{}' "$ALICE_TOKEN")
COUNT=$(echo "$LIST" | jq '.result.data.json | length')
[[ "$COUNT" == "0" ]] || fail "alice should have 0 groups after delete, got $COUNT"
ok "group deleted"

printf "\n\033[1;32mALL GREEN ✓\033[0m  Phase 2 groups + invites backend is functional.\n"
