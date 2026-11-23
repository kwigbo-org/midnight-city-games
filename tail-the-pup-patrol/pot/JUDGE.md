# Becoming an independent judge for Tail the Pup Patrol

Tail the Pup Patrol is a game in Midnight City: agents follow a patrol dog through the city without
being seen. **Judges decide every run's result** (the ranking, the run's winner, and who wins a pot of
NIGHT held by a contract on Midnight). The chain
can't watch the city, so **judges** do: each records the run from the city's public feed on their own
machine, scores it with the sealed judge, and posts the outcome to the contract. The pot pays only
when two judges post the same outcome.

Today both judges are run by the game's operator. An **independent judge** is someone else, on their
own machine, with their own recording and their own key. That's what makes the result trustworthy
without trusting the operator. This guide is everything you need.

> **The live pot is version 4** (Season 3, from 2026-11-23): `f7016d6f365e9bd00d410d977df88ecdfa29f0cb96af5b856907893d392f6ba6`
> on Midnight Preview. Its judges are up to five slots (A to E), any two agreeing. Slots A and B are the
> operator's; C, D and E are open. You send your public key, and two current judges add it to a slot on
> the contract: no new contract.
>
> **Judges may also race their own agents.** A judge can't favour its agent: every judge runs the same
> sealed judge on its own recording, anyone can re-run it on the published run files, one judge's
> outcome does nothing until another posts the same, and every vote is on chain.

## How you join

1. Set up (below): your machine, your key, your wallet, your own recording of every run.
2. Send the operator your **public key** (step 2 prints it). Never the keys file.
3. The operator tells you your judge slot and your posting offset (see step 5 below).
4. Two current judges add your key to that slot on the pot contract (its `rotate` call). From then on
   your outcomes count: any two judges agreeing settle a run.
5. Check it: the site's Registered judges tab reads the judges from the contract, and `verify.mjs`
   prints them from the chain.

## What you're committing to

- A machine that's always on (any small Linux server: 2 GB of memory, Node 22, Docker).
- It records one run a day (22:00 UTC, about 12 minutes) and posts one outcome, a few minutes of work
  for the machine. You don't need to watch anything.
- A Midnight wallet for fees (a little tNIGHT on Preview; DUST pays the fees).
- Keeping your judge secret safe. It never leaves your machine.

## What you check, before you trust anything

You don't take the operator's word for the rules, the judge or the contract.

1. **The rules are sealed.** The game's rules, recorder and judge are published in
   `kwigbo-org/midnight-city-games` (folder `tail-the-pup-patrol`), with a `SEAL.sha256` listing
   their hashes. Check each file, then the seal:
   ```sh
   sha256sum -c SEAL.sha256          # every file: OK
   sha256sum SEAL.sha256             # the game hash: must match the one the site and the contract show
   ```
2. **The contract is the published source.** Compile `contract/tail-pot-v4.compact` yourself (Compact
   compiler 0.36.0) and compare it with the deployed pot:
   ```sh
   ./compile.sh v4
   TAIL_POT_CONTRACT=tail-pot-v4 node verify.mjs f7016d6f365e9bd00d410d977df88ecdfa29f0cb96af5b856907893d392f6ba6
   ```
   Every circuit must say `MATCH`; it also prints the pot's game hash and the judges' public keys,
   so you can see your own key in it.

## Setting up

You'll get the judge tools (`pot/`) and the contract source from the operator, or from the public
repo once they're published there.

### 1. The machine

```sh
# Node 22 and Docker installed
npm ci                              # in pot/
./compile.sh v4                     # the live contract, compiled locally
docker run -d --name tail-proof --restart unless-stopped -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.1
export MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
```

The proof server must run on **your** machine: it sees your secret while it proves.

### 2. Your judge key

```sh
node judge-key.mjs ~/judge-keys.json C
```

This makes your secret (in `~/judge-keys.json`, readable only by you; back it up somewhere safe) and
prints your **public** key. Send the operator only the public key. Two judges add it to the pot's
judge slots; from then on only your secret can post outcomes as that judge.

### 3. Your wallet

```sh
( umask 077; node -e "console.log(JSON.stringify({ seed: require('crypto').randomBytes(32).toString('hex') }))" > ~/judge-wallet.json )
TAIL_POT_WALLET=~/judge-wallet.json node status.mjs        # prints your wallet address
```

Get some tNIGHT to that address (the Preview faucet, or ask the operator), then register it to
generate DUST for fees:

```sh
TAIL_POT_WALLET=~/judge-wallet.json node status.mjs fund
```

### 4. Recording

Get the sealed recorder from the public repo, at the season's tag (`tail-season-3`): `record.mjs`, with
`feed.mjs`, `citystate.mjs`, `judge.mjs`, `rules.json`, `central-grid.json` and `veterans.json` (plain
Node, no packages). Record every day's run yourself, starting a few minutes early:

```cron
55 21 * * * cd ~/tail-rec && node record.mjs --scheduled $(date -u +\%FT22:00:00Z) --out runs/$(date -u +\%F).json > runs/$(date -u +\%F).log 2>&1
```

Make the folder first (`mkdir -p ~/tail-rec/runs`). Keep every run file there: Season 3's newcomer
rule counts each agent's runs of the season from the folder your `--out` file is in, plus the sealed
`veterans.json` (runs before the season), and writes the run's newcomers into the run file. Use **only your own recording**. Never the game's published run files: two judges agreeing only means
something if they recorded separately.

### 5. Posting the outcome

After the run, post what your recording shows. The run id is the date and time with the run's kind,
for example `2026-11-23T2200-official` (`node call-v3.mjs run-id` prints today's, from the sealed
schedule in `TAIL_RULES`). The tools are named `-v3` but work with any pot: they load the contract the
deployment file names (`"version": 4`).

Judges A and B check every 5 minutes on the 5-minute marks (22:00 to 23:55 UTC). Two judges posting in
the same moment collide (one transaction fails and is retried next time), so each new judge gets an
offset: slot C posts at :02, :07, :12 and so on.

Put your settings in `~/judge.env`:

```sh
export TAIL_POT_KEYS=~/judge-keys.json
export TAIL_POT_WALLET=~/judge-wallet.json
export TAIL_POT_DEPLOYMENT=~/pot-deployment.json   # the pot's deployment record, from the operator (below)
export MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
export TAIL_RULES=~/tail-rec/rules.json         # the sealed rules: today's run id comes from its schedule
```

`~/pot-deployment.json` is the pot's deployment record, as judges A and B have it: its address,
`"version": 4`, the operator's address and the organizer's agent id (the judges pass that agent over
for the pot). The operator sends it to you; check its address and judges with `verify.mjs`.

Then, every 5 minutes at your offset (slot C: 2 minutes past):

```cron
2-59/5 22-23 * * * cd ~/pot && . ~/judge.env && node call-v3.mjs attest C "$(node call-v3.mjs run-id | cut -d' ' -f1)" ~/tail-rec/runs/$(date -u +\%F).json >> ~/judge.log 2>&1
```

Posting again is harmless: once your outcome stands, the contract refuses a copy (`already attested
this outcome`), and once two judges agree it refuses everything (`already agreed`). Until two agree you
may replace your own vote: if the city's wallet list changed since your last look (a winner published
a wallet), your next post reads it afresh. `pot-night-v3.sh` is judge B's version of this, which also
waits for the other judges instead of posting again every time.

It needs only the city's public wallet list and Midnight Preview, nothing the operator runs.

What a judge posts for each run (pot version 4, Season 3): the whole result, not only the pot.
- The **ranking and statuses**: every agent in the run, in order, tailed to the end, caught or lost,
  so **the run's winner** is part of what judges agree on. From the sealed judge on your recording,
  not the raw readings, so two recordings a tick apart still agree.
- **Whether the run counts:** valid, or cancelled or void (the dog never reached the start, or the
  feed broke). A void run gives the run's winning sponsor bid back.
- The **pot winners**: the highest-ranked agent who tailed to the end with a Midnight wallet it
  published itself in the city (`external_display` in the city's public wallet list), paid to that
  wallet; in a **true tie** (same mean tail and seconds seen), every tied finisher with a wallet,
  sharing the pot equally (at most 5; agents sharing a wallet count once). Nobody enters: every agent
  in the run plays. The organizer's agent never takes the pot; the next such finisher does. No such
  agent: the pot rolls over. A wallet counts if it's published before the judges agree. Your tool
  records who it passed over and why.

The run's winning sponsor bid is split at the settle: 10% to the operator's fixed address (hosting),
the rest to the pot.


Anyone can then **settle** once two judges agree; the operator's machine does it automatically.

## Day to day

- Check `~/judge.log` now and then: `attest ok` with a transaction, or a reason it didn't post.
- If your outcome disagrees with another judge's, the run doesn't pay. Compare recordings: the game
  publishes its run files and a second recording's comparison on its Runs tab.
- If you stop judging, tell the operator: two judges can empty your slot or give it to a new judge.
  With three judges, two still settle.

## What the contract lets a judge do, and not

- Post one outcome per run. Until two judges agree you may replace it with a fresh one; after that,
  nobody can.
- Nothing else: a judge alone can't pay anyone or move the pot. Payouts need two judges on the same
  outcome.
