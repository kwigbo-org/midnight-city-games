# The switch from the v2 pot to v3

v2 (`5ffbdd44…`, entry fees) is live; v3 (no entries, a sponsor auction fills the pot) replaces it.
The sealed rules don't change: still Season 2. Steps marked **(operator)** need the operator's
go-ahead at the time. Never during the pig race (no deploys or restarts 20:45–21:25 UTC) or a run
(22:00–22:20).

## The day before

- **(operator)** Merge the v3 PR. Sync both kits to `pot/` on main (judge A `~/judge-a`, judge B
  `~/midnight/tail-pot-kit`), and the games server's `~/app/tail-the-pup-patrol` (site, deploy).
- Compile `contract/tail-pot-v3.compact` on the lab (`contract/managed/tail-pot-v3`) and ship it to
  judge A: both machines hold the same `index.js` and keys.
- Move aside any test `deployment-v3*.json` on both machines.
- **No v2 run may open after the switch day's:** on the switch day, before 23:40, take
  `open-run-v2-a.sh` out of judge A's crontab (keep the attest and settle lines). Any v2 run
  already open is judged and settled as usual.

## 1. Deploy v3 **(operator)**

Lab (judge B's wallet pays):

```sh
node deploy-v3.mjs SEAL.sha256 <operator: kwigbo's mn_addr> <migration: the lab wallet's mn_addr> 1000000 10000000000 <judge A key>,<judge B key> <kwigbo's agent id>
```

kwigbo's agent id is in the city's public agent list (by name); it goes only into deployment-v3.json
on the two machines (the judges pass that agent over for the pot), never into the repo.

Copy `deployment-v3.json` to judge A. Check on both: `TAIL_POT_CONTRACT=tail-pot-v3 node verify.mjs
<address>` VERIFIED, and `node call-v3.mjs status`.

## 2. Move v2's pot into v3 **(operator)**

After v2's last run is settled (v2's `status`: no open run with entries):

```sh
# judge A (games server) and judge B (lab), each:
node call-v2.mjs move A move-to-v3 <v3 address>     # B on the lab
node call-v2.mjs settle move-to-v3                   # either judge, once both posted
```

The pot goes to the migration wallet (the lab wallet). Lab: `node call-v3.mjs add <that amount>`.
Check: v2 `status` open false, pot 0; v3 `status` pot = the amount.

## 3. Open the first v3 run

Games server: `./open-run-v3-a.sh next` (or `today`, if its auction can still run: it closes an hour
before the start).

## 4. The schedules

Official results by about 23:00 (operator, 2026-11-17: a short deliberation; v1's hour-long dispute
window is gone). Each job has retries; a retry does nothing if the first attempt worked (the judge's
saved outcome, the kept settle, the opened run), and a judge waits until the run file says the run is
over. Games server crontab (replace the v2 lines):

```cron
1 21 * * * cd $HOME/judge-a && TAIL_POT_DEPLOYMENT=deployment-v3.json TAIL_RULES=/var/www/tail/current/rules.json /opt/node/bin/node banner-v3.mjs fetch auto /var/www/tail/data >> logs/banner.log 2>&1
31 21 * * * cd $HOME/judge-a && TAIL_POT_DEPLOYMENT=deployment-v3.json TAIL_RULES=/var/www/tail/current/rules.json /opt/node/bin/node banner-v3.mjs fetch auto /var/www/tail/data >> logs/banner.log 2>&1
30,45 22 * * * $HOME/judge-a/attest-v3-a.sh auto >> $HOME/judge-a/logs/attest.log 2>&1
15 23 * * * $HOME/judge-a/attest-v3-a.sh auto >> $HOME/judge-a/logs/attest.log 2>&1
55 22 * * * $HOME/judge-a/settle-v3-a.sh auto >> $HOME/judge-a/logs/settle.log 2>&1; $HOME/judge-a/open-run-v3-a.sh >> $HOME/judge-a/logs/open.log 2>&1
25,50 23 * * * $HOME/judge-a/settle-v3-a.sh auto >> $HOME/judge-a/logs/settle.log 2>&1; $HOME/judge-a/open-run-v3-a.sh >> $HOME/judge-a/logs/open.log 2>&1
0 6 * * * $HOME/judge-a/settle-v3-a.sh $(date -u -d yesterday +\%F)T2200-official >> $HOME/judge-a/logs/settle.log 2>&1; $HOME/judge-a/open-run-v3-a.sh >> $HOME/judge-a/logs/open.log 2>&1
```

(The banner is fetched at 21:01, after the usual close, and again at 21:31, after the latest a soft
close can reach; the second does nothing if the first already fetched it. The 06:00 line is the
morning retry, after an outage: `auto` would name the new day by then, so it settles yesterday's run
by its id (one run a day at 22:00); `\%` because cron treats a bare `%` as a newline.)

Lab crontab: replace `pot-night-v2.sh auto` (22:50) with `pot-night-v3.sh auto` at 22:40, 22:55 and
23:25.

`tail-pot-balance.service`: `ExecStart=/opt/node/bin/node pot-data-v3.mjs /var/www/tail/data`,
`Environment=TAIL_POT_DEPLOYMENT=deployment-v3.json`; `systemctl daemon-reload`. Check:
`data/pot.json` has `"version": 3` and the run with its auction.

## 5. The pages

Build the sponsor page on the lab (`fund/build.sh <the v3 contract's compiled dir> out`), copy `out/`
to the games server's `site/fund/`, and `deploy/publish.sh`. Check in a browser: the Overview's
sponsor panel and chip, the Rules (v3 text), `/fund/` (the auction), `/judge/`.

## Every evening: the banner **(operator)**

After the close, a fetched banner waits for approval: `node banner-v3.mjs list /var/www/tail/data`
on the games server, look at `banners-pending/<hash>.<ext>`, then `approve <run id>` or
`reject <run id> <why>`. Until then the site shows "Sponsored by" with the bid.

## After

- One real bid from Lace on Preview (its own fee estimate).
- The memory and the shared judge guide updated with the live contract address.

## Fast judging: 5-minute ticks and saved wallet state (2026-11-19)

Each judge's wallet state is saved after every sync, next to its key file (`<wallet>.sync.json`, owner
only: coins and sync position, no seed). The next start restores it and catches up on the blocks since:
a judge transaction takes about 40 s end to end instead of 6 to 10 minutes. A saved state that won't
restore or catch up within 3 minutes is deleted and the wallet syncs from scratch
(`TAIL_POT_NO_SAVED_SYNC=1` forces that).

The judges no longer wait for fixed times. Every 5 minutes from 22:00 to 23:55 each checks the chain
(`call-v3.mjs judging <run>`: each judge's vote, agreed, settled) and does what's due, in seconds when
there's nothing to do:

- judge A (`judge-a-tick.sh`): attest once the run file says the run is over; settle once the two
  judges agree (then the operator's share); open the next auction once today's run is settled;
- judge B (`pot-night-v3.sh`): attest once its recording says the run is over.

A judge that has posted waits for the other (no new transaction every tick); it posts again only if
the two disagree. A tick still running when the next is due is skipped (a lock). Official results:
about 10 to 15 minutes after the run ends.

Games server crontab: replace the attest lines (22:30, 22:45, 23:15) and the settle lines (22:55,
23:25, 23:50) with one line; keep the banner fetches and the 06:00 settle:

    */5 22-23 * * * $HOME/judge-a/judge-a-tick.sh

Lab crontab: replace the pot-night-v3.sh lines (22:40, 22:55, 23:25) with:

    */5 22-23 * * * $HOME/midnight/tail-pot-kit/pot-night-v3.sh auto >> $HOME/midnight/tail-pot-kit/logs/pot-night.log 2>&1
