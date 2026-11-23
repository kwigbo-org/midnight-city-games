#!/bin/bash
# Judge B on the lab: attest a run on the v2 pot.
#   ./pot-night-v2.sh <run id|auto>      auto = today's run from the sealed schedule
# In v2 the judges decide every run, prize or not. Attests only once entries have closed (chain time).
# Reads the lab's own recording: tail-rec/runs/<date>.json, or <date>T<hhmm>.json for another time.
set -euo pipefail
cd "$(dirname "$0")"
node=~/node/bin/node
export TAIL_RULES=$HOME/midnight/tail-rec/rules.json TAIL_POT_DEPLOYMENT="${TAIL_POT_DEPLOYMENT:-deployment-v2.json}"
race="${1:?run id or auto}"
[ "$race" = auto ] && race=$($node call-v2.mjs run-id | awk '{print $1}')
[[ "$race" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{4})-[a-z]+$ ]] || { echo "bad run id"; exit 1; }
# The 22:00 recording is named by its date; any other run of the day by date and time.
if [ "${BASH_REMATCH[2]}" = 2200 ]; then rec="${BASH_REMATCH[1]}"; else rec="${BASH_REMATCH[1]}T${BASH_REMATCH[2]}"; fi
file="$HOME/midnight/tail-rec/runs/$rec.json"
echo "== $(date -u +%FT%TZ) attest (v2) $race"
[ -f "$file" ] || { echo "no recording $file: nothing to judge"; exit 0; }
raw=$(timeout 1500 $node call-v2.mjs attest B "$race" "$file" 2>&1) && rc=0 || rc=$?
grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" <<<"$raw" || true
timeout 600 $node call-v2.mjs status 2>&1 | grep address || true
exit $rc
