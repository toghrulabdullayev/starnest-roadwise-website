#!/usr/bin/env bash
# Upload a telemetry file with a game token — the stage backup if the game misbehaves.
#   scripts/upload.sh fixtures/speeder.json              # token from .device-token (scripts/device-flow.sh)
#   TOKEN=rw_… BASE_URL=https://<site> scripts/upload.sh drive.json
set -euo pipefail
cd "$(dirname "$0")/.."
FILE="${1:?usage: scripts/upload.sh <telemetry.json>}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
TOKEN="${TOKEN:-$(cat .device-token 2>/dev/null || true)}"
[ -n "$TOKEN" ] || { echo "no token: run scripts/device-flow.sh first or set TOKEN" >&2; exit 2; }
code=$(curl -sS -o /tmp/rw_upload.$$ -w '%{http_code}' -X POST "$BASE_URL/api/drives" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @"$FILE")
body=$(cat /tmp/rw_upload.$$); rm -f /tmp/rw_upload.$$
echo "HTTP $code"
if command -v jq >/dev/null; then
  echo "$body" | jq -c 'if .id then {id, created, debrief_status, readiness: .readiness.score, band: .readiness.band, url} else . end'
else
  echo "$body"
fi
[ "$code" = 200 ]
