#!/bin/bash
# Judge A on the games server: attest one run, then free the memory again.
#   ./attest-a.sh <race id|auto>      e.g. 2026-11-13T2200-official
# The pot pays only a wallet the winner published; a winner without one when this runs is attested
# as no winner, and the settle rolls the pot over. A pot holding a reserved win judges nothing else.
# TAIL_POT_DEPLOYMENT=<file> judges another pot contract (a winner's reserved pot).
# auto = tonight's run from the sealed schedule (practice daily, official on Fridays, 22:00 UTC).
# Attests only while the pot holds tNIGHT: an empty pot means no prize, nothing to judge.
# Starts the proof server (capped at 900 MB, local only), attests from tail-watch's own
# run file, and always stops the proof server afterwards. Keys stay in ~/midnight-keys.
set -euo pipefail
cd "$(dirname "$0")"
node=/opt/node/bin/node
race="${1:?race id or auto}"
[ "$race" = auto ] && race=$($node call.mjs race-id)
[[ "$race" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$ ]] || { echo "bad race id"; exit 1; }
echo "== $(date -u +%FT%TZ) attest $race"
file="/var/www/tail/data/runs/$race.json"
[ -f "$file" ] || { echo "no run file $file: nothing to judge"; exit 0; }
night=$($node call.mjs balance)
if [ "$night" = 0 ]; then echo "pot is empty: no prize, not attesting"; exit 0; fi
echo "pot holds $night atomic tNIGHT"
exec 9>"$HOME/judge-a/.proof.lock"; flock 9 # one proof server at a time (settle-a.sh too)
export TAIL_POT_KEYS=~/midnight-keys/judge-a.json TAIL_POT_WALLET=~/midnight-keys/judge-a.json MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
cleanup() { docker rm -f judge-a-proof >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --name judge-a-proof --memory 900m --memory-swap 900m -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.1 >/dev/null
for i in $(seq 30); do curl -sf -m 2 http://127.0.0.1:6300/version >/dev/null && break; sleep 2; done
# The judge's own exit status is this script's, so a failed attest shows up as a failure.
raw=$(timeout 1200 $node call.mjs attest A "$race" "$file" 2>&1) && rc=0 || rc=$?
grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" <<<"$raw" || true
# The Judges tab: refresh the judges as the contract now has them (a failure only leaves it stale).
$node judges.mjs judges-roster.json /var/www/tail/data/judges.json >/dev/null 2>&1 || true
exit $rc
