#!/bin/bash
# Settle a run on the v3 pot from the games server (judge A's wallet pays the fees), record what the
# pot did for the Runs tab (data/payouts.json), and send the operator's share to its fixed address.
# (A void run's winning bid goes back to its sponsor in the settle itself.)
#   ./settle-v3-a.sh <run id|auto>      auto = today's run from the sealed schedule
# TAIL_RUN_FILE, TAIL_PAYOUTS and TAIL_JUDGES replace the run file, data/payouts.json and
# data/judges.json (rehearsals on a test pot must not touch the site's).
# The contract settles only once two judges attested the same outcome; otherwise this just reports
# why. Shares a lock with the other judge-A scripts: one proof server at a time.
set -euo pipefail
cd "$(dirname "$0")"
node=/opt/node/bin/node
export TAIL_RULES="${TAIL_RULES:-/var/www/tail/current/rules.json}" TAIL_POT_DEPLOYMENT="${TAIL_POT_DEPLOYMENT:-deployment-v4.json}"
race="${1:?run id or auto}"
[ "$race" = auto ] && race=$($node call-v3.mjs run-id | awk '{print $1}')
[[ "$race" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$ ]] || { echo "bad run id"; exit 1; }
echo "== $(date -u +%FT%TZ) settle (v3) $race"
file="${TAIL_RUN_FILE:-/var/www/tail/data/runs/$race.json}"
payouts="${TAIL_PAYOUTS:-/var/www/tail/data/payouts.json}"
[ -f "$file" ] || { echo "no run file $file: nothing to settle"; exit 0; }
# Not agreed yet (and not settled): nothing to do; checked from the chain before any proof server.
contract=$($node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.TAIL_POT_DEPLOYMENT, 'utf8')).address)")
j=$($node call-v3.mjs judging "$race" 2>/dev/null | tail -1 || true)
if [[ "$j" != *agreed=* || "$j" != *settled=* ]]; then echo "$race: the pot is unreachable right now: try again later"; exit 1; fi
if [[ "$j" == *agreed=no* && "$j" == *settled=no* ]]; then echo "$race: the judges haven't agreed yet ($j)"; exit 0; fi
exec 9>"$HOME/judge-a/.proof.lock"; flock 9
export TAIL_POT_KEYS=~/midnight-keys/judge-a.json TAIL_POT_WALLET=~/midnight-keys/judge-a.json MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
cleanup() { docker rm -f judge-a-proof >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --name judge-a-proof --memory 2g --memory-swap 2g -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.1 >/dev/null
for i in $(seq 30); do curl -sf -m 2 http://127.0.0.1:6300/version >/dev/null && break; sleep 2; done
raw=$(timeout 1500 $node call-v3.mjs settle "$race" 2>&1) && rc=0 || rc=$?
grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" <<<"$raw" || true
# The settle's transaction is kept before it's recorded, so if recording fails a re-run (which the
# contract refuses: already settled) can still record it.
kept="outcomes-v3/$contract/$race.settled"
tx=$(grep -o "settle ok: tx [0-9a-f]\{64\}" <<<"$raw" | awk '{print $4}' || true)
if [ -n "$tx" ]; then mkdir -p "outcomes-v3/$contract" && echo "$tx" > "$kept"; elif [ -f "$kept" ]; then tx=$(cat "$kept"); rc=0; echo "already settled: recording tx $tx"; fi
if [ -n "$tx" ]; then $node record-payout-v3.mjs "$race" "$tx" "$file" "$payouts" || rc=$?; fi
q() { grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" || true; }
# The operator's share, whenever some is due (only ever to the operator's fixed address).
due=$(timeout 600 $node call-v3.mjs status 2>/dev/null | grep -o '"operatorDue":"[0-9.]*"' | grep -o '[0-9.]*' || true)
if [ -n "$due" ] && awk -v d="$due" 'BEGIN { exit !(d + 0 > 0) }'; then
  sleep 120
  echo "operator due $due tNIGHT: sweeping"
  timeout 1500 $node call-v3.mjs sweep 2>&1 | q || rc=1
fi
# The Judges tab: refresh the judges as the contract now has them (a failure only leaves it stale).
TAIL_POT_CONTRACT=tail-pot-v3 $node judges.mjs judges-roster.json "${TAIL_JUDGES:-/var/www/tail/data/judges.json}" >/dev/null 2>&1 || true
exit $rc
