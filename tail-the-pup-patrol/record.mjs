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
import { judge, newcomersFor, roundAt } from './judge.mjs';
import { verifyRound, timeSpan } from './beacon.mjs';

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

// Season 4: the drand rounds (rules.glance.beacon) the back glance uses. start() polls the latest round
// (for the live verdict and the cue); fill(from, to) fetches any round missed in between, from the
// beacon's history, so the final verdict never depends on a dropped request. rounds: round -> randomness,
// signatures: round -> signature; a round is kept only if it verifies (beacon.mjs). Rounds more than
// `keepMs` old are dropped (watch.mjs runs all season).
export function beaconFeed(rules, { keepMs = 6 * 3600_000 } = {}) {
  const B = rules.glance?.beacon;
  if (!B) return null;
  const rounds = Object.create(null), signatures = Object.create(null);
  const keep = (j) => { if (verifyRound(B, j.round, j.randomness, j.signature)) { rounds[j.round] = j.randomness; signatures[j.round] = j.signature; return true; } return false; };
  const get = async (which) => {
    for (const u of B.urls) {
      try {
        const r = await fetch(`${u}/${B.chain}/public/${which}`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const j = await r.json();
        if ((which === 'latest' || j.round === which) && keep(j)) return j; // a round that doesn't verify: the next endpoint
      } catch { /* the next endpoint */ }
    }
    return null;
  };
  let timer = null;
  return {
    rounds,
    start() {
      const tick = async () => {
        await get('latest');
        const old = roundAt(B, Date.now() - keepMs);
        for (const r of Object.keys(rounds)) if (Number(r) < old) { delete rounds[r]; delete signatures[r]; }
      };
      tick(); timer = setInterval(tick, 1500);
    },
    stop() { clearInterval(timer); },
    async fill(fromMs, toMs) {
      const a = roundAt(B, fromMs), b = roundAt(B, toMs), miss = [];
      for (let r = a; r <= b; r++) if (!rounds[r]) miss.push(r);
      for (let i = 0; i < miss.length; i += 10) await Promise.all(miss.slice(i, i + 10).map((r) => get(r)));
      let still = 0; for (let r = a; r <= b; r++) if (!rounds[r]) still++;
      return still;
    },
    // For a run file: { beacon: round -> randomness, beaconSignatures: round -> signature }.
    slice(fromMs, toMs) {
      const beacon = {}, beaconSignatures = {};
      for (let r = roundAt(B, fromMs); r <= roundAt(B, toMs); r++) if (rounds[r]) { beacon[r] = rounds[r]; beaconSignatures[r] = signatures[r]; }
      return { beacon, beaconSignatures };
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
    let verdict = null, lastWrite = 0, finishing = false;
    const beacon = beaconFeed(rules);
    const withBeacon = () => (beacon && run.readings.length ? { ...run, ...beacon.slice(...timeSpan(run.readings)) } : run);
    const save = () => fs.writeFileSync(out, JSON.stringify({ ...withBeacon(), health: feed.health, result: verdict }) + '\n');
    // The end: every beacon round of the run filled in from the beacon's history, then judged once more.
    const final = async (why) => {
      try { await finalise(why); } catch (e) { console.error(`finishing failed: ${e.message}`); process.exit(1); }
    };
    const finalise = async (why) => {
      feed.stop(); beacon?.stop();
      if (beacon && run.readings.length) {
        const missing = await beacon.fill(...timeSpan(run.readings));
        if (missing) console.log(`warning: ${missing} beacon rounds still missing`);
      }
      verdict = judge(rules, withBeacon(), { grid });
      save();
      console.log(why);
      process.exit(0);
    };
    feed.on('reading', (r) => {
      if (Date.parse(r.t) < startAt) return;
      run.readings.push(readingOf(rules, r));
      // Each agent is checked once, the first time it appears (history is fixed when recording begins).
      if (newcomerCheck) newcomerCheck(run.readings.at(-1));
      if (Date.now() - lastWrite < 5000 && Date.parse(r.t) < until) return;
      lastWrite = Date.now();
      verdict = judge(rules, withBeacon(), { grid });
      console.log(`${r.t} readings ${run.readings.length} · ${verdict.status}`);
      save();
      if (['finished', 'void', 'cancelled'].includes(verdict.status) || Date.parse(r.t) >= until) {
        if (finishing) return;
        finishing = true;
        final(JSON.stringify({ ...verdict, players: (verdict.players ?? []).map(({ trace, ...p }) => p) }, null, 2));
      }
    });
    // If the feed goes quiet the readings stop, so the deadline can't depend on them.
    setTimeout(() => { if (finishing) return; finishing = true; final(`deadline reached: ${run.readings.length} readings`); }, Math.max(0, until - Date.now()) + 15000);
    const wait = Math.max(0, startAt - Date.now() - 30000);
    if (wait) console.log(`waiting until ${new Date(startAt - 30000).toISOString()} to connect`);
    setTimeout(() => { feed.start(); beacon?.start(); }, wait);
  }
}
