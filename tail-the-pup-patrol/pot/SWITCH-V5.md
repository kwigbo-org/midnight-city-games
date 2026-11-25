# The switch to Season 4 and the v5 pot (2026-11-25)

Season 4 rules (smell, newcomer bonus, true ties share a place) and the v5 pot (a true tie splits the
pot) go live together, for the 2026-11-25 22:00 run. Steps marked **(operator)** need the operator's
go-ahead at the time. Never during the pig race (no deploys or restarts 20:45–21:25 UTC) or a run
(22:00–22:20).

State on the evening before: v4 (`f7016d6f…`) holds the pot. Its 2026-11-25 run was opened by the
22:35 tick on the 24th and has one bid (halfhand.dev's wallet `afa5d32a…`, 250.919010 tNIGHT, 22:41),
placed before the site hold went up (22:59). The site shows that auction as held.

The recorders also need the drand beacon (`rules.glance.beacon`): outbound HTTPS to api.drand.sh,
api2.drand.sh or drand.cloudflare.com from both the games server and the lab.

## 0. Merge, seal **(operator)**

- Before sealing, rebuild `veterans.json` from the site's run files (`node veterans.mjs
  /var/www/tail/data/runs`): every run before 2026-11-25, quick exits (lost or caught within 60 s) not
  counted. It must equal the committed one.
- Merge the Season 4 PR. `SEAL.sha256` lists Season 4's files, `veterans.json` among them; its sha256
  is the game hash v5 is deployed with. The sealed files go to the public repo (`tail-season-4`).
- Compile `contract/tail-pot-v5.compact` on the lab (`contract/managed/tail-pot-v5`), ship it to
  judge A: both machines hold the same `index.js` and keys.

## 1. The recorders and judges get Season 4

Both recorders must run the same files, with `veterans.json` beside them:

- games server `~/app/tail-the-pup-patrol` (watch.mjs, record.mjs, judge.mjs, beacon.mjs,
  vendor/bls12-381.bundle.mjs, rules.json, veterans.json, central-grid.json): restart `tail-watch` and `tail-second`. `watch.mjs` counts the
  season's runs from `/var/www/tail/data/runs`.
- lab `~/midnight/tail-rec` (record.mjs, judge.mjs, beacon.mjs, vendor/bls12-381.bundle.mjs,
  rules.json, veterans.json, central-grid.json, feed.mjs, citystate.mjs): its 21:55 cron is unchanged; `record.mjs` counts the season's runs from the
  folder of its `--out` file.
- both judge kits (`~/judge-a`, `~/midnight/tail-pot-kit`): the `pot/` tools from main
  (`pot-version.mjs`, `pot-v3.mjs`, `call-v3.mjs`, `record-payout-v3.mjs`, `deploy-v5.mjs`,
  `lib/midnight.mjs`), plus `beacon.mjs`, `vendor/bls12-381.bundle.mjs` and Season 4's `rules.json`
  beside them: `attest` refuses a run whose beacon rounds aren't all there and verified. If it does,
  on the recorder's machine: `node beacon.mjs <run file> --fill` (fetches the rounds from the beacon's
  history, judges the run again), then attest.

## 2. Deploy v5 **(operator)**

Lab (judge B's wallet pays), with Season 4's seal and the same judges and organizer as v4:

```sh
node deploy-v5.mjs SEAL.sha256 <operator: kwigbo's mn_addr> <migration: the lab wallet's mn_addr> 1000000 10000000000 <judge A key>,<judge B key> <kwigbo's agent id>
```

Copy `deployment-v5.json` to judge A. Check on both: `TAIL_POT_DEPLOYMENT=deployment-v5.json node
call-v3.mjs status`.

## 3. Move v4's pot into v5 **(operator)**

```sh
# judge A (games server) and judge B (lab), each, on v4:
TAIL_POT_DEPLOYMENT=deployment-v4.json node call-v3.mjs move A move-to-v5 <v5 address>   # B on the lab
TAIL_POT_DEPLOYMENT=deployment-v4.json node call-v3.mjs settle move-to-v5                # once both posted
```

The pot goes to the migration wallet (the lab wallet); then on the lab
`TAIL_POT_DEPLOYMENT=deployment-v5.json node call-v3.mjs add <that amount>`. v4 is then closed: no
more bids, no more runs. halfhand.dev's bid stays in v4, on its 2026-11-25 run, until step 7.

## 4. Point everything at v5

Change the default deployment to `deployment-v5.json` in `judge-a-tick.sh`, `attest-v3-a.sh`,
`settle-v3-a.sh`, `open-run-v3-a.sh`, `pot-night-v3.sh`, the two banner cron lines and
`tail-pot-balance.service` (`Environment=TAIL_POT_DEPLOYMENT=deployment-v5.json`; daemon-reload).
The tools load the v5 contract from the deployment's `"version": 5`.

## 5. Open the 2026-11-25 run on v5

Games server: `./open-run-v3-a.sh today` (its auction closes at 21:00). Then remove
`/var/www/tail/data/auction-hold.json`: the auction is live for sponsors.

## 6. The pages

Build the sponsor page on the lab against v5 (`fund/build.sh <…/managed/tail-pot-v5> out`), copy to the
site, and `deploy/publish.sh` (Season 4's `rules.json`, the rules text, the smell ring). Check in a
browser: the auction, the Rules (Season 4), the sponsor page bidding on v5.

## 7. After the run: refund halfhand.dev's v4 bid (the run stands)

Tonight's run stands: it is judged on v5 under Season 4 like any other. Only halfhand.dev's sponsor bid, left
in v4's copy of the run's auction, goes back, in full. The v4 contract returns a sponsor's bid only
through its kind-1 outcome, accepted after the run's start (22:00):

```sh
# each judge, after 22:00 on the 25th, on v4 only:
TAIL_POT_DEPLOYMENT=deployment-v4.json node call-v3.mjs refund-sponsor A 2026-11-25T2200-official   # B on the lab
TAIL_POT_DEPLOYMENT=deployment-v4.json node call-v3.mjs settle 2026-11-25T2200-official             # once both posted
```

Run by hand, not through `settle-v3-a.sh`: **don't run `record-payout-v3.mjs` for it**. v4's copy shares
the run's id, and the site's payouts must show tonight's v5 result. halfhand.dev can bid again on v5 under the
new rules.

## If anything isn't ready by 18:00 UTC

Fall back: remove the hold, leave v4 in place, and run the 25th on Season 3. halfhand.dev's bid then counts
as normal, and the switch moves to the next day.
