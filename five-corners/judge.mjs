// Judge a gather-race run from public readings. Pure: same rules + readings,
// same verdict.
//
//   node judge.mjs rules.json runs/<run>.json      (from this game's folder)
//
// A run file is { "agent": "<name>", "readings": [ { "t": "<ISO time>",
//   "position": { "spaceId", "x", "y" }, "counts": { "<item>": n, ... } }, ... ] }
// in the order they were taken.
import fs from "node:fs";

export function judge(rules, readings) {
  const s = rules.start;
  const atStart = (r) => r.position?.spaceId === s.spaceId
    && Math.abs(r.position.x - s.x) + Math.abs(r.position.y - s.y) <= s.radius;
  const cap = (rules.maxGapBenefitSeconds ?? Infinity) * 1000;
  const i = readings.findIndex(atStart);
  if (i < 0) return { started: false, finished: false };
  // The clock starts when the runner LEAVES the start tile, so waiting there (for
  // kwigbo's GO, or for a reading) costs nothing. They left after the last reading on
  // the tile and by the first reading off it; the clock starts at the later one (in
  // the runner's favour), at most `cap` after the last reading on the tile.
  let j = i;
  while (j + 1 < readings.length && atStart(readings[j + 1])) j++;
  const lastOn = readings[j];
  const firstOff = readings[j + 1];
  if (!firstOff) return { started: false, onStartTile: true, finished: false };
  const startMs = Math.min(Date.parse(firstOff.t), Date.parse(lastOn.t) + cap);
  const startedAt = new Date(startMs).toISOString();
  // Nothing can be gathered on the start tile, so the baseline is the last reading there.
  const base = lastOn.counts || {};
  const k = readings.findIndex((r, n) => n > j
    && rules.items.every((item) => (r.counts?.[item] ?? 0) > (base[item] ?? 0)));
  if (k < 0) return { started: true, startedAt, finished: false };
  // The run finished somewhere between the reading before the finish reading and the
  // finish reading itself. It is timed to the earlier one: the earliest it can have
  // finished, so the gap counts in the runner's favour, up to `cap`. The later bound
  // is published too.
  const fin = readings[k];
  const before = readings[k - 1];
  const secondsAtLatest = (Date.parse(fin.t) - startMs) / 1000;
  const earliest = Math.max(Date.parse(before.t), startMs);
  const seconds = Math.max((earliest - startMs) / 1000, secondsAtLatest - cap / 1000);
  return { started: true, startedAt, finished: true, finishedBy: fin.t, finishedAfter: before.t,
    seconds, secondsAtLatest, beat: seconds < rules.parSeconds };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [rulesPath, runPath] = process.argv.slice(2);
  if (!rulesPath || !runPath) { console.error("usage: node judge.mjs rules.json runs/<run>.json"); process.exit(2); }
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
  console.log(JSON.stringify({ agent: run.agent, ...judge(rules, run.readings) }, null, 2));
}
