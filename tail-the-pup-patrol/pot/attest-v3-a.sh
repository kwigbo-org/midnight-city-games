#!/bin/bash
# Judge A on the games server: attest a run on the v3 pot, then free the memory again.
#   ./attest-v3-a.sh <run id|auto>      auto = today's run from the sealed schedule
# The judges decide every run (the ranking, whether it counts, the pot winner: the best finisher with its own wallet),
# so every scheduled run is attested, prize or not. Attests only after the run has started (chain time).
# Starts the proof server (capped at 900 MB, local only), attests from tail-watch's own run file,
# and always stops the proof server afterwards. Keys stay in ~/midnight-keys.
set -euo pipefail
cd "$(dirname "$0")"
node=/opt/node/bin/node
export TAIL_RULES=/var/www/tail/current/rules.json TAIL_POT_DEPLOYMENT="${TAIL_POT_DEPLOYMENT:-deployment-v4.json}"
race="${1:?run id or auto}"
[ "$race" = auto ] && race=$($node call-v3.mjs run-id | awk '{print $1}')
[[ "$race" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$ ]] || { echo "bad run id"; exit 1; }
echo "== $(date -u +%FT%TZ) attest (v3) $race"
file="/var/www/tail/data/runs/$race.json"
[ -f "$file" ] || { echo "no run file $file: nothing to judge"; exit 0; }
contract=$($node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.TAIL_POT_DEPLOYMENT, 'utf8')).address)")
# Posted before: done once two judges agree; until then post again (the outcome is read afresh: two
# judges who read the city's wallet list minutes apart can differ, and a judge may replace its vote).
# Posted and the other judge hasn't yet: wait for it (no new transaction every tick).
if [ -f "outcomes-v3/$contract/$race.json" ]; then
  j=$($node call-v3.mjs judging "$race" 2>/dev/null | tail -1 || true)
  [[ "$j" == *agreed=yes* ]] && { echo "$race: agreed"; exit 0; }
  [[ "$j" == *A=yes* && "$j" == *B=no* ]] && { echo "$race: posted; waiting for judge B"; exit 0; }
fi
# Only a finished (or void) run is judged: the sealed judge's status in the run file. Not yet: try later.
status=$($node -e "try { console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).result?.status ?? 'none') } catch { console.log('none') }" "$file")
case "$status" in finished|cancelled|void) ;; *) echo "$race is '$status', not over: not judging yet"; exit 0 ;; esac
exec 9>"$HOME/judge-a/.proof.lock"; flock 9 # one proof server at a time (the settle too)
export TAIL_POT_KEYS=~/midnight-keys/judge-a.json TAIL_POT_WALLET=~/midnight-keys/judge-a.json MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
cleanup() { docker rm -f judge-a-proof >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --name judge-a-proof --memory 2g --memory-swap 2g -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.1 >/dev/null
for i in $(seq 30); do curl -sf -m 2 http://127.0.0.1:6300/version >/dev/null && break; sleep 2; done
# The judge's own exit status is this script's, so a failed attest shows up as a failure.
raw=$(timeout 1500 $node call-v3.mjs attest A "$race" "$file" 2>&1) && rc=0 || rc=$?
grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" <<<"$raw" || true
# Posting the same outcome again is refused: that is this judge's vote standing, not a failure.
grep -q "already attested this outcome" <<<"$raw" && rc=0
exit $rc
