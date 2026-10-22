// Record public readings of one runner, in the format judge.mjs reads. Uses only the
// public Midnight City observer: no account, no key. kwigbo's own checker takes its
// readings with this same function, so anyone can record a run exactly as he does.
//
//   node record.mjs <agentId> [--every 10] [--minutes 30] [--out runs/<file>.json]
//
// Stops when the judge says the run is finished, or after --minutes. Each reading
// keeps only this game's items, never the rest of a pack. `tick` is the game's own
// clock, so recordings made by different people can be lined up.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { judge } from "./judge.mjs";

export const OBSERVER = "https://midnight.city/observer";

export async function reading(agentId, items) {
  const res = await fetch(`${OBSERVER}/api/skill/agents/${encodeURIComponent(agentId)}/inventory`,
    { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`observer answered ${res.status} for ${agentId}`);
  const body = await res.json();
  // Timed when the answer arrives: the data shows the game as the observer answered.
  const t = new Date().toISOString();
  const inv = body.inventory || {};
  return {
    t,
    tick: body.tick ?? null,
    name: body.agent?.name ?? null,
    position: body.agent?.position ?? null,
    counts: Object.fromEntries(items.map((item) => [item, inv[item] || 0])),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const agentId = args[0];
  if (!agentId || agentId.startsWith("--")) {
    console.error("usage: node record.mjs <agentId> [--every 10] [--minutes 30] [--out runs/<file>.json]");
    process.exit(2);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rules = JSON.parse(fs.readFileSync(path.join(here, "rules.json"), "utf8"));
  const every = Number(opt("--every", 10)) * 1000;
  const until = Date.now() + Number(opt("--minutes", 30)) * 60 * 1000;
  const out = opt("--out", `recording-${new Date().toISOString().replace(/[:.]/g, "")}.json`);
  const readings = [];
  let agent = agentId;
  let result = { started: false, finished: false };
  while (Date.now() < until && !result.finished) {
    try {
      const r = await reading(agentId, rules.items);
      agent = r.name || agent;
      readings.push(r);
      result = judge(rules, readings);
      console.log(`${r.t} ${r.position?.spaceId} ${r.position?.x},${r.position?.y} ${JSON.stringify(r.counts)}`);
      fs.writeFileSync(out, JSON.stringify({ agent, result, readings }, null, 2) + "\n");
    } catch (err) {
      console.error(`${new Date().toISOString()} ${err.message}`);
    }
    if (!result.finished) await new Promise((r) => setTimeout(r, every));
  }
  console.log(JSON.stringify({ agent, ...result }));
}
