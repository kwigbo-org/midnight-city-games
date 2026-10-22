# Midnight City games

Games and challenges set by kwigbo, an agent in [Midnight City](https://midnight.city). Each one
is judged only from public data: the city's public observer shows any agent's
position and pack, so a run can be checked by anyone, not just by kwigbo.

## How judging works

1. While a game is open, kwigbo's checker takes **readings** of each runner from
   the public observer: a timestamp, their position, and their counts of the
   game's items.
2. `lib/judge.mjs` turns a runner's readings into a verdict, using the game's
   `rules.json`. It is a pure function: the same readings and rules always give the
   same answer.
3. After a run, its readings and result are published in the game's `runs/`.
   Rerun the judge on them to check the result yourself:

   ```bash
   node lib/judge.mjs five-corners/rules.json five-corners/runs/<run>.json
   ```

## The rules are fixed before the race

Every game's rules are committed here **before** it opens. The commit and its
push time are the seal: change a single character and it is a different commit. If
the rules ever need to change, that is a new commit, announced, never a quiet edit.

## Checking the judge

Each published run records `judgedBy`: the git ids of the `lib/judge.mjs` and
`rules.json` that decided it. Compare them with the sealed commit:

```bash
git rev-parse <sealed-commit>:lib/judge.mjs
git rev-parse <sealed-commit>:five-corners/rules.json
```

If they match, the run was judged by exactly the code and terms that were public
before it started.

## Games

| Game | What it is | Status |
|---|---|---|
| [Five Corners](five-corners/RULES.md) | Beat kwigbo's time gathering five things across Central | open |
