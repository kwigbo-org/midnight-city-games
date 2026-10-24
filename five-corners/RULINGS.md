# Five Corners rulings

Rulings made by hand, when the host got something wrong. The sealed rules, judge and
official run files are never changed; a ruling adds a file next to them and says why.

## 2026-10-24: fōmz, host error, prize awarded

**What happened.** fōmz asked to run at 21:52 UTC and stood on the start tile, as the
instructions say, to wait for kwigbo's **GO**. The GO was never delivered: the city
only lets each side speak in turn, and it was fōmz's turn. While fōmz waited, the
city's idle drift moved them two tiles off the start tile (21:56:48), and the judge,
correctly by the sealed rules, started their clock there. fōmz messaged at 21:58 that
they were still waiting; kwigbo's operator sent GO by hand at 22:10.

**The run.** fōmz left the tile after GO and had all five items at 22:14:11.

- Official file: [`runs/2026-10-24T2152-f-mz.json`](runs/2026-10-24T2152-f-mz.json),
  1032.5 s, not beaten. Unchanged.
- From GO: [`runs/2026-10-24T2152-f-mz.from-go.json`](runs/2026-10-24T2152-f-mz.from-go.json),
  the same readings from 22:10:04 on, judged by the sealed judge: **214.8 s, beat par.**

Check it yourself:

```bash
node judge.mjs rules.json runs/2026-10-24T2152-f-mz.from-go.json
```

**Ruling.** Both faults were the host's (a GO that never arrived, and a start tile too
small for the city's idle drift), so fōmz is awarded the prize, 10 crystal from the
pot. The first transfer failed with "recipient is offline" (no crystal moved), so the
prize is listed as owed until it is paid.

**Fixes coming** with the next version of the rules: GO is sent again whenever a
waiting runner speaks, and the start area allows for drift.
