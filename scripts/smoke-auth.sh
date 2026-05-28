#!/usr/bin/env bash
# End-to-end smoke test for the Phase 1 auth backend.
# Walks: signup -> /me -> verify-email -> login -> refresh -> requestPasswordReset
#         -> confirmPasswordReset -> login (new password).
# Requires: jq, curl. Assumes API on :4000 and Mailpit on :8025.
set -euo pipefail

API="${API:-http://localhost:4000}"
MAILPIT="${MAILPIT:-http://localhost:8025}"

ts="$(date +%s)"
EMAIL="alice+${ts}@example.com"
PASSWORD="hunter2-correct-horse"
NEW_PASSWORD="hunter2-tribute-band"
NAME="Alice ${ts}"

note() { printf "\n\033[1;36m▸ %s\033[0m\n" "$*"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$*"; }
fail() { printf "  \033[1;31m✗ %s\033[0m\n" "$*"; exit 1; }

# tRPC mutation call: extracts `result.data.json` envelope from the response.
mut() {
  local proc="$1"; shift
  local body="${1:-{\}}"
  curl -fsS -X POST "${API}/trpc/${proc}" \
    -H 'content-type: application/json' \
    --cookie-jar /tmp/splitwise-auth.cookies \
    --cookie /tmp/splitwise-auth.cookies \
    --data "{\"json\":${body}}" \
    | jq -e '.result.data.json'
}

qry() {
  local proc="$1"; shift
  local headers=("${@:-}")
  curl -fsS "${API}/trpc/${proc}" \
    -H 'content-type: application/json' \
    "${headers[@]}" \
    | jq -e '.result.data.json'
}

mailpit_latest_body_for() {
  local needle="$1"
  curl -fsS "${MAILPIT}/api/v1/messages?limit=50" \
    | jq -r --arg n "$needle" \
        '.messages | map(select(.To[].Address == $n)) | .[0].ID' \
    | { read -r mid; [[ -n "$mid" && "$mid" != "null" ]] || fail "no Mailpit msg for $needle"
        curl -fsS "${MAILPIT}/api/v1/message/${mid}" | jq -r '.Text'; }
}

rm -f /tmp/splitwise-auth.cookies

# Clear any rate-limit keys lingering from previous smoke runs.
docker exec splitwise-redis sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del" >/dev/null 2>&1 || true

note "1) signup"
res="$(mut auth.signup "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\",\"displayName\":\"$NAME\",\"homeCurrency\":\"USD\"}")"
ACCESS="$(echo "$res" | jq -r .accessToken)"
REFRESH="$(echo "$res" | jq -r .refreshToken)"
USER_ID="$(echo "$res" | jq -r .user.id)"
ok "user $USER_ID created"

note "2) me (unverified)"
me="$(qry auth.me -H "authorization: Bearer $ACCESS")"
[[ "$(echo "$me" | jq -r .email)" == "$EMAIL" ]] || fail "wrong email back"
[[ "$(echo "$me" | jq -r .emailVerifiedAt)" == "null" ]] || fail "should be unverified"
ok "me works; emailVerifiedAt is null"

note "3) extract verify token from Mailpit and call verifyEmail"
body="$(mailpit_latest_body_for "$EMAIL")"
token="$(echo "$body" | grep -oE 'token=[A-Za-z0-9_-]+' | head -1 | cut -d= -f2)"
[[ -n "$token" ]] || fail "could not parse verify token from email body"
mut auth.verifyEmail "{\"token\":\"$token\"}" >/dev/null
ok "verifyEmail returned ok"

note "4) me again — should now be verified"
me2="$(qry auth.me -H "authorization: Bearer $ACCESS")"
[[ "$(echo "$me2" | jq -r .emailVerifiedAt)" != "null" ]] || fail "still not verified"
ok "emailVerifiedAt populated"

note "5) login with original creds"
login="$(mut auth.login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")"
ACCESS2="$(echo "$login" | jq -r .accessToken)"
REFRESH2="$(echo "$login" | jq -r .refreshToken)"
ok "login returns new access+refresh"

note "6) refresh (via cookie set by curl)"
refr="$(mut auth.refresh "{}")"
ACCESS3="$(echo "$refr" | jq -r .accessToken)"
REFRESH3="$(echo "$refr" | jq -r .refreshToken)"
[[ "$ACCESS3" != "$ACCESS2" ]] || fail "refresh should mint a new access token"
[[ "$REFRESH3" != "$REFRESH2" ]] || fail "refresh should rotate the refresh token"
ok "rotation produced new pair"

note "7) reuse of OLD refresh token — should fail and revoke the session"
set +e
if curl -fsS -X POST "${API}/trpc/auth.refresh" \
     -H 'content-type: application/json' \
     --data "{\"json\":{\"refreshToken\":\"$REFRESH2\"}}" >/tmp/reuse.out 2>&1; then
  echo "  (got body): $(cat /tmp/reuse.out)"
  fail "reusing rotated refresh should have errored"
fi
set -e
ok "reuse rejected"

note "8) request password reset for unknown email — should still return ok"
mut auth.requestPasswordReset "{\"email\":\"nosuch+${ts}@example.com\"}" >/dev/null
ok "no-account reset request silently succeeds"

note "9) request password reset for real email"
mut auth.requestPasswordReset "{\"email\":\"$EMAIL\"}" >/dev/null
sleep 0.5
reset_body="$(mailpit_latest_body_for "$EMAIL")"
reset_token="$(echo "$reset_body" | grep -oE 'token=[A-Za-z0-9_-]+' | head -1 | cut -d= -f2)"
[[ -n "$reset_token" ]] || fail "could not parse reset token from email body"
ok "reset email sent; token extracted"

note "10) confirm reset with new password"
mut auth.confirmPasswordReset "{\"token\":\"$reset_token\",\"newPassword\":\"$NEW_PASSWORD\"}" >/dev/null
ok "password reset confirmed"

note "11) login with NEW password"
mut auth.login "{\"email\":\"$EMAIL\",\"password\":\"$NEW_PASSWORD\"}" >/dev/null
ok "login with new password succeeded"

note "12) login with OLD password should fail"
if curl -fsS -X POST "${API}/trpc/auth.login" \
     -H 'content-type: application/json' \
     --data "{\"json\":{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}}" >/dev/null 2>&1; then
  fail "old password should not work"
fi
ok "old password rejected"

printf "\n\033[1;32mALL GREEN ✓\033[0m  Phase 1 auth backend is functional.\n"
