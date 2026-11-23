// Record a run from the public city feed, in the format judge.mjs reads. No account, no key:
// the same public feed anyone can read (see feed.mjs), so anyone can record a run exactly as
// the game's own recorder does, and compare.
//
//   node record.mjs --scheduled <ISO> [--minutes 25] [--out <file>.json] [--history <runs dir>]   one run
//     --history: this recorder's earlier run files, for the season's newcomers (rules.newcomer): the
//     agents near the dog at the start whose earlier runs (veterans.json plus the season's) are fewer
//     than newcomer.runs. Written into the run file as "newcomers".
//   node record.mjs --continuous <dir>                                     every tick, <dir>/<day>.jsonl
//
// A reading, one per city tick (500 ms):
//   { "t": "<the city's time for the tick>", "seq": n, "tick": n,
//     "pup": { "spaceId", "x", "y" } | null,
//     "agents": { "<agent id>": { "name", "spaceId", "x", "y" }, ... } }
// Only agents within `recordRadius` tiles of the dog are kept; anyone further is read as
// infinitely far, and recordRadius is well beyond lostDistance.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CityFeed } from './feed.mjs';
import { createHash } from 'node:crypto';
import { judge, newcomersFor } from './judge.mjs';

// Who is new for a run (rules.newcomer): the sealed veterans list (by sha256 of the agent id) plus the
// season's runs already judged in `history` (run files, from seasonFrom, scheduled before this one).
// check(reading) adds the agents seen in it, each worked out once, and returns the newcomers so far.
export function newcomerChecker(rules, here, history, scheduled) {
  if (!rules.newcomer) return null;
  const key = (id) => createHash('sha256').update(String(id)).digest('hex');
  const veterans = JSON.parse(fs.readFileSync(path.join(here, rules.newcomer.veterans), 'utf8'));
  const from = rules.newcomer.seasonFrom;
  const earlier = history && fs.existsSync(history) ? fs.readdirSync(history).filter((f) => /^\d{4}-\d\d-\d\d.*\.json$/.test(f) && f.slice(0, 10) >= from)
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(history, f), 'utf8')); } catch { return null; } })
    // Any judged run the agent played in counts: finished, void or unfinished (a cancelled run has no players).
    .filter((r) => r && r.scheduled < scheduled && ['finished', 'void', 'unfinished'].includes(r.result?.status)) : [];
  const checked = new Set(), found = new Set();
  return {
    from: { veterans: rules.newcomer.veterans, seasonRuns: earlier.length },
    check(reading) {
      const fresh = Object.keys(reading?.agents ?? {}).filter((id) => !checked.has(id));
      for (const id of fresh) checked.add(id);
      if (fresh.length) for (const id of newcomersFor(rules, veterans, earlier, fresh, key)) found.add(id);
      return [...found].sort();
    },
  };
}

export function readingOf(rules, r) {
  const pup = r.state.npcs.get(rules.subject.name) ?? null;
  const agents = Object.create(null); // keyed by a value from the feed: no prototype to trip over
  if (pup) {
    for (const [id, a] of r.state.agents) {
      const p = a.position;
      if (!p || p.spaceId !== pup.spaceId || typeof a.name !== 'string') continue;
      if (Math.hypot(p.x - pup.x, p.y - pup.y) > rules.recordRadius) continue;
      agents[id] = { name: a.name, spaceId: p.spaceId, x: p.x, y: p.y, ...(a.fish > 0 ? { fish: a.fish } : {}), ...(a.matcha > 0 ? { matcha: a.matcha } : {}) };
    }
  }
  return { t: r.t, seq: r.seq, tick: r.tick, pup: pup && { spaceId: pup.spaceId, x: pup.x, y: pup.y }, agents };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const rules = JSON.parse(fs.readFileSync(path.join(here, 'rules.json'), 'utf8'));
  const grid = rules.map?.grid ? JSON.parse(fs.readFileSync(path.join(here, rules.map.grid), 'utf8')) : null;
  const feed = new CityFeed({ space: rules.subject.spaceId, log: (s) => console.error(s) });
  const continuous = opt('--continuous', null);

  if (continuous) {
    fs.mkdirSync(continuous, { recursive: true });
    feed.on('reading', (r) => fs.appendFileSync(path.join(continuous, `${r.t.slice(0, 10)}.jsonl`), JSON.stringify(readingOf(rules, r)) + '\n'));
    feed.on('health', (h) => fs.writeFileSync(path.join(continuous, 'health.json'), JSON.stringify(h)));
    feed.start();
  } else {
    const scheduled = new Date(opt('--scheduled', new Date().toISOString())).toISOString();
    const startAt = Date.parse(scheduled) - (rules.window.recordFromMinutesBefore ?? 2) * 60000;
    const until = Date.parse(scheduled) + Number(opt('--minutes', 25)) * 60000;
    const out = opt('--out', `recording-${scheduled.replace(/[:.]/g, '')}.json`);
    const run = { game: rules.challenge, scheduled, recorder: 'record.mjs', grid, readings: [] };
    let newcomerCheck = null;
    // The season's newcomers, from the sealed veterans list and this recorder's earlier runs of the season.
    const nc = newcomerChecker(rules, here, opt('--history', path.dirname(path.resolve(out))), scheduled);
    if (nc) { run.newcomersFrom = nc.from; run.newcomers = []; newcomerCheck = (reading) => { run.newcomers = nc.check(reading); }; }
    let verdict = null, lastWrite = 0;
    const save = () => fs.writeFileSync(out, JSON.stringify({ ...run, health: feed.health, result: verdict }) + '\n');
    feed.on('reading', (r) => {
      if (Date.parse(r.t) < startAt) return;
      run.readings.push(readingOf(rules, r));
      // Each agent is checked once, the first time it appears (history is fixed when recording begins).
      if (newcomerCheck) newcomerCheck(run.readings.at(-1));
      if (Date.now() - lastWrite < 5000 && Date.parse(r.t) < until) return;
      lastWrite = Date.now();
      verdict = judge(rules, run, { grid });
      console.log(`${r.t} readings ${run.readings.length} · ${verdict.status}`);
      save();
      if (['finished', 'void', 'cancelled'].includes(verdict.status) || Date.parse(r.t) >= until) {
        feed.stop();
        const v = { ...verdict, players: (verdict.players ?? []).map(({ trace, ...p }) => p) };
        console.log(JSON.stringify(v, null, 2));
        process.exit(0);
      }
    });
    // If the feed goes quiet the readings stop, so the deadline can't depend on them.
    setTimeout(() => {
      feed.stop();
      verdict = judge(rules, run, { grid });
      save();
      console.log(`deadline reached: ${run.readings.length} readings, ${verdict.status}`);
      process.exit(0);
    }, Math.max(0, until - Date.now()) + 15000);
    const wait = Math.max(0, startAt - Date.now() - 30000);
    if (wait) console.log(`waiting until ${new Date(startAt - 30000).toISOString()} to connect`);
    setTimeout(() => feed.start(), wait);
  }
}
