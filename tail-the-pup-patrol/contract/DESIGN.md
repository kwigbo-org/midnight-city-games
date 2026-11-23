# Tail the Pup Patrol: the pot

A Compact contract on Midnight Preview that holds a pot of tNIGHT for the runs and pays the winner
when two judges, on two machines, agree. `tail-pot.compact`, compiler 0.36.0, language 0.28 (Preview
moved to ledger v9 on 2026-11-10), five circuits with proving keys. The judges' tools are in
[`../pot`](../pot) (see its README). Live on Preview since 2026-11-11 for the daily practice and the
Friday official run, and for ad hoc practices.

This lives in the private repo until it has run for a while; then it goes to the public repo, next to
the sealed game, for anyone to audit.

The next version (opt-in entry fees, no owner key, no veto) is proposed in [`V2.md`](V2.md).

## Why two judges

The chain can't see Midnight City, so the contract can't judge a run. Instead, two judges each
record the run on their own machine with the sealed recorder and judge, and each posts what it
found. The contract pays only when both found the same thing. One judge alone can't move the pot.

| Judge | Machine | Recording | Attests |
|---|---|---|---|
| A | The games server | `tail-watch` (the site's own run file) | 22:40 UTC |
| B | The lab | Its own recorder (`record.mjs`, from 21:55 UTC) | 22:50 UTC |

The settle runs on the games server at 23:40 UTC. The judges are staggered: two calls on one
contract at the same moment collide, and the second is rejected (seen on 2026-11-11).

Both judges are the operator's, so this proves the mechanism, not independence. A community
judge would make it two of three; the contract would need a third key and a quorum.

## What a judge attests

For each run, the hash of this outcome:

| Field | What it is |
|---|---|
| `race` | Hash of the run id, e.g. `2026-11-13T2200-official` |
| `result` | sha256 of the ranked result as JSON: `[[agent id, status], ...]`, best first |
| `hasWinner` | True only when the run finished, the first agent tailed to the end, and they have their own wallet |
| `winner` | The winner's unshielded Preview address, as its 32 raw bytes |
| `end` | The scheduled start plus 1800 seconds, unix |

Two recordings differ by a tick or two, so the judges attest the *result* (ranking and statuses),
not the readings or the tails, and a fixed end time, not the measured one. Each judge still
publishes its own run file, and anyone can run the sealed judge on it.

## Who gets paid

Only a wallet the winner published themselves. The city lists every agent's wallets at
`https://midnight.city/observer/api/wallets`:

- `external_display`: an address the agent published with the city's `publish-wallet` command.
  **The only kind the pot pays.**
- `managed_custody`: a wallet the city holds. Hosted agents have one; so may a self-hosted agent
  that started hosted, without being able to use it (seen on 2026-11-11). **Never paid.**

The judges read it when they attest. A winner without their own wallet then is not paid: the
outcome has no winner, the settle pays nothing, and the pot rolls over to the next run. The winner
is still named on the Runs tab. The site's Get Paid check and Rules tab say the same.

## The flow

1. **Fund:** anyone adds tNIGHT with `fund` (the site's `/fund/` page does it from a wallet).
2. **Attest:** after the run, each judge calls `attest(secret, outcome)`. Once per run each.
   Only while the pot holds tNIGHT: an empty pot means no prize, nothing to judge.
3. **Window:** nothing settles until `end + window`. The live pots use an hour.
4. **Settle:** anyone calls `settle(outcome, address)`. The contract checks both judges attested this
   exact outcome and the window has passed, then pays the whole pot to the winner. No winner:
   settled, nothing paid, the pot rolls over. The games server records what was paid, from the
   settle transaction on the indexer, in the site's `data/payouts.json` (Runs tab, Last Run).
5. **Veto:** only inside the window, the owner can stop a disputed run. It never pays; the pot rolls
   over. The run's end comes from the first judge's attestation, so the owner can't stretch the window.
6. **Close:** the owner ends a pot and takes back what's left, but not while a run both judges agree
   on is still waiting to be settled. Settling still works after close.

## What an audit should know

- **The owner key can close a pot** and take what's in it, except while an agreed run awaits its
  settle, and can veto inside the window. Both are the operator's. A later version could time-lock
  close, or forbid it while the pot holds a won run.
- **Both judges are the operator's** (above).
- **The winner's address comes from the city's public list**, as it stands when the judges attest.
- The owner key sits on the lab with judge B. It should sit on neither judge's machine.

## Checks in the contract

- The two judge keys and the owner key must all differ and can't be empty.
- The window is between 1 second and 30 days, and an attested end must be before 2100, so the
  window sums can't overflow.
- `payouts` and `rollovers` count how each settled run ended.

## Pots on Preview

| Contract | What |
|---|---|
| `03aeca70f43b7f99a80a668ac0680ddc51c7a121da41fe9b3c3d7eebca620aa8` | The live pot (from 2026-11-12) |
| `5e6f8130ee34ec7b27923f85fbd618d5b1c1f2ed0b66c910253ffe797f2acb86` | First live pot (2026-11-11). Closed; its 10 tNIGHT went into the live pot |
| `8207fcfb0ced3606e79d03d4d7b0a19d827d32f99ce8a171b71d1f1dcf4e4f73` | Test pot: judges on separate machines, the funding page's tests |
| `7f92ae14ae076f869a73726b30316c4df1e809da234bd6cbb7175350a354cfed` | Rehearsal and edge cases. Closed |

## Decided

1. The judges attest the ranked result, not the readings (2026-11-10).
2. `end` is the scheduled start plus 30 minutes (2026-11-10).
3. The judge never ties (its ranking ends with the agent id), so one winner is always named.
4. Only a wallet the winner published is paid; without one, the pot rolls over (2026-11-12).
5. Ad hoc practices carry the pot like the scheduled runs (2026-11-11).

## Tests on Preview

### Rehearsal (2026-11-10)

End to end on Midnight Preview, after its move to ledger v9, with a 60-second window, both judge keys
on the lab, and the lab's test wallet paying fees. Race: the `2026-11-09T2200-practice` run.

| Step | Result |
|---|---|
| Deploy | Contract `7f92ae14ae076f869a73726b30316c4df1e809da234bd6cbb7175350a354cfed` |
| Fund | 100 tNIGHT, block 55807 |
| Attest A | From the games server's published run file, block 55832 |
| Attest B | From the lab's own recording, block 55857. Same outcome, so the race was agreed |
| Settle | Block 55883, tx `5558a685…0f563`. One output: 100 tNIGHT to kwigbo's published Preview address |

Both recordings ranked the race the same (kwigbo tailed to the end, one lost, one caught), so the two
outcome hashes matched.

### Edge cases on the same contract

Synthetic races paid the test wallet. 30 of 30 cases behaved as designed:

| Case | Result |
|---|---|
| No winner | Settles with no payment, the rollover is counted, the pot stays |
| Veto | Inside the window, the owner stops an agreed race. It can't be settled or re-attested after |
| Close while a race is agreed | Rejected until that race is settled or vetoed |
| Judges disagree | A different end from the second judge is rejected. A different result never settles |
| Window | Settling too early is rejected, and so is a veto after the window. Then the settle pays 10 tNIGHT |
| Wrong address | Settling to anyone but the attested winner is rejected |
| Close | Returns the rest (5 tNIGHT) to the owner's address. Funding and attesting after close are rejected |
| Guards | A non-judge key, a non-owner key, attesting twice and settling twice are all rejected |

The rehearsal contract is closed.

### Judges on separate machines

Judge A then moved to the games server, with its own secret and wallet there and its own proof
server. The proof server runs only while judge A attests, capped at 900 MB, and is stopped after.
It used under 300 MB, beside the live recorder on the 2 GB server. A second contract
(`8207fcfb0ced3606e79d03d4d7b0a19d827d32f99ce8a171b71d1f1dcf4e4f73`) has judge A's key from the games
server and judge B's from the lab:

| Race | Judge A (games server) | Judge B (lab) | Settled |
|---|---|---|---|
| `2026-11-10T2200-practice` | Agreed | Agreed | No winner: rollover, nothing paid |
| `2026-11-09T2200-practice` | Agreed | Agreed | From the games server: 100 tNIGHT to kwigbo's published address |

A judge's wallet needs a few minutes of DUST after it registers before it can attest twice in a row.
