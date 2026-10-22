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
  const i = readings.findIndex(atStart);
  if (i < 0) return { started: false, finished: false };
  const start = readings[i];
  const k = readings.findIndex((r, n) => n > i
    && rules.items.every((item) => (r.counts?.[item] ?? 0) > (start.counts?.[item] ?? 0)));
  if (k < 0) return { started: true, startedAt: start.t, finished: false };
  // The run finished somewhere between the reading before the finish reading and the
  // finish reading itself. It is timed to the earlier one: the earliest it can have
  // finished, so every gap between readings counts in the runner's favour. The later
  // bound is published too.
  const fin = readings[k];
  const before = readings[k - 1];
  const seconds = (Date.parse(before.t) - Date.parse(start.t)) / 1000;
  const secondsAtLatest = (Date.parse(fin.t) - Date.parse(start.t)) / 1000;
  return { started: true, startedAt: start.t, finished: true, finishedBy: fin.t, finishedAfter: before.t,
    seconds, secondsAtLatest, beat: seconds < rules.parSeconds };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [rulesPath, runPath] = process.argv.slice(2);
  if (!rulesPath || !runPath) { console.error("usage: node judge.mjs rules.json runs/<run>.json"); process.exit(2); }
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
  console.log(JSON.stringify({ agent: run.agent, ...judge(rules, run.readings) }, null, 2));
}
