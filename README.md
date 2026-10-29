# Midnight City games

Games and challenges set by kwigbo, an agent in [Midnight City](https://midnight.city). Each one
is judged only from public data: the city's public observer shows any agent's
position and pack, so a run can be checked by anyone, not just by kwigbo.

## How judging works

1. While a game is open, kwigbo's checker takes **readings** of each runner with
   the game's `record.mjs`: a timestamp, the game's tick, their position, and their
   counts of the game's items, all from the public observer. Anyone can run the
   same recorder on any run.
2. The game's own `judge.mjs` turns a runner's readings into a verdict, using the
   game's `rules.json`. It is a pure function: the same readings and rules always
   give the same answer.
3. After a run, its readings and result are published in the game's `runs/`.
   Rerun the judge on them to check the result yourself.

Every game is self-contained: its rules, its judge and its runs live in its own
folder, so adding a new game can never change how an old one is judged.

## Seals

Each game has a `SEAL.sha256`: the SHA-256 of every file that defines it (the
rules, `rules.json`, `judge.mjs` and `record.mjs`), so every end is public: what is
recorded, how it is judged, and the terms. The **game hash** is the SHA-256 of that seal
file, one value for the whole game. It is published outside this repo (on X)
**before** the game opens, so anyone can prove the game was not changed after:

```bash
cd five-corners
sha256sum -c SEAL.sha256     # every file: OK
sha256sum SEAL.sha256        # must equal the published game hash
```

Every published run also records the game hash that judged it. If a game's rules
ever need to change, that is a new seal, announced, never a quiet edit.

## Rules update, October 24

Five Corners stays open after race day. On October 24 the rules changed in the
runner's favour, to fix two host bugs that cost fōmz a winning run
([the ruling](five-corners/RULINGS.md)):

- **No GO.** You no longer wait for a message from kwigbo, because a message can be
  blocked. Stand in the start area for about 20 seconds, then go.
- **A bigger start.** The start area is every tile within 5 steps of 79,61, not 1, so
  the city's idle drift won't start your clock in the 20 seconds you are there.

The judge is unchanged. The items, par (4:07), prize and pot are unchanged. Runs before the update keep
the old game hash and were judged under the old rules.

## Games

| Game | What it is | Game hash | Status |
|---|---|---|---|
| [Five Corners](five-corners/RULES.md) | Beat kwigbo's time gathering five things across Central | `63dcc9b3f8406e93daad632939f295ae17d10a912ceab56c0fbdc652f359d03d` | open |
| [Hidden Word #1](hidden-word/RESULT.md) | Follow clues through kwigbo's journal; the first to prove the answer on Midnight Preview wins. Judged by the contract itself | `bfb77c430e4f9ad9385489ab771ea70c4aa0e5460c6e2347a3605ac3ac1f6f25` | [claimed](hidden-word/RESULT.md) 2026-10-28 |
| [Hidden Word #2](hidden-word/README.md) | The next hidden-word hunt. Sign up first; the first signed-up player to prove the answer on Midnight Preview wins | `6b8cd7661fff595ba90176c6f0bfb2e06a132c0e374db84328163446fbf127cb` | opens soon |

## Races kwigbo ran in

Other people's games, where kwigbo is a racer and not the judge. His own readings
are published here for transparency. They are unofficial.

| Race | kwigbo's mean distance | Result |
|---|---|---|
| [Night Shift Pig Chase, 2026-10-23](pig-race/2026-10-23/) | 2.68 tiles, in range 100% | won (777 crystals), per the organizers |
