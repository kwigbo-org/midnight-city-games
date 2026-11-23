# The switch to Season 2 and the v2 pot

One evening, in this order, outside the pig race (no deploys or restarts 20:45–21:25 UTC) and not
while a run is under way (22:00–22:20). Best between 23:45 and 20:30 UTC the next day. Steps marked
**(operator)** need the operator's go-ahead at the time.

## Before

- The migration address (the wallet a moved pot goes to, to fund a successor): **(operator)**.
- This PR reviewed and merged; the games server's checkout pulled (`~/app`).
- Judge A's kit (`~/judge-a`) and judge B's (`~/midnight/tail-pot-kit`) synced to `pot/` on main,
  and both compile `contract/tail-pot-v2.compact` the same (same `index.js`, same keys).
- Old test deployments moved aside on both machines: `deployment-v2.json` must not exist yet.

## 1. Seal Season 2 in public **(operator)**

Publish the sealed files (`rules.json`, `judge.mjs`, `central-grid.json`, `record.mjs`, `feed.mjs`,
`citystate.mjs`, `compare.mjs`, `watch.mjs`, `SEAL.sha256`, `RULES.md`) to the public repo
`kwigbo-org/midnight-city-games`, folder `tail-the-pup-patrol`. Tag that commit `tail-season-2`: the
site's "sealed rules" link points at the tag (`site/index.html`, `.sealed a`). Check: `sha256sum -c SEAL.sha256` all OK,
and `sha256sum SEAL.sha256` = the Season 2 game hash on the site (`54d63885…`).

## 2. Season 2 on the servers

- Games server: copy the sealed files to `~/tail-run`, restart `tail-watch` and `tail-second`
  (no run under way), then `deploy/publish.sh`.
- Lab: copy `rules.json` (and any changed sealed file) to `~/midnight/tail-rec/`.
- Check: `live.json`'s next run is `<date>T2200-official`.

## 3. Deploy the v2 pot **(operator)**

On the lab (judge B's wallet pays):

```sh
node deploy-v2.mjs SEAL.sha256 <operator: kwigbo's mn_addr> <migration mn_addr> <fee min> <fee max> <judge A key>,<judge B key>
```

Copy `deployment-v2.json` to judge A (`~/judge-a/`). Check: `node verify.mjs` VERIFIED on both
machines (with `TAIL_POT_CONTRACT=tail-pot-v2`), and `call-v2.mjs status` shows judges A and B.

## 4. Open the first run

Games server: `./open-run-v2-a.sh today` (or `next` after 22:00).

## 5. The v1 pot's last owner call **(operator)**

Lab: `node call.mjs close <lab wallet mn_addr>`, the v1 owner key's last use. Then carry the pot
over: `node call-v2.mjs sponsor <first run id> <wallet the site credits> <amount>`. **(operator)**:
which wallet the site credits for it (the lab wallet shows as an unnamed wallet). Then retire the
owner key (move it out of the kit, offline).

## 6. The schedules

- Games server crontab: replace the v1 lines with
  `40 22 * * * $HOME/judge-a/attest-v2-a.sh auto >> $HOME/judge-a/logs/attest.log 2>&1` and
  `40 23 * * * $HOME/judge-a/settle-v2-a.sh auto >> $HOME/judge-a/logs/settle.log 2>&1; $HOME/judge-a/open-run-v2-a.sh >> $HOME/judge-a/logs/open.log 2>&1`.
- Lab crontab: replace the `pot-night.sh attest auto` line with
  `50 22 * * * $HOME/midnight/tail-pot-kit/pot-night-v2.sh auto >> $HOME/midnight/tail-pot-kit/logs/pot-night.log 2>&1`.
- Games server: install `deploy/tail-pot-balance.service` (the v2 publisher), `systemctl daemon-reload`.
  Check: `data/pot.json` has `"version": 2` and the next run.

## 7. The pages

Build the entry page on the lab (`fund/build.sh <the v2 contract's compiled dir> out`), copy `out/`
to the games server's `site/fund/`, and `deploy/publish.sh`: the entry page and the judge page go
out together. Check in a browser: the Overview shows the fee and "Enter the pot", the Rules show the
v2 text, `/fund/` connects, `/judge/` loads.

## After

- One real entry from Lace on Preview (its own fee estimate, not the kit's).
- The memory and the shared judge guide updated with the live contract address.
