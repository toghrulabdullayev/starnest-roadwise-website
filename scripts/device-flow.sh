#!/usr/bin/env bash
# End-to-end check of Contract A (device-link login) over HTTP.
#   scripts/device-flow.sh                         # local: http://localhost:3000, auto-approves via the local DB
#   BASE_URL=https://<site> scripts/device-flow.sh # remote: open the printed link and click "Authorise this device"
# Writes the issued token to .device-token (gitignored) for scripts/upload.sh.
set -euo pipefail
BASE_URL="${BASE_URL:-http://localhost:3000}"
cd "$(dirname "$0")/.."
pass() { printf '  \033[32mPASS\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$1"; exit 1; }
field() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s)[process.argv[1]];console.log(typeof v==="object"?JSON.stringify(v):v??"")})' "$1"; }
post() { curl -sS -o /tmp/rw_body.$$ -w '%{http_code}' -X POST "$BASE_URL$1" -H 'Content-Type: application/json' -d "$2"; }

echo "device flow against $BASE_URL"

code=$(post /api/device/start '{"client":"roadwise-unity","client_version":"0.1.0"}'); body=$(cat /tmp/rw_body.$$)
[ "$code" = 200 ] || fail "start → $code $body"
device_code=$(echo "$body" | field device_code); user_code=$(echo "$body" | field user_code)
verify_url=$(echo "$body" | field verify_url); interval=$(echo "$body" | field interval)
[[ "$user_code" =~ ^[A-Z2-9]{4}-[A-Z2-9]{4}$ ]] || fail "user_code format: $user_code"
[[ "$verify_url" == *"/en/link?code=$user_code" ]] || fail "verify_url: $verify_url"
[ "$interval" = 3 ] && [ "$(echo "$body" | field expires_in)" = 600 ] || fail "interval/expires_in: $body"
pass "start → user_code $user_code"

code=$(post /api/device/token "{\"device_code\":\"$device_code\"}"); body=$(cat /tmp/rw_body.$$)
[ "$code" = 400 ] && [ "$(echo "$body" | field error)" = authorization_pending ] || fail "pending poll → $code $body"
pass "poll before approval → 400 authorization_pending"

code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/en/link?code=$user_code")
[ "$code" = 307 ] || fail "/link without a session should redirect to login, got $code"
pass "/link without a session → redirect to login"

if [[ "$BASE_URL" == http://localhost* || "$BASE_URL" == http://127.0.0.1* ]]; then
  npx tsx scripts/approve-device.ts "$user_code" "${DEVICE_FLOW_EMAIL:-device-flow@example.com}" >/dev/null || fail "approve"
  pass "approved (local helper)"
else
  echo "  → open $verify_url, log in and click \"Authorise this device\" (waiting up to 5 min)"
fi

token=""
for _ in $(seq 1 100); do
  code=$(post /api/device/token "{\"device_code\":\"$device_code\"}"); body=$(cat /tmp/rw_body.$$)
  if [ "$code" = 200 ]; then token=$(echo "$body" | field access_token); break; fi
  [ "$(echo "$body" | field error)" = authorization_pending ] || fail "poll → $code $body"
  sleep "$interval"
done
[[ "$token" == rw_* ]] || fail "no token issued"
[ "$(echo "$body" | field token_type)" = Bearer ] || fail "token_type"
pass "poll after approval → 200 Bearer rw_… for $(echo "$body" | field user)"

code=$(post /api/device/token "{\"device_code\":\"$device_code\"}"); body=$(cat /tmp/rw_body.$$)
[ "$code" = 400 ] && [ "$(echo "$body" | field error)" = invalid_grant ] || fail "second exchange → $code $body"
pass "second exchange → 400 invalid_grant"

code=$(curl -sS -o /tmp/rw_body.$$ -w '%{http_code}' "$BASE_URL/api/me" -H "Authorization: Bearer $token"); body=$(cat /tmp/rw_body.$$)
[ "$code" = 200 ] && [ -n "$(echo "$body" | field id)" ] || fail "/api/me → $code $body"
pass "/api/me with token → 200 $body"

code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE_URL/api/me" -H "Authorization: Bearer rw_invalid")
[ "$code" = 401 ] || fail "/api/me with bad token → $code"
pass "/api/me with bad token → 401"

code=$(post /api/device/token '{"device_code":"unknown"}')
[ "$code" = 400 ] || fail "unknown device code → $code"
pass "unknown device code → 400 invalid_grant"

echo "$token" > .device-token
rm -f /tmp/rw_body.$$
echo "all device-flow checks passed (token saved to .device-token)"
