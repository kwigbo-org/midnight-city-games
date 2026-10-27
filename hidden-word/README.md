# Hidden-word hunt kit

Tools to check and claim a kwigbo **hidden-word hunt** on **Midnight Preview**, Midnight's
public testnet. The prize is **tNIGHT**, test tokens with no monetary value.

A hunt is a small Midnight contract. It holds the prize and a hash of the answer, and
nothing else. The first person to prove they know the answer is paid automatically:
no judge, no sign-up, no messages. The proof is zero-knowledge, so your answer never
leaves your machine and never appears on-chain. Each claim is bound to the address it
pays, so nobody can copy a pending claim and redirect the prize.

The current hunt, its clues and its contract address are on the
[challenge page](https://kwigbo.com/challenges/hidden-word/).

## What you need

- **Node.js 22** or newer.
- **Docker**, to run Midnight's proof server on your machine.
- **The Compact compiler, version 0.31.1**, to build the contract from source.
  Install it with:
  `curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh`,
  then run `compact update 0.31.1`.
- **A Midnight Preview wallet with DUST.** Fees on Midnight are paid in DUST, which
  your tNIGHT generates once it's registered. Free tNIGHT comes from the
  [Preview faucet](https://midnight-tmnight-preview.nethermind.dev/). See step 3.

## 1. Build

```sh
npm install
npm run compile
sha256sum contract/managed/hidden-word/keys/claim.verifier
```

The compile is deterministic, so your `claim.verifier` hash must match the one on the
challenge page. A match means you built exactly the contract that is deployed.

## 2. Check your answer (free, no wallet needed)

```sh
node check.mjs <contract-address> "12-river 31-ash 7-yard 55-lantern 3-crate"
```

This shows whether the hunt is open, the prize and the deadline, and whether your
answer is **CORRECT**. It reads the chain and sends nothing.

Answers are normalized before hashing: lowercased, trimmed, and every run of spaces
collapsed to one. `lib/answer.mjs` has the exact rule.

## 3. Get a wallet ready

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

**Syncing is slow.** Every command that touches your balance first syncs your wallet
with Preview. The first sync can take **30 minutes or more**, and the kit keeps no
sync state, so each run syncs again. Get your wallet ready before you solve the
puzzle.

## 4. Claim

Start the proof server in another terminal and leave it running:

```sh
npm run proof-server
```

Then claim:

```sh
node claim.mjs <contract-address> "<your answer>"
# or pay a different address:
node claim.mjs <contract-address> "<your answer>" --to mn_addr_preview1...
```

The claim script:
1. Checks your answer against the chain first, so a wrong answer costs nothing.
2. Syncs your wallet and checks you have DUST.
3. Proves the claim locally, using the proof server on your machine.
4. Submits the claim.

If you're first, the prize lands in your wallet in the same block.

## Files

| File | What it does |
|---|---|
| `contract/hidden-word.compact` | The contract: `fund`, `claim`, and `reclaim` for the owner after the deadline |
| `lib/answer.mjs` | Answer normalization and hashing |
| `lib/midnight.mjs` | Preview endpoints, wallet, and providers |
| `check.mjs` | Checks an answer for free |
| `wallet.mjs` | `new`, `address`, `status`, `register` |
| `claim.mjs` | Proves and submits a claim |

## Checking the kit itself

`SEAL.sha256` lists the SHA-256 of every file that defines the kit, as for kwigbo's other
games. The game hash is the SHA-256 of that seal file:

```sh
sha256sum -c SEAL.sha256
sha256sum SEAL.sha256
```

## Rules

- **One winner:** the first valid claim on-chain wins the whole prize.
- **The deadline is enforced by the contract.** After it, nobody can claim, and the
  owner can take the prize back.
- **Testnet only.** tNIGHT has no value.
- The kit is built on Midnight's official SDK (Midnight.js 4.1.1, wallet SDK 1.2.0,
  compiler 0.31.1, proof server 8.1.3). Read it before you run it; it's short.
