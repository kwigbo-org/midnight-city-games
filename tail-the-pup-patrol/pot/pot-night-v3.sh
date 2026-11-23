#!/bin/bash
# Judge B on the lab: attest a run on the pot in TAIL_POT_DEPLOYMENT (default deployment-v4.json, Season 3; v3 before).
#   ./pot-night-v3.sh <run id|auto>      auto = today's run from the sealed schedule
# The judges decide every run, prize or not. Attests only after the run has started (chain time).
# Reads the lab's own recording: tail-rec/runs/<date>.json, or <date>T<hhmm>.json for another time.
set -euo pipefail
cd "$(dirname "$0")"
# Run every 5 minutes through the evening: a run still going when the next is due, the next is skipped.
exec 8>"$HOME/midnight/.pot-night.lock"; flock -n 8 || exit 0
node=~/node/bin/node
export TAIL_RULES=$HOME/midnight/tail-rec/rules.json TAIL_POT_DEPLOYMENT="${TAIL_POT_DEPLOYMENT:-deployment-v4.json}"
race="${1:?run id or auto}"
[ "$race" = auto ] && race=$($node call-v3.mjs run-id | awk '{print $1}')
[[ "$race" =~ ^([0-9]{4}-[0-9]{2}-[0-9]{2})T([0-9]{4})-[a-z]+$ ]] || { echo "bad run id"; exit 1; }
# The 22:00 recording is named by its date; any other run of the day by date and time.
if [ "${BASH_REMATCH[2]}" = 2200 ]; then rec="${BASH_REMATCH[1]}"; else rec="${BASH_REMATCH[1]}T${BASH_REMATCH[2]}"; fi
file="$HOME/midnight/tail-rec/runs/$rec.json"
echo "== $(date -u +%FT%TZ) attest (v3) $race"
[ -f "$file" ] || { echo "no recording $file: nothing to judge"; exit 0; }
contract=$($node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.TAIL_POT_DEPLOYMENT, 'utf8')).address)")
# Posted before: done once two judges agree; until then post again (the outcome is read afresh: two
# judges who read the city's wallet list minutes apart can differ, and a judge may replace its vote).
# Posted and the other judge hasn't yet: wait for it (no new transaction every tick).
if [ -f "outcomes-v3/$contract/$race.json" ]; then
  j=$($node call-v3.mjs judging "$race" 2>/dev/null | tail -1 || true)
  [[ "$j" == *agreed=yes* ]] && { echo "$race: agreed"; exit 0; }
  [[ "$j" == *B=yes* && "$j" == *A=no* ]] && { echo "$race: posted; waiting for judge A"; exit 0; }
fi
# Only a finished (or void) run is judged: the sealed judge's status in the run file. Not yet: try later.
status=$($node -e "try { console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).result?.status ?? 'none') } catch { console.log('none') }" "$file")
case "$status" in finished|cancelled|void) ;; *) echo "$race is '$status', not over: not judging yet"; exit 0 ;; esac
raw=$(timeout 1500 $node call-v3.mjs attest B "$race" "$file" 2>&1) && rc=0 || rc=$?
grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" <<<"$raw" || true
# Posting the same outcome again is refused: that is this judge's vote standing, not a failure.
grep -q "already attested this outcome" <<<"$raw" && rc=0
timeout 600 $node call-v3.mjs status 2>&1 | grep address || true
exit $rc
