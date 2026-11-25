#!/bin/bash
# Judge A on the games server: open the next scheduled run on the v3 pot, with its sponsor auction:
# a $5 reserve and a $1 minimum raise in NIGHT, priced now (CoinGecko). The auction closes an hour
# before the run's start.
#   ./open-run-v3-a.sh [upcoming|next|today]   upcoming (default): the first scheduled run not yet
#   started (after a settle, even one that ran past midnight); next = tomorrow's; today = today's
# Does nothing if that run is already open on the pot.
set -euo pipefail
cd "$(dirname "$0")"
node=/opt/node/bin/node
export TAIL_RULES="${TAIL_RULES:-/var/www/tail/current/rules.json}" TAIL_POT_DEPLOYMENT="${TAIL_POT_DEPLOYMENT:-deployment-v4.json}"
which="${1:-upcoming}"
case "$which" in upcoming) read -r race start < <($node call-v3.mjs run-id upcoming) ;; next) read -r race start < <($node call-v3.mjs run-id next) ;; today) read -r race start < <($node call-v3.mjs run-id) ;; *) echo "upcoming|next|today"; exit 1 ;; esac
[[ "$race" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$ ]] || { echo "no scheduled run ($which)"; exit 1; }
echo "== $(date -u +%FT%TZ) open (v3) $race, start $start"
contract=$($node -e "console.log(JSON.parse(require('fs').readFileSync(process.env.TAIL_POT_DEPLOYMENT, 'utf8')).address)")
if grep -qF "\"$race\"" "outcomes-v3/$contract/opened.json" 2>/dev/null; then echo "already open"; exit 0; fi
exec 9>"$HOME/judge-a/.proof.lock"; flock 9 # one proof server at a time
export TAIL_POT_KEYS=~/midnight-keys/judge-a.json TAIL_POT_WALLET=~/midnight-keys/judge-a.json MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
cleanup() { docker rm -f judge-a-proof >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup
docker run -d --name judge-a-proof --memory 2g --memory-swap 2g -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.1 >/dev/null
for i in $(seq 30); do curl -sf -m 2 http://127.0.0.1:6300/version >/dev/null && break; sleep 2; done
raw=$(timeout 1500 $node call-v3.mjs open-run A "$race" "$start" 2>&1) && rc=0 || rc=$?
grep -v "RPC-CORE\|^\s*at \|API/INIT\|INFO" <<<"$raw" || true
exit $rc
