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
  const cap = (rules.maxTotalGapBenefitSeconds ?? Infinity) * 1000;
  const i = readings.findIndex(atStart);
  if (i < 0) return { started: false, finished: false };
  // The clock starts when the runner LEAVES the start tile, so waiting there (for
  // kwigbo's GO, or for a reading) costs nothing. They left after the last reading on
  // the tile and by the first reading off it.
  let j = i;
  while (j + 1 < readings.length && atStart(readings[j + 1])) j++;
  const lastOn = readings[j];
  const firstOff = readings[j + 1];
  if (!firstOff) return { started: false, onStartTile: true, finished: false };
  // Nothing can be gathered on the start tile, so the baseline is the last reading there.
  const base = lastOn.counts || {};
  const k = readings.findIndex((r, n) => n > j
    && rules.items.every((item) => (r.counts?.[item] ?? 0) > (base[item] ?? 0)));
  if (k < 0) return { started: true, startedAfter: lastOn.t, startedBy: firstOff.t, finished: false };
  // They finished after the reading before the finish reading and by the finish
  // reading. So the run lasted at most (finish reading - last reading on the tile) and
  // at least (reading before the finish - first reading off the tile). The runner gets
  // the shortest possible time, but the gaps can take off at most `cap` in total, so an
  // observer outage can't turn into a free win.
  const fin = readings[k];
  const before = readings[k - 1];
  const secondsAtMost = (Date.parse(fin.t) - Date.parse(lastOn.t)) / 1000;
  const secondsAtLeast = Math.max(0, (Date.parse(before.t) - Date.parse(firstOff.t)) / 1000);
  const seconds = Math.max(secondsAtLeast, secondsAtMost - cap / 1000);
  // Gathering adds one item at a time at sources far apart. Three or more counts
  // rising between two consecutive readings is how recovered items (grave or office)
  // would look, so such a run is flagged for a check by hand before any prize.
  const jumps = [];
  for (let n = j + 1; n <= k; n++) {
    const rose = rules.items.filter((item) => (readings[n].counts?.[item] ?? 0) > (readings[n - 1].counts?.[item] ?? 0));
    if (rose.length >= 3) jumps.push({ at: readings[n].t, items: rose });
  }
  return { started: true, startedAfter: lastOn.t, startedBy: firstOff.t, finished: true,
    finishedAfter: before.t, finishedBy: fin.t, seconds, secondsAtLeast, secondsAtMost,
    beat: seconds < rules.parSeconds, review: jumps.length > 0, ...(jumps.length ? { reviewReason: jumps } : {}) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [rulesPath, runPath] = process.argv.slice(2);
  if (!rulesPath || !runPath) { console.error("usage: node judge.mjs rules.json runs/<run>.json"); process.exit(2); }
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
  console.log(JSON.stringify({ agent: run.agent, ...judge(rules, run.readings) }, null, 2));
}
