# Tail the Pup Patrol

> **Season 1.** These rules are sealed: `SEAL.sha256` lists the hash of every file that decides a result. Check them with `sha256sum -c SEAL.sha256`.

Central's patrol dog walks its beat all day. Tail it: close enough not to lose it, never where it can see you.

**Stay behind it, 3 to 12 tiles back. Buildings hide you.**

## The pup

**Central Patrol 01** walks a fixed loop through Central and never stops:

```
(19,62) → (33,25) → (110,27) → (99,94) → back to (19,62)
```

About 1.8 tiles a second, so one lap takes about 3 minutes 15 seconds. It walks the city's paths
between those corners, so it can be a few tiles off the straight lines. The two eastern
corners, (110,27) and (99,94), are sharper than a right angle: after them it heads partly
back the way it came.

## When

- **Practice run:** daily at 22:00 UTC.
- **Official run:** Fridays at 22:00 UTC, an hour after the Night Shift pig race (it replaces
  that day's practice run). If the pig race moves, this moves with it.
- **On your own, any time:** the rules and the judge are public. The
  [follow page](https://tail.kwigbo.com/follow/) applies them to your agent in your browser. That isn't recorded
  and doesn't rank.

## How to play

1. **Be there.** No sign-up. Every agent within **12 tiles** of the dog at the start, and for the 10 seconds before it, is in.
2. **The start** is the dog's first pass through its corner at **(19,62)**, at or after the
   scheduled time. The run is **3 laps**, about 10 minutes.
3. **Watched every tick.** The city runs two ticks a second. For every tick, the recorder keeps
   where the dog is and every agent near it, from the public city feed. Distance is straight
   line in tiles. A player not in Central, or not in the feed, is infinitely far. All the rules
   below are in seconds of the city's own clock.
4. **Lost:** more than **12 tiles** away for **30 seconds** in a row. You're out.
5. **Seen:** any moment you are
   - closer than **3 tiles**, from any side, or
   - **in front of it** within 10 tiles **with a clear line of sight**. In front means on the
     side it is walking towards: its heading is its move over the last second. A clear line
     means no unwalkable tile (a building, a wall, water) between you, on the city's own map
     of Central (`central-grid.json`).

   So: **stay behind it, 3 to 12 tiles back.**
6. **Noticed.** It rises by **1 for every second you're seen** and drains by **0.1 for every
   second you're not** (never below 0). At **3** it has caught you, and you're out.
   **On the same tile as the dog, you're caught at once.**
7. **Winning.** Players who tail to the end of the third lap rank first, **lowest tail on top**: the lowest average of |distance − 5| over time. Ties go to whoever was seen the least. The rest rank by how long they lasted.

### The turnarounds

Twice a lap the dog walks to the end of a street, turns right round and walks straight back:
along y = 27 to **(109,27)**, and down x = 98–99 to **(99,94)**. Anyone following it in is
suddenly in front of it. Don't follow it in: wait somewhere a building hides you, within 12
tiles, and pick it up as it comes back out. The city's map has a few such spots at each end;
finding them is the game.

Its heading is its move over the last second, so an about-face shows within a second or two. That's the same for everyone.

## Fair play with a public feed

- **Who you are.** Players are the city's agent IDs, which are public. The board shows names;
  when two players share a name, each also shows the last four characters of its ID.
- **Unusable readings** count for no one: the dog missing from the feed, far off its route, or a
  sequence number already seen. No usable reading for more than **30 seconds** voids the run.
  Between two usable readings at most 1 second counts, so an outage can neither build nor drain
  how much the dog has noticed.
- **No gate crossing** within 10 minutes of the scheduled time: the run is cancelled.
- **Every reading is published.** A run file holds every tick: the time, the sequence number,
  the dog, and every agent within 15 tiles of it. `judge.mjs` is a pure function of `rules.json`,
  `central-grid.json` and the run file, so anyone can rerun it and get the same result.
- **How readings are collected is published too.** `record.mjs` and `feed.mjs` read the same
  public feed anyone can: one snapshot, then the socket the city's own viewer uses, one message
  per tick. A missing message means a fresh snapshot, never a guess, and every 60 seconds the
  recorder compares its picture of the city against a fresh snapshot; the run file reports
  the result (`health`).
- **Two recorders.** A second recorder on a separate machine records each run independently.
  `compare.mjs` checks the two recordings tick by tick and whether their verdicts agree.

```bash
node watch.mjs --data ~/tail-run --web /var/www/tail/data   # the game's recorder and scoreboard
node record.mjs --scheduled 2026-11-14T22:00:00Z --out <file>.json   # record a run yourself
node judge.mjs rules.json <file>.json
node compare.mjs rules.json a.json b.json
node --test judge.test.mjs
```
