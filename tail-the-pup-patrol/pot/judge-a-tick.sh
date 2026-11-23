#!/bin/bash
# Judge A's tick on the games server, every 5 minutes through the evening (cron): does whatever is due
# for today's run, in order, and stops. Each step decides from the chain in seconds whether it has
# anything to do, so most ticks cost nothing:
#   1. attest, once the run file says the run is over (finished, cancelled or void);
#   2. settle, once two judges agree (pays the winner; then the operator's share);
#   3. open the next run's auction, once today's run is settled.
# A tick still running when the next one is due: the next one is skipped. Logs as before.
set -uo pipefail
cd "$(dirname "$0")"
node=/opt/node/bin/node
export TAIL_RULES=/var/www/tail/current/rules.json TAIL_POT_DEPLOYMENT="${TAIL_POT_DEPLOYMENT:-deployment-v4.json}"
exec 8>"$HOME/judge-a/.tick.lock"; flock -n 8 || exit 0
race=$($node call-v3.mjs run-id 2>/dev/null | awk '{print $1}')
[[ "$race" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$ ]] || exit 0
# Nothing to do before the run's file exists (the run hasn't been recorded yet).
[ -f "/var/www/tail/data/runs/$race.json" ] || exit 0
j=$($node call-v3.mjs judging "$race" 2>/dev/null | tail -1)
[[ "$j" == *settled=* ]] || { echo "$(date -u +%FT%TZ) tick: the pot is unreachable" >> logs/attest.log; exit 0; }
if [[ "$j" == *settled=yes* ]]; then
  # Settled: record it if that's still to do (the settle script does it); the next auction opens only
  # once the payout is on record (else the next tick tries again).
  recorded() { grep -qF "\"$race\"" /var/www/tail/data/payouts.json 2>/dev/null; }
  contract=$($node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.TAIL_POT_DEPLOYMENT, 'utf8')).address)")
  if ! recorded; then
    if [ -f "outcomes-v3/$contract/$race.settled" ]; then
      # Settled here, not yet recorded: the settle script records it (else the next tick tries again).
      ./settle-v3-a.sh "$race" >> logs/settle.log 2>&1
      recorded || exit 0
    else
      # Settled from elsewhere: nothing here can record it (record-payout-v3.mjs, by hand, with its tx).
      [ -f "outcomes-v3/$contract/$race.unrecorded" ] || { echo "$(date -u +%FT%TZ) $race: settled, but not from this machine: record its payout by hand" >> logs/settle.log; touch "outcomes-v3/$contract/$race.unrecorded"; }
    fi
  fi
  next=$($node call-v3.mjs run-id upcoming 2>/dev/null | awk '{print $1}')
  [[ "$next" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$ ]] || exit 0
  grep -qF "\"$next\"" "outcomes-v3/$contract/opened.json" 2>/dev/null || ./open-run-v3-a.sh >> logs/open.log 2>&1
  exit 0
fi
[[ "$j" == *agreed=yes* ]] && { ./settle-v3-a.sh "$race" >> logs/settle.log 2>&1; exit 0; }
./attest-v3-a.sh "$race" >> logs/attest.log 2>&1
