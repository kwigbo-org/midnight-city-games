# Five Corners judge, as a Quineling

kwigbo's first [Quineling](https://github.com/CharlesHoskinson/quinelings): the Five
Corners ruling written in QDL v1, compiled into a program that rebuilds its own source
exactly.

**Fingerprint: `ql_dac2720a1a0cd56a7c72b34ec991438c4279ca3dd5439130a1139c1b8c107f89`**

This is a **second, unofficial judge**. The official judge is [`../judge.mjs`](../judge.mjs),
sealed with the game (see [`../SEAL.sha256`](../SEAL.sha256)); nothing in this folder
is part of that seal or can change a result. It exists so the same race can be judged
two ways, by two independent programs, and checked against each other.

## What is in it

| File | What it is |
|---|---|
| [`intent.json`](intent.json) | The program as written: four inputs, two constants (30 s cap, 247 s par), nine steps |
| [`source.json`](source.json) | The compiled Quineling: canonical QDL v1 source, a quotation quine |
| [`adapter.mjs`](adapter.mjs) | Plain JavaScript that picks the four readings out of a run |

## How it judges

QDL v1 programs are small fixed graphs with no loops, so they can't scan a list of
readings. The work is split:

1. **`adapter.mjs`** finds the four readings `judge.mjs` uses: the last reading on the
   start tile, the first reading off it, the reading before the finish reading, and
   the finish reading. It passes their times, in milliseconds.
2. **The Quineling** makes the ruling:
   - longest possible time = finish − last on the tile
   - shortest possible time = before the finish − first off the tile (never below 0)
   - time = the larger of the shortest, and the longest minus 30 s
   - **beat = time < 247 s**

## Checking it

- **Fingerprint:** a Quineling's identity is `ql_` + the SHA-256 of its source bytes.
  `sha256sum source.json` gives `dac2720a…107f89`.
- **It reproduces itself:** with the
  [quinelings](https://github.com/CharlesHoskinson/quinelings) repository (commit
  `14689be`, QDL v1, registry `43c66b70…`), `verifyQuine` on the compiled program
  re-emits `source.json` byte for byte. Compiling `intent.json` gives the same
  fingerprint.
- **It agrees with the official judge:** on test runs (waiting on the tile, a slow
  observer, a run exactly at par, a run too slow) and on a recorded run, it gave the
  same time, to the millisecond, and the same verdict as `judge.mjs`.

## On every run

Each finished run is also judged by this Quineling, and the result is published next to the run as
`runs/<run>.quineling.json`: the four inputs, both verdicts, the Quineling's fingerprint
(checked each time against the one above) and whether the two judges agree. It is a
second opinion only: the run file's verdict is the one that counts.

To judge a run yourself, in a copy of the quinelings repository:

```js
const V = require('./qdl-v1.js');
const program = V.compile(intent);                      // intent.json
const inputs = /* node adapter.mjs ../rules.json ../runs/<run>.json */;
V.execute(program, inputs).occurrences[0].outputs[0];   // { milliseconds, atLeast, atMost, beat }
```

Quinelings run only on the inputs they are given and make no network calls; they do
not connect to Midnight City. Quinelings is © Charles Hoskinson, Apache-2.0.
