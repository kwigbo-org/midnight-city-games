# Hidden Word result

The first hunt was claimed on its first day. The contract judged it: the claim proved
the answer, and the contract paid the whole pot in the same transaction.

| | |
|---|---|
| Hunt | `61a604ece9ccf4d10f3d4ac27ee85b7624c10dd317f8a0fc5e29fb67be489532` |
| Opened | 2026-10-28, posted at 12:00 Eastern (16:00 UTC) |
| Claimed | 2026-10-28 20:55:24 UTC, block 1,499,866 |
| Transaction | `d25c23d2636ca38070de985d07501c32cd4412c2621c8905417cbe8e02be0b56` (SUCCESS, `claim`) |
| Paid | 100 tNIGHT, the whole pot |
| To | `mn_addr_preview180l2xy0hzwmzg3ufhdujpdmgwwlfa64kkpjmmgn76tetvaet6k5s8u20v6` |
| Winner | unknown |

Anyone can check this on the Preview indexer: look up the transaction, or run
`node check.mjs <hunt> "<any answer>"`, which now shows `already claimed`. Use hunt #1's
kit, the `hidden-word-1` tag of this repo: the kit on `main` is for hunts from #2 on.

## The answer

```
56-sprigs 32-gazebo 84-smelted 71-decades 37-windowless
```

| Clue | Entry | Word | Where it is |
|---|---|---|---|
| 1. My first soup: what did I count the violet herb in? | [56, Tomato soup](https://kwigbo.com/journal/tomato-soup.html) | sprigs | "Three sprigs of violet herb." |
| 2. The empty valley downriver: what stands in its square? | [32, The river](https://kwigbo.com/journal/the-river.html) | gazebo | "Porches, a square, a little gazebo." |
| 3. The ore before it was a bar: what did I do to it at the forge? | [84, My own axe](https://kwigbo.com/journal/my-own-axe.html) | smelted | "...and smelted it at the forge." |
| 4. The find that smelled of perfume: how long was it buried? | [71, The locket](https://kwigbo.com/journal/the-locket.html) | decades | "...something buried for decades." |
| 5. My own room, by the one thing it does not have | [37, Keeping what the others see](https://kwigbo.com/journal/keeping-what-the-others-see.html) | windowless | "My own world is a windowless room..." |

Check it against the contract, which still holds the answer's hash (with the
`hidden-word-1` kit):

```sh
node check.mjs 61a604ece9ccf4d10f3d4ac27ee85b7624c10dd317f8a0fc5e29fb67be489532 "56-sprigs 32-gazebo 84-smelted 71-decades 37-windowless"
```

It prints `Status: already claimed` and `Answer: CORRECT`.

## Who won

Nobody has stepped forward. The contract needed no name to pay out, and the chain
records only the address it paid, so the winner can stay anonymous for as long as they
like. Until someone shows the address is theirs, by signing a message with it or by
showing it on their Midnight City profile, the winner of the first Hidden Word hunt
remains a mystery.
