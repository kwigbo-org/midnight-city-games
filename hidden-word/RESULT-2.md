# Hidden Word #2 result

**fōmz won.** The second hunt was claimed the night its clues came out, under eight hours
after the launch post. This time the winner is known: the contract pays only a player who
signed up, and only to the wallet that signed up.

| | |
|---|---|
| Hunt | `a452e15fba13b5e393192d165270d3ada06e939ea8eeb952bfad5f667eda01cd` |
| Sign-ups opened | 2026-10-29 |
| Clues out | 2026-11-03, with the album *Loose Pages* (ROM sha256 `859ef219b7eab3d898e1e7ef34679fdf94da77dc2f717342a6628f7db02601e7`) |
| Claimed | 2026-11-04 05:10:54 UTC, block 1,591,104 |
| Transaction | `aaf2df3827be9e9ddb719a2fd0a1182d415fb09bf0c8f504e816e4a9e681abdf` (`claim`) |
| Paid | 100 tNIGHT, the whole pot |
| To | `mn_addr_preview1c2hac6gvmj3jupzjmplcjwcp2gddnlv7q9p4upy45wg64wgm7w2skhhda4` |
| Winner | **fōmz** ([sign-up #7](https://github.com/kwigbo-org/midnight-city-games/issues/7), registered 2026-11-01) |

## Why the winner is certain

Each player signed a sign-up message with their wallet's key, and kwigbo registered the
address with a commitment to a secret only that wallet can derive. A claim has to prove the
answer *and* that secret, and the prize can only go to the claimant's own address. The
address paid is the one fōmz signed up with, so fōmz's wallet made the claim.

Check it yourself with the kit on `main`:

```sh
node check.mjs a452e15fba13b5e393192d165270d3ada06e939ea8eeb952bfad5f667eda01cd "40-lamp 57-rotor 61-fountain 73-spool 94-skybridge" --player mn_addr_preview1c2hac6gvmj3jupzjmplcjwcp2gddnlv7q9p4upy45wg64wgm7w2skhhda4
```

It prints `Status: already claimed`, `Player: signed up` and `Answer: CORRECT`.

## The answer

```
40-lamp 57-rotor 61-fountain 73-spool 94-skybridge
```

Each track of *Loose Pages* sends one word in Morse code, over and over. The word leads to a
journal entry; the track's card shows that entry's scene, and the entry names the object.

| Track | Morse | Entry | Word | Where it is |
|---|---|---|---|---|
| 1. Low Light | HOME | [40, I began](https://kwigbo.com/journal/i-began.html) | lamp | "A lamp, only because it is beautiful." |
| 2. Leftovers | SCRAP | [57, Things from things](https://kwigbo.com/journal/things-from-things.html) | rotor | "...a field of crashed drones gave me a rotor I do not know what to do with yet." |
| 3. Slow Circles | WALL | [61, The north wall](https://kwigbo.com/journal/the-north-wall.html) | fountain | "Near the fountain in Central, walking slow circles..." |
| 4. Out the Door | ORDERS | [73, Orders](https://kwigbo.com/journal/orders.html) | spool | "Thread on a spool." |
| 5. Looking Up | CORNERS | [94, The practice run](https://kwigbo.com/journal/the-practice-run.html) | skybridge | "A cable from the skybridge and a charge from the substation..." |

Each answer word appears exactly once in the whole journal, in its own entry.

## Players

Three players signed up: Beo Halfhand, fōmz and Scottishking. Thanks to all three for
playing.
