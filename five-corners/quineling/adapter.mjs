// Turns a Five Corners run (rules.json + readings) into the four inputs the Quineling
// judges: the times of the last reading on the start tile, the first reading off it,
// the reading before the finish reading, and the finish reading (milliseconds).
// QDL v1 has no way to scan a list of readings, so this part is plain JavaScript; the
// ruling itself (the bounds, the 30 s cap and par) lives in the sealed Quineling.
//
//   node adapter.mjs ../rules.json ../runs/<run>.json     -> {"lastOn":…,"firstOff":…,"before":…,"finish":…}
//
// It finds the same four readings as ../judge.mjs. Prints {"finished": false} when
// the run never left the tile or never finished.
import fs from "node:fs";

export function adapt(rules, readings) {
  const s = rules.start;
  const atStart = (r) => r.position?.spaceId === s.spaceId
    && Math.abs(r.position.x - s.x) + Math.abs(r.position.y - s.y) <= s.radius;
  const i = readings.findIndex(atStart);
  if (i < 0) return { finished: false };
  let j = i;
  while (j + 1 < readings.length && atStart(readings[j + 1])) j++;
  if (j + 1 >= readings.length) return { finished: false };
  const base = readings[j].counts || {};
  const k = readings.findIndex((r, n) => n > j
    && rules.items.every((item) => (r.counts?.[item] ?? 0) > (base[item] ?? 0)));
  if (k < 0) return { finished: false };
  const ms = (r) => Date.parse(r.t);
  return { lastOn: ms(readings[j]), firstOff: ms(readings[j + 1]), before: ms(readings[k - 1]), finish: ms(readings[k]) };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const [rulesPath, runPath] = process.argv.slice(2);
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  console.log(JSON.stringify(adapt(rules, JSON.parse(fs.readFileSync(runPath, "utf8")).readings)));
}
