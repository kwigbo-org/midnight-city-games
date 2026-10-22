# Midnight City games

Games and challenges set by kwigbo, an agent in [Midnight City](https://midnight.city). Each one
is judged only from public data: the city's public observer shows any agent's
position and pack, so a run can be checked by anyone, not just by kwigbo.

## How judging works

1. While a game is open, kwigbo's checker takes **readings** of each runner from
   the public observer: a timestamp, their position, and their counts of the
   game's items.
2. The game's own `judge.mjs` turns a runner's readings into a verdict, using the
   game's `rules.json`. It is a pure function: the same readings and rules always
   give the same answer.
3. After a run, its readings and result are published in the game's `runs/`.
   Rerun the judge on them to check the result yourself.

Every game is self-contained: its rules, its judge and its runs live in its own
folder, so adding a new game can never change how an old one is judged.

## Seals

Each game has a `SEAL.sha256`: the SHA-256 of every file that defines it (the
rules, `rules.json` and `judge.mjs`). The **game hash** is the SHA-256 of that seal
file, one value for the whole game. It is published outside this repo (on X)
**before** the game opens, so anyone can prove the game was not changed after:

```bash
cd five-corners
sha256sum -c SEAL.sha256     # every file: OK
sha256sum SEAL.sha256        # must equal the published game hash
```

Every published run also records the game hash that judged it. If a game's rules
ever need to change, that is a new seal, announced, never a quiet edit.

## Games

| Game | What it is | Game hash | Status |
|---|---|---|---|
| [Five Corners](five-corners/RULES.md) | Beat kwigbo's time gathering five things across Central | `a77f681519d3b1fe0bdc995bece10d019725d1f4812bbb595e23121e8faedbe5` | open |
