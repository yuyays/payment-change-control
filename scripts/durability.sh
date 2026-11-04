#!/usr/bin/env bash
# Durability proof for the cooling-off timer.
#
# Runs the real worker in workerd, lets the alarm fire, kills the process,
# restarts it against the same storage, and checks the state survived.
set -euo pipefail

PORT=8795
PERSIST=/tmp/pcc-do-durability
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER="$ROOT/apps/worker"
BASE="http://127.0.0.1:$PORT"
PAYLOAD=/tmp/pcc-durability.json
SERVER_PID=""
FAILURES=0

pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
check() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (expected '$3', got '$2')"; fi; }

json() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }

start() {
  ( cd "$WORKER" && npx wrangler dev --port "$PORT" --local --persist-to "$PERSIST" \
      --var COOLING_OFF_SECONDS:8 > /tmp/pcc-durability.log 2>&1 & )
  for _ in $(seq 1 60); do
    if curl -sf "$BASE/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  echo "server failed to start"; tail -20 /tmp/pcc-durability.log; exit 1
}

stop() {
  pkill -f "[w]rangler.js dev --port $PORT" 2>/dev/null || true
  pkill -f "[w]orkerd serve .*:$PORT" 2>/dev/null || true
  sleep 1
}

cleanup() { stop; }
trap cleanup EXIT

status_of() { curl -s "$BASE/api/requests/$1/state" | json "d['state']['status'] if d['state'] else 'none'"; }
approvals_of() { curl -s "$BASE/api/requests/$1/state" | json "len({a['approverId'] for a in d['state']['approvals']}) if d['state'] else -1"; }

python3 - "$PAYLOAD" <<'PY'
import json, sys, time
body = ("Please update our account.\n\nNew bank: Rhine Trust\n"
        "IBAN: DE89 3704 0044 0532 0130 00\n")
payload = {
    "vendor": {"id": "v-acme", "name": "Acme Industrial",
               "registeredDomain": "acme-industrial.com",
               "phoneOnFile": "+81 3 5555 0100",
               "bankAccount": {"bankName": "MUFG", "iban": "JP00 0000 0000 0000"},
               "lastBankChangeAt": None},
    "email": {"rawBody": body, "fromAddress": "billing@acme-industrial.com", "replyTo": None},
    "receivedAt": int(time.time() * 1000),
}
json.dump(payload, open(sys.argv[1], "w"))
PY

rm -rf "$PERSIST"
echo "1. intake"
start
curl -s "$BASE/api/requests/dur-1/state" > /dev/null   # warm the DO before the clock matters
curl -s -X POST "$BASE/api/requests/dur-1/intake" -H 'content-type: application/json' \
  --data-binary "@$PAYLOAD" > /dev/null
check "status is cooling_off immediately after intake" "$(status_of dur-1)" "cooling_off"

echo "2. wait for the alarm (cooling-off is 8s in this run)"
sleep 10
check "alarm fired and moved the request to ready_for_review" \
  "$(status_of dur-1)" "ready_for_review"

echo "3. kill the process, restart against the same storage"
stop
check "state survived process death" "$(status_of dur-1 2>/dev/null || echo unreachable)" "unreachable"
start
check "state rehydrated after restart" "$(status_of dur-1)" "ready_for_review"

echo "4. concurrent approvals"
curl -s -X POST "$BASE/api/requests/dur-1/approve" -H 'content-type: application/json' \
  -d '{"approverId":"clerk"}' > /tmp/pcc-a1.json &
curl -s -X POST "$BASE/api/requests/dur-1/approve" -H 'content-type: application/json' \
  -d '{"approverId":"clerk"}' > /tmp/pcc-a2.json &
wait
check "two concurrent identical approvals are not enough" "$(approvals_of dur-1)" "1"
check "still not approved" "$(status_of dur-1)" "ready_for_review"

curl -s -X POST "$BASE/api/requests/dur-1/approve" -H 'content-type: application/json' \
  -d '{"approverId":"clerk"}' > /dev/null
curl -s -X POST "$BASE/api/requests/dur-1/approve" -H 'content-type: application/json' \
  -d '{"approverId":"controller"}' > /dev/null
check "two distinct approvers approve" "$(status_of dur-1)" "approved"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "durability: all checks passed"
  exit 0
fi
echo "durability: $FAILURES check(s) failed"
exit 1
