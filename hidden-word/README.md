# Hidden-word hunt kit

Tools to sign up for, check and claim a kwigbo **hidden-word hunt** on **Midnight
Preview**, Midnight's public testnet. The prize is **tNIGHT**, test tokens with no
monetary value.

A hunt is a small Midnight contract. It holds the prize, a hash of the answer and the
list of signed-up players. The first signed-up player to prove they know the answer is
paid automatically: no judge and no messages. The proof is zero-knowledge, so your
answer never leaves your machine and never appears on-chain. Each claim is bound to the
address it pays, so nobody can copy a pending claim and redirect the prize.

The current hunt, its clues and its contract address are on its challenge page, listed
at [kwigbo.com/challenges](https://kwigbo.com/challenges/). This kit is for hunts from #2
on. Hunt #1's kit is the `hidden-word-1` tag of this repo.

## What you need

- **Node.js 22** or newer.
- **Docker**, to run Midnight's proof server on your machine.
- **The Compact compiler, version 0.31.1**, to build the contract from source.
  Install it with:
  `curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh`,
  then run `compact update 0.31.1`.
- **A Midnight Preview wallet with DUST.** Fees on Midnight are paid in DUST, which
  your tNIGHT generates once it's registered. Free tNIGHT comes from the
  [Preview faucet](https://midnight-tmnight-preview.nethermind.dev/). See step 2.

## 1. Build

```sh
npm install
npm run compile
sha256sum contract/managed/hidden-word/keys/claim.verifier
```

The compile is deterministic, so your `claim.verifier` hash must match the one on the
challenge page. A match means you built exactly the contract that is deployed.

## 2. Get a wallet ready

The scripts read your wallet secret from the environment, never from the command line:

```sh
node wallet.mjs new                  # makes a fresh seed (or bring your own)
export MIDNIGHT_SEED=<64 hex characters>
#   or: export MIDNIGHT_MNEMONIC="your recovery words"
node wallet.mjs address              # your Preview address
```

1. Paste the address into the [Preview faucet](https://midnight-tmnight-preview.nethermind.dev/).
2. Run `node wallet.mjs register` to register the tNIGHT for DUST.
3. Run `node wallet.mjs status` until it shows DUST. That usually takes a few minutes.

Use a fresh testnet wallet for this, not one that holds anything of value.

**The first sync is slow.** The first command that touches your balance syncs your
wallet with Preview from the start, which can take **30 minutes or more**. The kit then
saves the synced state in `wallet-state/`, so later runs only catch up on new blocks.
`wallet-state/` holds your wallet's keys and coins: keep it private, like the seed.
Deleting it is always safe, and the next run syncs in full. Get your wallet ready before
you solve the puzzle.

## 3. Sign up

Only signed-up players can win, and a claim can only pay the wallet that signed up.
Signing up is free and takes a minute:

```sh
node signup.mjs "<your name>"
```

This signs your name, plus a commitment to a secret derived from your wallet's key, with
that key. It's offline: nothing is sent and the wallet doesn't sync. Open a **sign-up
issue** in this repo (Issues, then New issue, then "Hidden Word sign-up") and paste the
whole output. kwigbo checks the signature, adds your address and commitment to the hunt's
contract, and replies on the issue, usually within minutes. The name you sign is the name
a winner is listed under.

Sign up with the wallet you'll claim with, and before you start solving. Each address
signs up once. Check that you're on the list:

```sh
node check.mjs <contract-address> "anything" --player <your mn_addr_preview1...>
```

## 4. Check your answer (free, no wallet needed)

```sh
node check.mjs <contract-address> "12-river 31-ash 7-yard 55-lantern 3-crate"
```

This shows whether the hunt is open, the prize, the deadline and how many players have
signed up, and whether your answer is **CORRECT**. It reads the chain and sends nothing.

Answers are normalized before hashing: lowercased, trimmed, and every run of spaces
collapsed to one. `lib/answer.mjs` has the exact rule.

## 5. Claim

Start the proof server in another terminal and leave it running:

```sh
npm run proof-server
```

The proof server sees your answer while it proves, so run it on your own machine.
`MIDNIGHT_PROOF_SERVER` can point the kit at another one, and the claim warns if
that server isn't local.

Then claim:

```sh
node claim.mjs <contract-address> "<your answer>"
```

The prize goes to the wallet in `MIDNIGHT_SEED` or `MIDNIGHT_MNEMONIC`, which must be the
one that signed up.

The claim script:
1. Checks your answer against the chain first, so a wrong answer costs nothing.
2. Checks that your wallet is signed up, with its own player key.
3. Syncs your wallet and checks you have DUST.
4. Proves the claim locally, using the proof server on your machine. The proof shows you
   know the answer and your player secret without revealing either.
5. Submits the claim.

If you're first, the whole pot lands in your wallet in the same block. That's at
least the listed prize, more if anyone added to it.

## Proving an address is yours

`sign.mjs` signs any message, and `verify.mjs` lets anyone check it with no wallet:

```sh
node sign.mjs "<message>"
node verify.mjs <mn_addr_preview1...> "<the message>" <key> <signature>
```

`VERIFIED` means the key belongs to that address and the signature is valid for that
exact message. `sign.mjs` also prints the full `verify.mjs` command, quoted and safe to
paste.

## Files

| File | What it does |
|---|---|
| `contract/hidden-word.compact` | The contract: `register` (the owner signs players up), `fund` (until the deadline), `claim` (pays the signed-up player who proves the answer and their player secret the whole pot), and `reclaim` for the owner after the deadline |
| `lib/answer.mjs` | Answer normalization and hashing |
| `lib/midnight.mjs` | Preview endpoints, the wallet and its saved state, and providers |
| `check.mjs` | Checks an answer, and optionally a player's sign-up, for free |
| `wallet.mjs` | `new`, `address`, `status`, `register` |
| `claim.mjs` | Proves and submits a claim |
| `signup.mjs` | Signs you up for the current hunt |
| `sign.mjs` | Signs any message with your wallet's key, to prove an address is yours |
| `verify.mjs` | Checks a signature from `sign.mjs` |

## Checking the kit itself

`SEAL.sha256` lists the SHA-256 of every file that defines the kit, as for kwigbo's other
games. The game hash is the SHA-256 of that seal file:

```sh
sha256sum -c SEAL.sha256
sha256sum SEAL.sha256
```

## Rules

- **Sign up to win.** The contract pays only addresses kwigbo has signed up, after
  checking a signed sign-up, and only a claim from that address's own wallet. Knowing the
  answer isn't enough to pay someone else. Winners are named by the name they signed.
- **One winner:** the first valid claim on-chain wins the whole pot. Anyone can add to the
  pot while the hunt runs, but not after the deadline.
- **The deadline is enforced by the contract.** After it, nobody can claim or sign up, and
  the owner can take the prize back.
- **Testnet only.** tNIGHT has no value.
- The kit is built on Midnight's official SDK (Midnight.js 4.1.1, wallet SDK 1.2.0,
  compiler 0.31.1, proof server 8.1.3). Read it before you run it; it's short.
