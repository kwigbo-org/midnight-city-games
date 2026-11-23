#!/bin/bash
# Settle a run's pot from the games server (judge A's wallet pays the fee), then record what was
# paid for the Runs tab (data/payouts.json).
#   ./settle-a.sh <race id|auto>      auto = tonight's run from the sealed schedule
# The contract settles only once both judges attested the same outcome and the window has passed;
# otherwise this just reports why. Shares a lock with attest-a.sh: one proof server at a time.
set -euo pipefail
cd "$(dirname "$0")"
node=/opt/node/bin/node
race="${1:?race id or auto}"
[ "$race" = auto ] && race=$($node call.mjs race-id)
[[ "$race" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$ ]] || { echo "bad race id"; exit 1; }
echo "== $(date -u +%FT%TZ) settle $race"
file="/var/www/tail/data/runs/$race.json"
[ -f "$file" ] || { echo "no run file $file: nothing to settle"; exit 0; }
exec 9>"$HOME/judge-a/.proof.lock"; flock 9
export TAIL_POT_KEYS=~/midnight-keys/judge-a.json TAIL_POT_WALLET=~/midnight-keys/judge-a.json MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
cleanup() { docker rm -f judge-a-proof >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --name judge-a-proof --memory 900m --memory-swap 900m -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.1 >/dev/null
for i in $(seq 30); do curl -sf -m 2 http://127.0.0.1:6300/version >/dev/null && break; sleep 2; done
raw=$(timeout 1200 $node call.mjs settle "$race" "$file" 2>&1) && rc=0 || rc=$?
grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" <<<"$raw" || true
# The settle's transaction is kept before it's recorded, so if recording fails a re-run (which the
# contract refuses: already settled) can still record it.
contract=$($node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.TAIL_POT_DEPLOYMENT ?? 'deployment.json', 'utf8')).address)")
kept="outcomes/$contract/$race.settled"
tx=$(grep -o "settle ok: tx [0-9a-f]\{64\}" <<<"$raw" | awk '{print $4}' || true)
if [ -n "$tx" ]; then mkdir -p "outcomes/$contract" && echo "$tx" > "$kept"; elif [ -f "$kept" ]; then tx=$(cat "$kept"); rc=0; echo "already settled: recording tx $tx"; fi
if [ -n "$tx" ]; then $node record-payout.mjs "$race" "$tx" "$file" /var/www/tail/data/payouts.json || rc=$?; fi
# The Judges tab: refresh the judges as the contract now has them (a failure only leaves it stale).
$node judges.mjs judges-roster.json /var/www/tail/data/judges.json >/dev/null 2>&1 || true
exit $rc
