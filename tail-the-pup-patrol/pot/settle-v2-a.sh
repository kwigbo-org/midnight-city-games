#!/bin/bash
# Settle a run on the v2 pot from the games server (judge A's wallet pays the fees), record what the
# pot did for the Runs tab (data/payouts.json), refund every entry of a void run, and send the
# operator's share to its fixed address.
#   ./settle-v2-a.sh <run id|auto>      auto = today's run from the sealed schedule
# TAIL_RUN_FILE and TAIL_PAYOUTS replace the run file and data/payouts.json (rehearsals on a test pot).
# The contract settles only once two judges attested the same outcome; otherwise this just reports
# why. Shares a lock with the other judge-A scripts: one proof server at a time.
set -euo pipefail
cd "$(dirname "$0")"
node=/opt/node/bin/node
export TAIL_RULES="${TAIL_RULES:-/var/www/tail/current/rules.json}" TAIL_POT_DEPLOYMENT="${TAIL_POT_DEPLOYMENT:-deployment-v2.json}"
race="${1:?run id or auto}"
[ "$race" = auto ] && race=$($node call-v2.mjs run-id | awk '{print $1}')
[[ "$race" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$ ]] || { echo "bad run id"; exit 1; }
echo "== $(date -u +%FT%TZ) settle (v2) $race"
file="${TAIL_RUN_FILE:-/var/www/tail/data/runs/$race.json}"
payouts="${TAIL_PAYOUTS:-/var/www/tail/data/payouts.json}"
[ -f "$file" ] || { echo "no run file $file: nothing to settle"; exit 0; }
exec 9>"$HOME/judge-a/.proof.lock"; flock 9
export TAIL_POT_KEYS=~/midnight-keys/judge-a.json TAIL_POT_WALLET=~/midnight-keys/judge-a.json MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
cleanup() { docker rm -f judge-a-proof >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --name judge-a-proof --memory 900m --memory-swap 900m -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.1 >/dev/null
for i in $(seq 30); do curl -sf -m 2 http://127.0.0.1:6300/version >/dev/null && break; sleep 2; done
raw=$(timeout 1500 $node call-v2.mjs settle "$race" 2>&1) && rc=0 || rc=$?
grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" <<<"$raw" || true
# The settle's transaction is kept before it's recorded, so if recording fails a re-run (which the
# contract refuses: already settled) can still record it.
contract=$($node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.TAIL_POT_DEPLOYMENT, 'utf8')).address)")
kept="outcomes-v2/$contract/$race.settled"
tx=$(grep -o "settle ok: tx [0-9a-f]\{64\}" <<<"$raw" | awk '{print $4}' || true)
if [ -n "$tx" ]; then mkdir -p "outcomes-v2/$contract" && echo "$tx" > "$kept"; elif [ -f "$kept" ]; then tx=$(cat "$kept"); rc=0; echo "already settled: recording tx $tx"; fi
if [ -n "$tx" ]; then $node record-payout-v2.mjs "$race" "$tx" "$file" "$payouts" || rc=$?; fi
q() { grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" || true; }
# A void run: every entry back to the wallet it named (one call each; anyone may, judge A does).
if [ -n "$tx" ] && grep -q '"kind":"1"' "outcomes-v2/$contract/$race.json" 2>/dev/null; then
  sleep 120 # the next call spends this one's fee coins
  # No time limit: each entry takes a few minutes. Interrupted, it resumes where it stopped when run again.
  $node call-v2.mjs refund-all "$race" 2>&1 | q || rc=1
fi
# The operator's share, whenever some is due (only ever to the operator's fixed address).
due=$(timeout 600 $node call-v2.mjs status 2>/dev/null | grep -o '"operatorDue":"[0-9.]*"' | grep -o '[0-9.]*' || true)
if [ -n "$due" ] && awk -v d="$due" 'BEGIN { exit !(d + 0 > 0) }'; then
  sleep 120
  echo "operator due $due tNIGHT: sweeping"
  timeout 1500 $node call-v2.mjs sweep 2>&1 | q || rc=1
fi
# The Judges tab: refresh the judges as the contract now has them (a failure only leaves it stale).
TAIL_POT_CONTRACT=tail-pot-v2 $node judges.mjs judges-roster.json /var/www/tail/data/judges.json >/dev/null 2>&1 || true
exit $rc
