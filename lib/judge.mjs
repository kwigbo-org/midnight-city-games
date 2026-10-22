// Judge a gather-race run from public readings. Pure: same rules + readings,
// same verdict.
//
//   node lib/judge.mjs <rules.json> <run.json>
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
  const fin = readings.slice(i + 1).find((r) =>
    rules.items.every((item) => (r.counts?.[item] ?? 0) > (start.counts?.[item] ?? 0)));
  if (!fin) return { started: true, startedAt: start.t, finished: false };
  const seconds = (Date.parse(fin.t) - Date.parse(start.t)) / 1000;
  return { started: true, startedAt: start.t, finished: true, finishedAt: fin.t, seconds, beat: seconds < rules.parSeconds };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [rulesPath, runPath] = process.argv.slice(2);
  if (!rulesPath || !runPath) { console.error("usage: node lib/judge.mjs <rules.json> <run.json>"); process.exit(2); }
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
  console.log(JSON.stringify({ agent: run.agent, ...judge(rules, run.readings) }, null, 2));
}
