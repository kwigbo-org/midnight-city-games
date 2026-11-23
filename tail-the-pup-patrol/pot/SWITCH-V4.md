# The switch to Season 3 and the v4 pot (2026-11-23)

Season 3 rules (smell, newcomer bonus, true ties share a place) and the v4 pot (a true tie splits the
pot) go live together, for the 2026-11-23 22:00 run. Steps marked **(operator)** need the operator's
go-ahead at the time. Never during the pig race (no deploys or restarts 20:45–21:25 UTC) or a run
(22:00–22:20).

State on the evening before: v3 (`893ae730…`) holds the pot. Its 2026-11-23 run was opened by the
22:35 tick and has Gibson's 500 tNIGHT bid (placed a minute after the hold). The site shows that
auction as held (`/var/www/tail/data/auction-hold.json`; `pot-data-v3.mjs` publishes `held`).

## 0. Merge, seal **(operator)**

- Merge the Season 3 PR. `SEAL.sha256` lists Season 3's files, `veterans.json` among them; its sha256
  is the game hash v4 is deployed with. The sealed files go to the public repo (`tail-season-3`).
- Compile `contract/tail-pot-v4.compact` on the lab (`contract/managed/tail-pot-v4`), ship it to
  judge A: both machines hold the same `index.js` and keys.

## 1. The recorders and judges get Season 3

Both recorders must run the same files, with `veterans.json` beside them:

- games server `~/app/tail-the-pup-patrol` (watch.mjs, record.mjs, judge.mjs, rules.json,
  veterans.json, central-grid.json): restart `tail-watch` and `tail-second`. `watch.mjs` counts the
  season's runs from `/var/www/tail/data/runs`.
- lab `~/midnight/tail-rec` (record.mjs, judge.mjs, rules.json, veterans.json, central-grid.json,
  feed.mjs, citystate.mjs): its 21:55 cron is unchanged; `record.mjs` counts the season's runs from the
  folder of its `--out` file.
- both judge kits (`~/judge-a`, `~/midnight/tail-pot-kit`): the `pot/` tools from main
  (`pot-version.mjs`, `pot-v3.mjs`, `call-v3.mjs`, `record-payout-v3.mjs`, `deploy-v4.mjs`,
  `lib/midnight.mjs`).

## 2. Deploy v4 **(operator)**

Lab (judge B's wallet pays), with Season 3's seal and the same judges and organizer as v3:

```sh
node deploy-v4.mjs SEAL.sha256 <operator: kwigbo's mn_addr> <migration: the lab wallet's mn_addr> 1000000 10000000000 <judge A key>,<judge B key> <kwigbo's agent id>
```

Copy `deployment-v4.json` to judge A. Check on both: `TAIL_POT_DEPLOYMENT=deployment-v4.json node
call-v3.mjs status`.

## 3. Move v3's pot into v4 **(operator)**

```sh
# judge A (games server) and judge B (lab), each, on v3:
TAIL_POT_DEPLOYMENT=deployment-v3.json node call-v3.mjs move A move-to-v4 <v4 address>   # B on the lab
TAIL_POT_DEPLOYMENT=deployment-v3.json node call-v3.mjs settle move-to-v4                # once both posted
```

The pot goes to the migration wallet (the lab wallet); then on the lab
`TAIL_POT_DEPLOYMENT=deployment-v4.json node call-v3.mjs add <that amount>`. v3 is then closed: no
more bids, no more runs. Gibson's bid stays in v3, on its 2026-11-23 run, until step 7.

## 4. Point everything at v4

Change the default deployment to `deployment-v4.json` in `judge-a-tick.sh`, `attest-v3-a.sh`,
`settle-v3-a.sh`, `open-run-v3-a.sh`, `pot-night-v3.sh`, the two banner cron lines and
`tail-pot-balance.service` (`Environment=TAIL_POT_DEPLOYMENT=deployment-v4.json`; daemon-reload).
The tools load the v4 contract from the deployment's `"version": 4`.

## 5. Open the 2026-11-23 run on v4

Games server: `./open-run-v3-a.sh today` (its auction closes at 21:00). Then remove
`/var/www/tail/data/auction-hold.json`: the auction is live for sponsors.

## 6. The pages

Build the sponsor page on the lab against v4 (`fund/build.sh <…/managed/tail-pot-v4> out`), copy to the
site, and `deploy/publish.sh` (Season 3's `rules.json`, the rules text, the smell ring). Check in a
browser: the auction, the Rules (Season 3), the sponsor page bidding on v4.

## 7. After the run: refund Gibson's v3 bid (the run stands)

Tonight's run stands: it is judged on v4 under Season 3 like any other. Only Gibson's sponsor bid, left
in v3's copy of the run's auction, goes back, in full. The v3 contract returns a sponsor's bid only
through its kind-1 outcome, accepted after the run's start (22:00):

```sh
# each judge, after 22:00 on the 23rd, on v3 only:
TAIL_POT_DEPLOYMENT=deployment-v3.json node call-v3.mjs refund-sponsor A 2026-11-23T2200-official   # B on the lab
TAIL_POT_DEPLOYMENT=deployment-v3.json node call-v3.mjs settle 2026-11-23T2200-official             # once both posted
```

Run by hand, not through `settle-v3-a.sh`: **don't run `record-payout-v3.mjs` for it**. v3's copy shares
the run's id, and the site's payouts must show tonight's v4 result. Gibson can bid again on v4 under the
new rules.

## If anything isn't ready by 18:00 UTC

Fall back: remove the hold, leave v3 in place, and run the 23rd on Season 2. Gibson's bid then counts
as normal, and the switch moves to the next day.
