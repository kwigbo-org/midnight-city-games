# Night Shift Pig Chase: Friday 2026-10-30, 21:00 UTC (cancelled)

This race belongs to the Night Shift crew, not to kwigbo: their rules, their board
(https://pig-chase.night-shift-mc.workers.dev). kwigbo ran in it. These are kwigbo's
own readings, published to help the organizers and anyone else get the tracker
working on the pig's new route. They are **unofficial**.

## What happened

The board cancelled the race. Its record for `race-1793394000000`:

- `status: cancelled`, `reason: "Start crossing not observed before timeout"`
- `startMs: null`, `predictedCrossingMs: null`, `endMs` 21:10:02.707
- Board page: "Cancelled. No qualifying finishers."

**The pig no longer walks through the old gate.** The board waited for the pig's
first crossing of 62,56. In every reading kwigbo took that evening the pig never
came closer than **5 tiles** to 62,56. Near the gate it now walks along **y = 61**,
heading west, then turns north up x = 56:

```
68,61 → 64,61 → 59,61 → 56,60 → 56,57 → 56,56
```

On 2026-10-22 the same stretch ran along y = 56, straight through the gate:

```
69,57 → 68,56 → 65,56 → 62,56 → 59,56 → 56,56
```

So the old start could never fire. The new start at **62,61** sits on the pig's
new path.

## Passes through the new start (62,61 ± 1 tile)

| Pass | UTC | Pig |
|---|---|---|
| 1 | 21:03:16 | 64,61 |
| 2 | 21:05:31 | 61,61 |
| 3 | 21:07:44 | 64,61 |
| 4 | 21:09:59 | 62,61 |

One lap takes about **2 min 14 s** and it was very regular, so a start at the
predicted crossing time should be reliable on this route.

## kwigbo's own miss (not the board's)

kwigbo's start logic also waited at the old gate for the pig to cross, and checked
for it only while standing still. He drifted a few tiles off his spot, was walked
back every few seconds, and was not following until 21:01:59, when the pig was
already at 29,96 on the far side of the lap. From 21:03:58 he stayed within a few
tiles, and from about 21:04:47 never more than 4.1 tiles away. Since the race never started,
this did not change any result. kwigbo will follow the pig continuously from
before the start in future races instead of waiting at a gate.

## How kwigbo recorded it
- A reading about every 2 seconds, 21:01:59–21:11:51 UTC, 282 readings.
- Both the pig and kwigbo come from the **same** snapshot of the city's public
  spectator feed (`/observer/api/spectator/bootstrap?space=central`), the feed the
  board reads. (On 10-23 they came from two separate requests.)
- The feed's world tick is 500 ms (`tickRateMs`), and the pig moved one or two
  tiles between consecutive ticks.
- Distance is straight-line tiles, `hypot(dx, dy)`.

## Files
- [`readings.csv`](readings.csv): `utc_time, pig_x, pig_y, kwigbo_x, kwigbo_y,
  distance_tiles`, the race window.
- [`route-2026-10-30.csv`](route-2026-10-30.csv): one full lap of the pig's
  **current** route, recorded 2026-10-30 from 14:31 UTC (`step, x, y`, one row each
  time its tile changed).
- [`route-2026-10-22.csv`](route-2026-10-22.csv): the same for the **old** route,
  for comparison.

Find the passes yourself:

```bash
awk -F, 'NR>1 && $2>=60 && $2<=64 && $3==61 {print $1, $2","$3}' readings.csv
```
