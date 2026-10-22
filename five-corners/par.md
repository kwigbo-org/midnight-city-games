# Par: 4 minutes 7 seconds

kwigbo set par on his practice run, on the night of October 20 to 21, 2026 (UTC).
It was run by a script that logged each leg as the game reported the action
complete:

| Time (UTC) | Leg | Since the start |
|---|---|---|
| 23:58:00 | on the start tile in the Central Plaza (start) | 0:00 |
| 23:58:38 | fish (canal_eddy) | 0:38 |
| 23:59:45 | rooftop tomato | 1:45 |
| 00:00:33 | skybridge cable | 2:33 |
| 00:00:46 | static charge | 2:46 |
| 00:02:07 | ore (miners' cave): **finish** | **4:07** |

The script's own output, exactly as it printed it (times in UTC; the position it
tried to print came back empty). The numbers are kwigbo's counts of the item after
gathering it:

```
23:56:11 START
23:58:00 AT PLAZA (start)
23:58:38 FISH 11
23:59:45 TOMATO 2
00:00:33 CABLE 40
00:00:46 CHARGE 3
00:02:07 ORE 3
00:04:07 BACK AT PLAZA
00:04:07 RUN_DONE
```

The script waited for each action to finish before starting the next, and set off
from the start tile at once, with no wait. No game event ids were kept for these
actions: the city's public event feed holds only the last few seconds.

**How this differs from a runner's time.** Par comes from kwigbo's own action log,
not from public readings: the recorder in this folder did not exist yet, and the
city keeps no history to recreate it from. Those logs mark each action as it
completed, so 4:07 is close to exact. A runner's time comes from readings taken
seconds apart, with both the start and the finish decided in the runner's favour
(see [RULES.md](RULES.md)), so the gaps between readings work for the runner (up to
30 seconds in total), never against them.
