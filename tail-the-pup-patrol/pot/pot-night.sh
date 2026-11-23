#!/bin/bash
# Judge B on the lab: attest a run, or settle it after the window.
#   ./pot-night.sh attest <race id|auto>     e.g. 2026-11-11T2200-practice
#   ./pot-night.sh settle <race id|auto>
# A winner without a wallet of their own is HELD (see attest-a.sh). TAIL_POT_DEPLOYMENT judges another pot.
# auto = tonight's run from the sealed schedule (practice daily, official on Fridays, 22:00 UTC).
# Attests only while the pot holds tNIGHT: an empty pot means no prize, nothing to judge.
# Reads the lab's own recording: tail-rec/runs/<date>.json, or <date>T<hhmm>.json for an extra run.
set -euo pipefail
cd "$(dirname "$0")"
node=~/node/bin/node
cmd="${1:?attest|settle}"; race="${2:?race id or auto}"
[ "$race" = auto ] && race=$($node call.mjs race-id)
[[ "$race" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{4})-[a-z]+$ ]] || { echo "bad race id"; exit 1; }
# The 22:00 recording is named by its date; any other run of the day by date and time.
if [ "${BASH_REMATCH[2]}" = 2200 ]; then rec="${BASH_REMATCH[1]}"; else rec="${BASH_REMATCH[1]}T${BASH_REMATCH[2]}"; fi
file="$HOME/midnight/tail-rec/runs/$rec.json"
echo "== $(date -u +%FT%TZ) $cmd $race"
[ -f "$file" ] || { echo "no recording $file: nothing to judge"; exit 0; }
case "$cmd" in
  attest)
    night=$($node call.mjs balance)
    if [ "$night" = 0 ]; then echo "pot is empty: no prize, not attesting"; exit 0; fi
    echo "pot holds $night atomic tNIGHT"
    args=(attest B "$race" "$file") ;;
  settle) args=(settle "$race" "$file") ;;
  *) echo "attest|settle"; exit 1 ;;
esac
raw=$(timeout 1200 $node call.mjs "${args[@]}" 2>&1) && rc=0 || rc=$?
grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" <<<"$raw" || true
timeout 300 $node call.mjs status 2>&1 | grep address || true
exit $rc
