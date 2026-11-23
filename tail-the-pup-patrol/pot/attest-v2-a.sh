#!/bin/bash
# Judge A on the games server: attest a run on the v2 pot, then free the memory again.
#   ./attest-v2-a.sh <run id|auto>      auto = today's run from the sealed schedule
# In v2 the judges decide every run (the ranking, whether it counts, the pot winner among entrants),
# so every scheduled run is attested, prize or not. Attests only once entries have closed (chain time).
# Starts the proof server (capped at 900 MB, local only), attests from tail-watch's own run file,
# and always stops the proof server afterwards. Keys stay in ~/midnight-keys.
set -euo pipefail
cd "$(dirname "$0")"
node=/opt/node/bin/node
export TAIL_RULES=/var/www/tail/current/rules.json TAIL_POT_DEPLOYMENT="${TAIL_POT_DEPLOYMENT:-deployment-v2.json}"
race="${1:?run id or auto}"
[ "$race" = auto ] && race=$($node call-v2.mjs run-id | awk '{print $1}')
[[ "$race" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$ ]] || { echo "bad run id"; exit 1; }
echo "== $(date -u +%FT%TZ) attest (v2) $race"
file="/var/www/tail/data/runs/$race.json"
[ -f "$file" ] || { echo "no run file $file: nothing to judge"; exit 0; }
exec 9>"$HOME/judge-a/.proof.lock"; flock 9 # one proof server at a time (the settle too)
export TAIL_POT_KEYS=~/midnight-keys/judge-a.json TAIL_POT_WALLET=~/midnight-keys/judge-a.json MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
cleanup() { docker rm -f judge-a-proof >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --name judge-a-proof --memory 900m --memory-swap 900m -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.1 >/dev/null
for i in $(seq 30); do curl -sf -m 2 http://127.0.0.1:6300/version >/dev/null && break; sleep 2; done
# The judge's own exit status is this script's, so a failed attest shows up as a failure.
raw=$(timeout 1500 $node call-v2.mjs attest A "$race" "$file" 2>&1) && rc=0 || rc=$?
grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" <<<"$raw" || true
exit $rc
