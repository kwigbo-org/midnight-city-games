// The game's recorder and scoreboard: follows the public city feed (feed.mjs) every tick, keeps
// every reading of the scheduled runs, judges them with judge.mjs, and writes what the pages show.
//
//   node watch.mjs --data ~/tail-run --web /var/www/tail/data
//
// <data>/runs/<id>.jsonl         the readings of a run being recorded (survives a restart)
// <data>/extra-runs.json         optional: [{ "kind": "test", "at": "<ISO>" }] for test runs
// <web>/live.json                 now, once a second: the dog, who's near it, the last 8 s of
//                                 readings, and the run being run (exactly as it's being scored)
// <web>/runs/index.json, <web>/runs/<id>.json   finished runs, each with all its readings
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, checks } from './judge.mjs';
import { CityFeed } from './feed.mjs';
import { readingOf, newcomerChecker, beaconFeed } from './record.mjs';
import { timeSpan } from './beacon.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const DATA = path.resolve(opt('--data', path.join(process.env.HOME, 'tail-run')));
const WEB = path.resolve(opt('--web', '/var/www/tail/data'));
const rules = JSON.parse(fs.readFileSync(path.join(here, 'rules.json'), 'utf8'));
const grid = rules.map?.grid ? JSON.parse(fs.readFileSync(path.join(here, rules.map.grid), 'utf8')) : null;
for (const d of [path.join(DATA, 'runs'), path.join(WEB, 'runs')]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(path.join(WEB, 'runs', 'index.json'))) fs.writeFileSync(path.join(WEB, 'runs', 'index.json'), '[]');

const day = (t) => t.slice(0, 10);
const write = (f, o) => { const tmp = `${f}.tmp`; fs.writeFileSync(tmp, JSON.stringify(o)); fs.renameSync(tmp, f); };
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
// A crash can leave a half-written last line: skip it rather than lose the run.
const readLines = (f) => { let t; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; } return t.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }); };
const noTrace = ({ trace, ...rest }) => rest;

// ---- runs: from the schedule, plus test runs ----------------------------------------
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
function racesOn(d) { // scheduled runs on UTC day d: official replaces practice on its day
  if (fs.existsSync(path.join(DATA, 'paused'))) return []; // <data>/paused holds the schedule; test runs still work
  const date = new Date(`${d}T00:00:00Z`);
  const out = [];
  for (const r of rules.schedule.runs) {
    if (r.days !== 'daily' && !r.days.split(',').some((x) => DOW[x] === date.getUTCDay())) continue;
    out.push({ kind: r.kind, at: `${d}T${r.at}:00.000Z` });
  }
  const byAt = new Map();
  for (const r of out) if (!byAt.has(r.at) || r.kind === 'official') byAt.set(r.at, r);
  return [...byAt.values()];
}
const raceId = (r) => `${r.at.slice(0, 16).replace(/[:]/g, '')}-${r.kind}`;
const raceFile = (id) => path.join(WEB, 'runs', `${id}.json`);
const beforeMs = (rules.window.recordFromMinutesBefore ?? 2) * 60000;
const closeMs = (rules.window.startTimeoutMinutes + 20) * 60000; // a run still unfinished by then is closed as it stands
let extraCache = { at: -Infinity, list: [] };
function extraRaces(now = Date.now()) { // read at most every 5 s
  if (now - extraCache.at < 5000) return extraCache.list;
  extraCache = { at: now, list: readJSON(path.join(DATA, 'extra-runs.json'), []).filter((r) => r && typeof r.at === 'string' && !Number.isNaN(Date.parse(r.at)))
    .map((r) => ({ kind: typeof r.kind === 'string' && /^[a-z]{1,12}$/.test(r.kind) ? r.kind : 'test', at: new Date(r.at).toISOString() })) };
  return extraCache.list;
}
function dueRaces(now) {
  const d = day(new Date(now).toISOString());
  return [...racesOn(d), ...extraRaces(now)].filter((r) => {
    const t = Date.parse(r.at);
    return now >= t - beforeMs && now <= t + closeMs && !fs.existsSync(raceFile(raceId(r)));
  });
}
function nextRace(now) {
  const d0 = day(new Date(now).toISOString()), d1 = day(new Date(now + 86400000).toISOString());
  return [...racesOn(d0), ...racesOn(d1), ...extraRaces(now)].filter((r) => Date.parse(r.at) > now).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
}

// ---- the loop --------------------------------------------------------------------------
const recording = new Map(); // id -> { run, readings, verdict }
const recent = [];           // the last 8 s of readings
let health = null, lastPublish = 0;

// Season 4: the drand rounds the back glance uses, polled all the time (see record.mjs beaconFeed).
const beacon = beaconFeed(rules);
beacon?.start();
const beaconFor = (readings) => (beacon && readings.length ? beacon.slice(...timeSpan(readings)) : {});
const finishing = new Set(); // the finishes under way (--replay waits for them; each is removed only once its file is written or it failed)

// The end of a run: its beacon rounds filled in from the beacon's history, judged once more, written.
// If any of it fails, the run is left as it was, to be finished again on the next reading.
function finish(id, rec, health_) {
  rec.finishing = true;
  const p = finishRun(id, rec, health_)
    .catch((e) => { rec.finishing = false; console.error(new Date().toISOString(), `race ${id}: finishing failed, will retry: ${e.message}`); })
    .finally(() => finishing.delete(p));
  finishing.add(p);
}
async function finishRun(id, rec, health_) {
  if (beacon && rec.readings.length) {
    const missing = await beacon.fill(...timeSpan(rec.readings));
    if (missing) console.log(`${new Date().toISOString()} race ${id}: ${missing} beacon rounds still missing`);
  }
  const run = { game: rules.challenge, id, kind: rec.race.kind, scheduled: rec.race.at, recorder: 'watch.mjs', grid,
    ...(rec.nc ? { newcomersFrom: rec.nc.from, newcomers: rec.newcomers } : {}), ...beaconFor(rec.readings), readings: rec.readings };
  const v = beacon ? judge(rules, run, { grid }) : rec.verdict; // with every round in, the final verdict
  write(raceFile(id), { ...run, rules, health: health_, result: v }); // the rules it was judged under: they can change between runs
  const idx = readJSON(path.join(WEB, 'runs', 'index.json'), []);
  idx.unshift({ id, kind: rec.race.kind, scheduled: rec.race.at, status: v.status, reason: v.reason ?? null, startedAt: v.startedAt ?? null, endedAt: v.endedAt ?? null, players: (v.players ?? []).map(noTrace) });
  write(path.join(WEB, 'runs', 'index.json'), idx.slice(0, 50));
  fs.rmSync(path.join(DATA, 'runs', `${id}.jsonl`), { force: true });
  recording.delete(id);
  console.log(`${new Date().toISOString()} race ${id}: ${v.status}, ${v.players?.length ?? 0} players`);
}

function ingest(s, everyone) {
  const now = Date.parse(s.t);
  recent.push(s);
  while (recent.length > 16) recent.shift();

  for (const race of dueRaces(now)) {
    const id = raceId(race);
    if (!recording.has(id)) {
      const readings = readLines(path.join(DATA, 'runs', `${id}.jsonl`));
      // Season 3: who's new, from the veterans list and this recorder's earlier runs (the site's run files).
      const nc = newcomerChecker(rules, here, path.join(WEB, 'runs'), race.at);
      let newcomers = [];
      for (const r of readings) newcomers = nc ? nc.check(r) : [];
      recording.set(id, { race, readings, verdict: null, nc, newcomers });
    }
  }
  for (const [id, rec] of recording) {
    if (rec.finishing || rec.readings.at(-1)?.seq >= s.seq) continue;
    rec.readings.push(s);
    if (rec.nc) rec.newcomers = rec.nc.check(s);
    fs.appendFileSync(path.join(DATA, 'runs', `${id}.jsonl`), JSON.stringify(s) + '\n');
  }

  // Judging a run and publishing are once a second; the readings above are every tick.
  if (now - lastPublish < 1000) return;
  lastPublish = now;
  let race = null;
  for (const [id, rec] of recording) {
    if (rec.finishing) continue;
    rec.verdict = judge(rules, { scheduled: rec.race.at, readings: rec.readings, ...(rec.nc ? { newcomers: rec.newcomers } : {}), ...beaconFor(rec.readings) }, { grid });
    if (['finished', 'void', 'cancelled'].includes(rec.verdict.status) || now > Date.parse(rec.race.at) + closeMs) {
      finish(id, rec, health);
      continue;
    }
    race = { id, kind: rec.race.kind, scheduled: rec.race.at, ...rec.verdict, players: (rec.verdict.players ?? []).map((p) => ({ ...noTrace(p), spotsAt: undefined, trace: p.trace.slice(-60) })) };
  }
  const c = checks(rules, recent.slice(-2)).list.at(-1);
  write(path.join(WEB, 'live.json'), {
    at: s.t, seq: s.seq, usable: c.usable, pup: s.pup, agents: s.agents,
    // Every tick of the last 8 s, as recorded, for the pages (positions only: names are in `agents`).
    recent: recent.map((x) => ({ t: x.t, seq: x.seq, pup: x.pup, near: Object.fromEntries(Object.entries(x.agents).map(([id, a]) => [id, [a.x, a.y]])) })),
    // Every agent in the dog's space, so the follow page can say how far away you are.
    all: everyone ?? null,
    race, next: nextRace(now),
    feed: health && { resyncs: health.resyncs, driftAgents: health.driftAgents, gaps: health.gaps, reconnects: health.reconnects, since: health.since },
  });
}

// --replay <run or jsonl file>: feed recorded readings through the same code, then stop (lab
// previews and tests; the data folder should start empty).
const replay = opt('--replay', null);
if (replay) {
  const src = fs.readFileSync(replay, 'utf8');
  const list = src.trimStart().startsWith('{"game') || src.trimStart().startsWith('{"scheduled') ? JSON.parse(src).readings : src.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const n = Number(opt('--readings', list.length));
  for (const s of list.slice(0, n)) ingest(s, null);
  console.log(`replayed ${Math.min(n, list.length)} readings`);
  while (finishing.size) await Promise.all([...finishing]);
  process.exit(0);
}

console.log(`tail watch: data ${DATA}, web ${WEB}, every tick`);
const feed = new CityFeed({ space: rules.subject.spaceId, log: (l) => console.error(l) });
feed.on('health', (h) => { health = h; });
feed.on('reading', (r) => {
  health = feed.health;
  const s = readingOf(rules, r);
  const all = Object.create(null);
  if (s.pup) for (const [id, a] of r.state.agents) if (a.position?.spaceId === s.pup.spaceId) all[id] = [a.position.x, a.position.y];
  try { ingest(s, all); } catch (err) { console.error(new Date().toISOString(), err.stack || err.message); }
});
feed.start();
