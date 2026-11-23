# The pot: judges' tools

An outside judge: see [`JUDGE.md`](JUDGE.md).

What the two judges run around [`../contract/tail-pot.compact`](../contract/tail-pot.compact). How the
pot works and why: [`../contract/DESIGN.md`](../contract/DESIGN.md).

Midnight Preview, ledger v9: compiler 0.36.0, midnight-js 5.0.0, wallet-sdk 2.0.0, proof server
9.0.1. Keys, seeds and wallet state never go in this repo.

## Setup on a judge's machine

```sh
npm ci
./compile.sh                      # the contract, into contract/managed/tail-pot
```

A proof server 9.0.1 on the same machine (it sees what it proves): the lab runs one on
`127.0.0.1:6301` (the default); the games server starts one per call on `127.0.0.1:6300`
(`MIDNIGHT_PROOF_SERVER`), capped at 900 MB.

Secrets, outside the repo, read from the environment:

| Variable | File | Holds |
|---|---|---|
| `TAIL_POT_KEYS` | lab: `~/midnight/keys/tail-pot-test.json`; games server: `~/midnight-keys/judge-a.json` | the judge secret (and the owner secret, lab only) |
| `TAIL_POT_WALLET` | lab: `~/midnight/keys/carol-preview.json`; games server: `~/midnight-keys/judge-a.json` | the wallet seed that pays fees |
| `TAIL_POT_DEPLOYMENT` | `deployment.json` here | the pot contract (written by `deploy.mjs`) |

## Commands

| Command | What |
|---|---|
| `node deploy.mjs <SEAL.sha256> [window s]` | Deploy a pot (owner, lab). `JUDGE_A_PUB=<hex>` names judge A's public key from the games server |
| `node call.mjs fund <atomic>` | Add tNIGHT (1 tNIGHT = 1,000,000) |
| `node call.mjs attest A\|B <run id> <run file>` | Attest a run's outcome |
| `node call.mjs settle <run id> <run file>` | Settle it after the window |
| `node call.mjs close <mn_addr_preview1…>` | Owner: end a pot, what's left to that address |
| `node call.mjs status \| balance \| race-id` | Read the pot; tonight's run id from the sealed schedule |
| `node verify.mjs <pot address>` | Check a deployed pot runs this source's circuits (compile first) |
| `node judge-key.mjs <keys file> <A\|B\|C>` | Make a judge's secret on its machine; print the public key for deploying |
| `node status.mjs [fund]` | Sync the wallet, show tNIGHT and DUST (`fund`: register tNIGHT for DUST) |
| `node send.mjs <mn_addr_preview1…> <atomic>` | Move tNIGHT between test wallets |
| `node edge.mjs` | The edge-case suite (a test pot only) |

## The v2 pot (contract/tail-pot-v2.compact)

Separate tools, so the v1 pot keeps running until the switch. They load the v2 contract themselves;
the v2 deployment is `deployment-v2.json` (or `TAIL_POT_DEPLOYMENT`).

| Command | What |
|---|---|
| `node deploy-v3.mjs <SEAL.sha256> <operator mn_addr> <migration mn_addr> <reserve min> <reserve max> <key>,<key>[,…5]` | Deploy a v3 pot (the live one from the v3 switch): no owner key, no entries; a sponsor auction per run |
| `node call-v3.mjs open-run <judge A..E> <run id> <start ISO> [--price <usd>]` | Open a run: reserve $5 and minimum raise $1 in NIGHT at CoinGecko's price; the auction closes an hour before the start |
| `node call-v3.mjs auction <run id>` | A run's auction: reserve, raise, close, bids, top bid, its wallet, banner hash and link |
| `node call-v3.mjs bid <run id> <mn_addr> <atomic> <image file> <https link>` | A bid (this kit's wallet pays): beats the top by 10% or the raise; the previous top bid goes back in the same transaction |
| `node call-v3.mjs add <atomic>` | Add to the pot with no banner (how a moved pot arrives) |
| `node call-v3.mjs attest <judge A..E> <run id> <run file>` | Post the outcome: valid or void, the pot winner (best finisher with its own wallet; who was passed over is recorded) |
| `node call-v3.mjs settle <run id \| move id>` | Settle the outcome this judge attested (saved in `outcomes-v3/`), with the operator's tenth of the winning bid |
| `node call-v3.mjs sweep` / `rotate` / `move` / `status` / `run-id [next]` | As v2 |
| `./attest-v3-a.sh auto`, `./settle-v3-a.sh auto`, `./open-run-v3-a.sh [next\|today]`, `./pot-night-v3.sh auto` | The judges' scheduled jobs (games server: A; lab: B) |
| `node banner-v3.mjs fetch <run id\|auto> <web data>` / `approve` / `reject` / `list` | After the close: fetch the winning banner, check it (hash, PNG/JPEG/WebP, 1200 x 200, <= 300 KB), hold it outside the site until the operator approves |
| `node pot-data-v3.mjs <web data dir>` | The pot, the current run and its auction for the site (`pot.json`, `pot-runs.json`) |

The v2 tools (live until the v3 switch):

| `node deploy-v2.mjs <SEAL.sha256> <operator mn_addr> <migration mn_addr> <fee min> <fee max> <key>,<key>[,…5]` | Deploy a v2 pot: no owner key. Judge public keys in slot order A..E; the migration address receives the pot if two judges move it |
| `node call-v2.mjs open-run <judge A..E> <run id> <start ISO> [--price <usd>]` | Open a run: fee = $1 in NIGHT at CoinGecko's price, cut = a tenth |
| `node call-v2.mjs enter <run id> <mn_addr>` / `sponsor <run id> <mn_addr> <atomic>` | An agent's entry (its own wallet) / sponsorship (all to the pot) |
| `node call-v2.mjs attest <judge A..E> <run id> <run file>` | Post the outcome: valid or void, the pot winner among paid finishers |
| `node call-v2.mjs settle <run id \| move id>` | Settle the outcome this judge attested (saved in `outcomes-v2/`) |
| `node call-v2.mjs refund <run id> <mn_addr>` / `sweep` | A void run's entrant gets the fee back / the operator's share to its address |
| `node call-v2.mjs rotate <judge> <slot> <key \| empty> [nonce]` | Add, replace or empty a judge slot: two judges back the same rotation (same nonce) |
| `node call-v2.mjs move <judge> <move id> <successor address>` | Move the pot to a successor: two judges, then `settle <move id>` |
| `node call-v2.mjs status` | The pot: judges, pot, operator due, runs |
| `./settle-v2-a.sh <run id>` | Games server: settle, then record what the pot did (`record-payout-v2.mjs`: run winner, pot winner, paid, rolled over or void) |
| `node pot-data-v2.mjs <web data dir>` | The pot and each run's entrants and sponsors for the site (`pot.json`, `pot-runs.json`) |

`test-v2.mjs` runs the contract's rules off-chain (compile with `--skip-zk` first). `verify.mjs` and
`judges.mjs` read v2 pots with `TAIL_POT_CONTRACT=tail-pot-v2` and `TAIL_POT_DEPLOYMENT`.

## The schedule (UTC, every day)

| Time | Machine | Job |
|---|---|---|
| 21:55 | lab | record the 22:00 run (`tail-rec/record.mjs`) |
| 22:40 | games server | v2: `attest-v2-a.sh auto` (v1: `attest-a.sh auto`): judge A, from `tail-watch`'s run file |
| 22:50 | lab | v2: `pot-night-v2.sh auto` (v1: `pot-night.sh attest auto`): judge B, from its own recording |
| 23:40 | games server | v2: `settle-v2-a.sh auto; open-run-v2-a.sh` (v1: `settle-a.sh auto`): settle, record, refunds of a void run, the operator's share; then open tomorrow's run |
| every minute | games server | v2: `pot-data-v2.mjs /var/www/tail/data` (v1: `deploy/pot-balance.mjs`): the pot for the site |

`auto` is today's run from the sealed schedule (v2 reads `TAIL_RULES`; Season 2: one official run
daily at 22:00 UTC; Season 1: practice daily, official on Fridays). Judge A and
the settle share a lock on the games server (one proof server at a time). Never schedule two calls
on one pot at the same moment.

## An ad hoc practice

At `<date>` `<HH:MM>` UTC, at least 15 minutes from any other run:

1. Games server: `~/tail-run/extra-runs.json` gets `{"kind": "practice", "at": "<ISO>"}`.
2. Lab: record it 5 minutes before, into `runs/<date>T<HHMM>.json` (the 22:00 run keeps `<date>.json`).
3. Judge A about 50 minutes after the start, judge B 10 minutes later, the settle after the
   window ends (start + 30 minutes + the window), each with the run id `<date>T<HHMM>-practice`.

## Rules the tools enforce

- Only a wallet the winner published (`external_display`) is paid. Without one when the judges
  attest, the outcome has no winner and the pot rolls over (`NO WALLET` in the log).
- An empty pot is not judged.

## Known limits

- If a settle's process dies after its transaction lands but before it prints `settle ok`, nothing
  records the transaction, and a re-run is refused (already settled). Find the settle transaction
  on the indexer and run `record-payout.mjs <run id> <tx> <run file> <payouts.json>` by hand.
