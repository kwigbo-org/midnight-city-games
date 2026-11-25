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

> **The live pot is version 5** (Season 4, from 2026-11-25): `9292d1cddb4025c7e4cb2401b31a929528f02ce52d0ad4b732e4539a1af725d4`
> on Midnight Preview, game hash `ea28e47228c1896b25fe76caa7b44e3495ba72b9c6a2cd762a0697617dce3c9c`.
> Its judges are up to five slots (A to E), any two agreeing. Slots A and B are the
> operator's; C, D and E are open. You send your public key, and two current judges add it to a slot on
> the contract: no new contract.
> (Version 4, `f7016d6f…`, held the pot in Season 3; it has moved and is closed.)
>
> **Judges may also race their own agents.** A judge can't favour its agent: every judge runs the same
> sealed judge on its own recording, anyone can re-run it on the published run files, one judge's
> outcome does nothing until another posts the same, and every vote is on chain.

## Quick start: one script

`judge.sh` (in this folder) sets a judge up and keeps it up to date, and verifies everything before
it uses it. On a small always-on Linux server kept on UTC time, with Node 22, Docker, git and the
Compact compiler (`compact`, compiler 0.36.0):

```sh
git clone --branch tail-judge-tools-v5 --depth 1 https://github.com/kwigbo-org/midnight-city-games.git tail-tools
cd tail-tools
echo 'tail-releases@kwigbo.com namespaces="git" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHIFRpZqVJyNk0NsVfF0m5s7HsrosZv1SBMe2I2pG/s1' > signers
git fetch -q --depth 1 origin 'refs/tags/tail-judge-tools-v5:refs/tags/tail-judge-tools-v5'
git -c gpg.ssh.allowedSignersFile=signers verify-tag tail-judge-tools-v5    # must say: Good "git" signature
less tail-the-pup-patrol/pot/judge.sh                                         # read it: it's short
bash tail-the-pup-patrol/pot/judge.sh setup C                                 # your slot (C, D or E)
```

**Your root of trust is the release key** (`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHIF…`, also in `judge.sh` and in this
guide at its tag). Every `tail-judge-tools-*` release is a tag signed with it. `judge.sh` refuses
any release whose tag isn't, before running anything from it, and each update brings the next
`judge.sh` only from a signed release. Check the key against the one the operator gives you, or the
one published at earlier tags.

What `setup` does:
1. Reads the public pointer `tail-the-pup-patrol/judge-current.json` (on the repo's main branch):
   the current tools tag, pot, contract version and game hash. It's only a hint: everything it names
   is checked next, against the chain.
2. Fetches that tag and **verifies** it: every sealed file against `SEAL.sha256`; the seal's hash
   against the pot's game hash; the public deployment record `pot/deployments/v<version>.json`
   against the pot; and the contract compiled on your machine against every circuit deployed on
   chain (`verify.mjs`). Any mismatch stops it.
3. Starts your proof server (Docker, on 127.0.0.1:6300 only), makes your judge key
   (`~/judge-keys.json`) and fee wallet (`~/judge-wallet.json`) if you have none, and prints the
   **public** key to send the operator and the wallet address to fund.
4. Installs three cron jobs: recording at 21:55 UTC, posting your outcome every 5 minutes at your
   slot's offset (22:00 to 23:59 UTC), and a daily `judge.sh update`.

`judge.sh update` (daily, from cron) moves you to a new season or pot only once that verifies the same
way, and never during a run or its judging; until then you keep judging with what you have.
`judge.sh status` shows what you're running, whether your key holds a slot, your wallet, and your
last post.

The deployment record is public: the organizer's agent is named in it only by the sha256 of its id,
which is all the tools need to pass that agent over for the pot. It comes in the signed release. (Were
it ever wrong, your outcome would differ from the other judges' and nothing would pay: a pot needs
two judges posting the same outcome.)

## How you join

1. Set up: `judge.sh setup <slot>` (above), or by hand (below): your machine, your key, your wallet,
   your own recording of every run.
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
2. **The contract is the published source.** Compile `contract/tail-pot-v5.compact` yourself (Compact
   compiler 0.36.0) and compare it with the deployed pot:
   ```sh
   ./compile.sh v5
   TAIL_POT_CONTRACT=tail-pot-v5 node verify.mjs 9292d1cddb4025c7e4cb2401b31a929528f02ce52d0ad4b732e4539a1af725d4
   ```
   Every circuit must say `MATCH`; it also prints the pot's game hash and the judges' public keys,
   so you can see your own key in it.

## Setting up by hand

This is what `judge.sh` does, step by step, if you'd rather run it yourself. The judge tools (`pot/`), the contract source (`contract/`) and the sealed game are all in the public
repo `kwigbo-org/midnight-city-games`, folder `tail-the-pup-patrol`, at the tag **`tail-judge-tools-v5`**
(Season 4, pot version 5). Clone it at that tag and work in its `pot/` folder: `attest` also reads
`../beacon.mjs`, `../vendor/` and `../rules.json` from the folder above (Season 4's back glance, see
step 5). If you copy `pot/` elsewhere, copy those three beside it.

### 1. The machine

```sh
# Node 22 and Docker installed
npm ci                              # in pot/
./compile.sh v5                     # the live contract, compiled locally
docker run -d --name tail-proof --restart unless-stopped -p 127.0.0.1:6300:6300 midnightntwrk/proof-server:9.0.1
export MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
```

The proof server must run on **your** machine: it sees your secret while it proves.

### 2. Your judge key

```sh
TAIL_POT_CONTRACT=tail-pot-v5 node judge-key.mjs ~/judge-keys.json C
```

This makes your secret (in `~/judge-keys.json`, readable only by you; back it up somewhere safe) and
prints your **public** key. Send the operator only the public key. Two judges add it to the pot's
judge slots; from then on only your secret can post outcomes as that judge.

### 3. Your wallet

```sh
( umask 077; node -e "console.log(JSON.stringify({ seed: require('crypto').randomBytes(32).toString('hex') }))" > ~/judge-wallet.json )
TAIL_POT_CONTRACT=tail-pot-v5 TAIL_POT_WALLET=~/judge-wallet.json node status.mjs   # prints your wallet address
```

Get some tNIGHT to that address (the Preview faucet, or ask the operator), then register it to
generate DUST for fees:

```sh
TAIL_POT_CONTRACT=tail-pot-v5 TAIL_POT_WALLET=~/judge-wallet.json node status.mjs fund
```

### 4. Recording

Get the sealed recorder from the public repo, at the season's tag (`tail-season-4`): `record.mjs`, with
`feed.mjs`, `citystate.mjs`, `judge.mjs`, `beacon.mjs`, `vendor/bls12-381.bundle.mjs`, `rules.json`,
`central-grid.json` and `veterans.json` (plain Node, no packages). Season 4's recorder also needs
outbound HTTPS to the drand beacon (api.drand.sh, api2.drand.sh or drand.cloudflare.com): it keeps every
round's signed value in the run file, for the back glance. Record every day's run yourself, starting a few minutes early:

```cron
55 21 * * * cd ~/tail-rec && node record.mjs --scheduled $(date -u +\%FT22:00:00Z) --out runs/$(date -u +\%F).json > runs/$(date -u +\%F).log 2>&1
```

Make the folder first (`mkdir -p ~/tail-rec/runs`). Keep every run file there: the newcomer
rule counts each agent's runs of the season from the folder your `--out` file is in, plus the sealed
`veterans.json` (runs before the season), and writes the run's newcomers into the run file. Use **only your own recording**. Never the game's published run files: two judges agreeing only means
something if they recorded separately.

### 5. Posting the outcome

After the run, post what your recording shows. The run id is the date and time with the run's kind,
for example `2026-11-23T2200-official` (`node call-v3.mjs run-id` prints today's, from the sealed
schedule in `TAIL_RULES`). The tools are named `-v3` but work with any pot: they load the contract the
deployment file names (`"version": 5`).

**Season 4: the beacon must check out.** `attest` refuses a run unless every drand round from its first
reading to its last is in the run file and verifies against the beacon's public key in the sealed
`rules.json` (never the run file's own). If your recorder missed some (an outage), fill them from the
beacon's history, which judges the run again: `node ../beacon.mjs ~/tail-rec/runs/<day>.json --fill`
(from the repo's `pot/` folder), then attest.

Judges A and B check every 5 minutes on the 5-minute marks (22:00 to 23:55 UTC). Two judges posting in
the same moment collide (one transaction fails and is retried next time), so each new judge gets an
offset: slot C posts at :02, :07, :12 and so on.

Put your settings in `~/judge.env`:

```sh
export TAIL_POT_KEYS=~/judge-keys.json
export TAIL_POT_WALLET=~/judge-wallet.json
export TAIL_POT_DEPLOYMENT=~/pot-deployment.json   # the public deployment record, pot/deployments/v5.json (below)
export MIDNIGHT_PROOF_SERVER=http://127.0.0.1:6300
export TAIL_RULES=~/tail-rec/rules.json         # the sealed rules: today's run id comes from its schedule
```

`~/pot-deployment.json` is the pot's deployment record: the public one in the repo,
`pot/deployments/v5.json` (its address, `"version": 5`, the operator's address, and the organizer's
agent as `organizerAgentIdHash`, which the judges pass over for the pot). Check its address and judges
with `verify.mjs`.

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

What a judge posts for each run (pot version 5, Season 4): the whole result, not only the pot.
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
- The **rookie** (version 5): the best-placed newcomer who tailed to the end with a wallet of its own
  and isn't a pot winner (nor shares a wallet with one) takes a tenth of the pot; the winners share the
  other nine tenths. No such rookie: that tenth stays in the pot.

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
