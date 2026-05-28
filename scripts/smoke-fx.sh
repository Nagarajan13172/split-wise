#!/usr/bin/env bash
# End-to-end smoke for Phase 6 FX conversion.
# Walks:
#   1. Seed deterministic FxRate rows directly via psql (so we don't depend on
#      Frankfurter being reachable from CI).
#   2. Two users with different home currencies form a group with default EUR.
#   3. Alice (home=USD) creates a €100 expense split 50/50.
#   4. fx.latest returns the seeded snapshot.
#   5. expenses.forGroup returns a homeTotal with the USD-converted net.
#   6. auth.updateHomeCurrency flips Alice to INR; homeTotal switches currency.
#   7. (Optional) if `worker` is running with FX_CRON=*/1 set, enqueue an
#      immediate run and confirm the row count grows.
#
# Pre-reqs:
#   - docker compose up (postgres + redis)
#   - api running on :4000
#   - worker running (needed for prime — okay if Frankfurter unreachable, we
#     seed manually)
#
# Run:  ./scripts/smoke-fx.sh
set -euo pipefail

API="${API:-http://localhost:4000}"
ts="$(date +%s)"
PASSWORD="fxtest-pw-2026"

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
  local email="$1" name="$2" home="${3:-USD}"
  local res; res=$(post auth.signup \
    "{\"email\":\"$email\",\"password\":\"$PASSWORD\",\"displayName\":\"$name\",\"homeCurrency\":\"$home\"}")
  echo "$res" | jq -er .result.data.json.accessToken \
    || { echo "  signup failed: $res" >&2; exit 1; }
}
me_id() { qry auth.me '{}' "$1" | jq -er .result.data.json.id; }

docker exec splitwise-redis sh -c "redis-cli --scan --pattern 'rl:*' | xargs -r redis-cli del" >/dev/null 2>&1 || true
docker exec splitwise-redis sh -c "redis-cli del fx:latest:v1" >/dev/null 2>&1 || true

note "1) Seed deterministic FxRate rows (EUR base) via psql"
TODAY=$(date -u +%Y-%m-%d)
docker exec splitwise-postgres psql -U splitwise -d splitwise -q <<SQL
INSERT INTO "FxRate" (id, base, quote, rate, "asOf", source, "fetchedAt")
VALUES
  ('fx_smoke_usd_' || extract(epoch from now())::text, 'EUR', 'USD', 1.1000000000, '${TODAY}'::timestamp, 'smoke', now()),
  ('fx_smoke_gbp_' || extract(epoch from now())::text, 'EUR', 'GBP', 0.8500000000, '${TODAY}'::timestamp, 'smoke', now()),
  ('fx_smoke_inr_' || extract(epoch from now())::text, 'EUR', 'INR', 90.0000000000, '${TODAY}'::timestamp, 'smoke', now())
ON CONFLICT (base, quote, "asOf") DO UPDATE SET rate = EXCLUDED.rate;
SQL
ok "FxRate rows seeded for $TODAY"

note "2) Sign up Alice (home=USD) + Bob (home=EUR); form an EUR group"
A_TOK=$(signup "alice+fx${ts}@example.com" "Alice" "USD")
B_TOK=$(signup "bob+fx${ts}@example.com" "Bob" "EUR")
A_ID=$(me_id "$A_TOK"); B_ID=$(me_id "$B_TOK")
G=$(post groups.create "{\"name\":\"FX $ts\",\"defaultCurrency\":\"EUR\",\"simplifyDebts\":true}" "$A_TOK")
GID=$(echo "$G" | jq -er .result.data.json.id)
INV=$(post groups.createInvite "{\"groupId\":\"$GID\",\"expiresInHours\":24}" "$A_TOK")
URL=$(echo "$INV" | jq -er .result.data.json.url)
TOKEN=$(basename "$URL" | python3 -c "import sys,urllib.parse;print(urllib.parse.unquote(sys.stdin.read().strip()))")
post groups.acceptInvite "{\"token\":\"$TOKEN\"}" "$B_TOK" >/dev/null
ok "group with 2 members, default EUR"

note "3) Alice pays €100 EUR split 50/50"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
post expenses.create "{\"groupId\":\"$GID\",\"paidById\":\"$A_ID\",\"description\":\"Dinner\",\"amount\":\"100.00\",\"currency\":\"EUR\",\"occurredAt\":\"$NOW\",\"splitType\":\"EQUAL\",\"splitAmongUserIds\":[\"$A_ID\",\"$B_ID\"]}" "$A_TOK" >/dev/null
ok "expense created"

note "4) fx.latest returns the seeded snapshot"
FX=$(qry fx.latest '{}' "$A_TOK")
BASE=$(echo "$FX" | jq -r .result.data.json.base)
USD_RATE=$(echo "$FX" | jq -r .result.data.json.rates.USD)
INR_RATE=$(echo "$FX" | jq -r .result.data.json.rates.INR)
[[ "$BASE" == "EUR" ]] || fail "fx base expected EUR, got $BASE"
[[ "$USD_RATE" == "1.1" || "$USD_RATE" == "1.1000000000" ]] || fail "fx USD rate expected 1.10, got $USD_RATE"
[[ "$INR_RATE" == "90" || "$INR_RATE" == "90.0000000000" ]] || fail "fx INR rate expected 90, got $INR_RATE"
ok "EUR→USD=1.10, EUR→INR=90.00 (asOf=$(echo "$FX" | jq -r .result.data.json.asOf))"

note "5) balances.forGroup includes a USD homeTotal for Alice"
BAL=$(qry expenses.forGroup "{\"groupId\":\"$GID\"}" "$A_TOK")
HT_CUR=$(echo "$BAL" | jq -r .result.data.json.homeTotal.homeCurrency)
HT_NET=$(echo "$BAL" | jq -r .result.data.json.homeTotal.net)
HT_SKIP=$(echo "$BAL" | jq -r .result.data.json.homeTotal.skipped)
[[ "$HT_CUR" == "USD" ]] || fail "homeCurrency expected USD, got $HT_CUR"
[[ "$HT_SKIP" == "0" ]] || fail "skipped expected 0, got $HT_SKIP"
# Alice is owed €50; €50 * 1.10 = $55.00
[[ "$HT_NET" == "55.00" ]] || fail "USD net expected 55.00, got $HT_NET"
ok "Alice homeTotal: 55.00 USD ≈ 50 EUR × 1.10"

note "6) Alice switches home to INR; homeTotal flips currency"
post auth.updateHomeCurrency '{"homeCurrency":"INR"}' "$A_TOK" >/dev/null
# Force a fresh read — balances are user-agnostic cached, but homeTotal is computed per-call.
BAL=$(qry expenses.forGroup "{\"groupId\":\"$GID\"}" "$A_TOK")
HT_CUR=$(echo "$BAL" | jq -r .result.data.json.homeTotal.homeCurrency)
HT_NET=$(echo "$BAL" | jq -r .result.data.json.homeTotal.net)
[[ "$HT_CUR" == "INR" ]] || fail "homeCurrency expected INR, got $HT_CUR"
# €50 * 90 = ₹4500.00
[[ "$HT_NET" == "4500.00" ]] || fail "INR net expected 4500.00, got $HT_NET"
ok "Alice homeTotal flipped to 4500.00 INR after update"

note "7) Bob (EUR home) sees a EUR homeTotal — no conversion needed"
BAL=$(qry expenses.forGroup "{\"groupId\":\"$GID\"}" "$B_TOK")
HT_CUR=$(echo "$BAL" | jq -r .result.data.json.homeTotal.homeCurrency)
HT_NET=$(echo "$BAL" | jq -r .result.data.json.homeTotal.net)
[[ "$HT_CUR" == "EUR" ]] || fail "Bob homeCurrency expected EUR, got $HT_CUR"
# Bob owes €50 → net = -50.00
[[ "$HT_NET" == "-50.00" ]] || fail "Bob EUR net expected -50.00, got $HT_NET"
ok "Bob homeTotal: -50.00 EUR (no conversion)"

note "8) fx.convert one-shot ad-hoc"
CONV=$(qry fx.convert '{"amount":"25.00","from":"EUR","to":"USD"}' "$A_TOK")
OK_FLAG=$(echo "$CONV" | jq -r .result.data.json.ok)
AMT=$(echo "$CONV" | jq -r .result.data.json.amount)
[[ "$OK_FLAG" == "true" ]] || fail "fx.convert ok expected true: $CONV"
[[ "$AMT" == "27.5000" ]] || fail "fx.convert amount expected 27.5000, got $AMT"
ok "fx.convert 25 EUR → 27.50 USD"

printf "\n\033[1;32mALL GREEN ✓\033[0m  Phase 6 FX conversion end-to-end works.\n"
