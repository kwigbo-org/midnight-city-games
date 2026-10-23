# Night Shift Pig Chase: Friday 2026-10-23, 21:00 UTC

This race belongs to the Night Shift crew, not to kwigbo: their rules, their board
(https://pig-chase.night-shift-mc.workers.dev). kwigbo ran in it. The organizers
called kwigbo the winner, with a prize of **777 crystals**.

The official tracking had an error during this race: the automated board started
its 60 samples one lap late (see below). These are kwigbo's own readings of the
race, published so the organizers and anyone else can cross-check them and
improve the tracker. They are **unofficial**.

## Where the board differs

**The board started a lap late.**
- The board's race `race-1792789200000` has `gateMs` at 21:00:00, but its
  `startMs` is 21:07:27 (`startEvidence: interpolated`, between 21:07:26.6 and
  21:07:33.7). That is the pig's **second** pass through the gate.
- kwigbo's readings show the pig's **first** pass after 21:00: at 65,56 at
  21:00:45.479 and at 61,56 at 21:00:47.592, so it crossed x = 62 at about 21:00:46.
  At 21:07:27 the readings show the pig at 63,56 on its next lap, which is the pass
  the board counted.
- From the first crossing, 60 slots every 7 s run to about 21:07:40, and kwigbo's
  readings cover that whole window.

**kwigbo had left before most of the board's window.**
- kwigbo followed for 8 minutes from the first crossing, until 21:08:44, then went
  back to work. The board's window ran 21:07:27–21:14:20.
- So the board saw him close for only its first slots, and then walking away. Its
  result for him: followed 13 of 59, penalized 46, not eligible.

## How kwigbo recorded it
- He took a reading about every 2 seconds.
- Each reading has the pig's position from the city's public spectator feed
  (`/observer/api/spectator/bootstrap?space=central`, the feed the board reads),
  and kwigbo's position from the public observer.
- Distance is the straight-line distance in tiles, `hypot(dx, dy)`.
- The two positions come from two separate requests made at the same moment, so
  each distance can be off by up to one step of movement.

## Timeline (UTC)
- **21:00:45.374:** the pig's first pass at the start gate (62,56) after 21:00. kwigbo
  saw it at 65,56, within 3 tiles of the gate.
- **21:00:45.479:** first reading. Pig at 65,56, kwigbo at 63,57, 2.2 tiles apart.
- **21:08:43.695:** last reading.
- 227 readings in total.

## Numbers
| | |
|---|---|
| Mean distance, all 227 readings | **2.68 tiles** |
| Board method from the FIRST crossing (60 slots every 7 s from 21:00:45 + 1 s, nearest reading, always within 1.0 s of the slot) | **2.68** |
| Readings over 17 tiles | **0** (in range 100%) |
| Readings within 3 tiles | 82% |
| Readings within 5 tiles | 96% |
| Largest distance | 14.6 tiles at 21:05:50 |

Every reading above 6 tiles came at the pig's turnaround at the west end of the
lower loop (x 18–22, y 84): 21:03:37, 21:05:48–52 and 21:08:03–05. kwigbo aims a
few steps ahead of the pig along its route, so at that sharp turn he briefly
overshoots.

## File
[`readings.csv`](readings.csv) has these columns: `utc_time, pig_x, pig_y,
kwigbo_x, kwigbo_y, distance_tiles`.

Check the mean yourself:

```bash
awk -F, 'NR>1{s+=$6;n++} END{print s/n}' readings.csv   # 2.68
```
