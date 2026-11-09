// Judge a tailing run from public readings. Pure: same rules + run, same verdict.
//
//   node judge.mjs rules.json runs/<race>.json      (from this game's folder)
//
// A run file is { "scheduled": "<ISO>", "readings": [ reading, ... ] } in the order taken, one
// reading per city tick (record.mjs):
//   { "t": "<ISO>", "seq": n, "pup": { "spaceId", "x", "y" } | null,
//     "agents": { "<agent id>": { "name", "spaceId", "x", "y" }, ... } }
// An agent missing from a reading was not near the dog (or not in the feed): infinitely far.
// Every rule is in seconds of the city's own clock, so the judge doesn't depend on how often
// readings come, only on what they show.

// ---- the route: where along the loop the pup is ----------------------------------------
export function routeOf(points) {
  const segs = [];
  let at = 0;
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length];
    const len = Math.hypot(bx - ax, by - ay);
    segs.push({ ax, ay, bx, by, len, from: at });
    at += len;
  }
  return { segs, length: at };
}
// The nearest point on the loop: { s (distance along it from the gate), off, seg }.
export function place(route, x, y) {
  let best = null;
  for (const g of route.segs) {
    const dx = g.bx - g.ax, dy = g.by - g.ay;
    const u = Math.max(0, Math.min(1, ((x - g.ax) * dx + (y - g.ay) * dy) / (g.len * g.len)));
    const off = Math.hypot(x - (g.ax + u * dx), y - (g.ay + u * dy));
    if (!best || off < best.off) best = { s: g.from + u * g.len, off, seg: g };
  }
  return best;
}

// Line of sight on the city's walkable grid ({ w, h, runs: [[value, count], ...] }, row by
// row): clear when every tile the straight line between the two tile centres passes through,
// apart from the two ends, is walkable (1). Sampled at quarter-tile steps.
export function sightFrom(grid) {
  const g = new Uint8Array(grid.w * grid.h);
  let k = 0;
  for (const [v, n] of grid.runs) { g.fill(v, k, k + n); k += n; }
  const open = (x, y) => x >= 0 && y >= 0 && x < grid.w && y < grid.h && g[y * grid.w + x] === 1;
  // `through`: how many blocked tiles the line may cross and still count as clear.
  return (a, b, through = 0) => {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 4);
    const blocked = new Set();
    for (let i = 1; i < n; i++) {
      const x = Math.round(a.x + ((b.x - a.x) * i) / n), y = Math.round(a.y + ((b.y - a.y) * i) / n);
      if ((x !== a.x || y !== a.y) && (x !== b.x || y !== b.y) && !open(x, y)) { blocked.add(y * grid.w + x); if (blocked.size > through) return false; }
    }
    return true;
  };
}
// Raw fish carried weakens a hiding place: the dog's view counts through a few blocked tiles.
export function fishThrough(rules, fish) {
  let through = 0;
  for (const t of rules.spot.fish?.tiers ?? []) if ((fish ?? 0) >= t.min) through = t.through;
  return through;
}
// Matcha is the offset: its level is taken off the fish level. Fish ahead, the dog sees through
// that many blocked tiles; matcha ahead, its view is shorter.
export function matchaLevel(rules, matcha) {
  let level = 0;
  for (const t of rules.spot.matcha?.tiers ?? []) if ((matcha ?? 0) >= t.min) level = t.level;
  return level;
}
export function senses(rules, pos) {
  const net = fishThrough(rules, pos?.fish) - matchaLevel(rules, pos?.matcha), M = rules.spot.matcha;
  const reach = net < 0 && M ? Math.max(M.minView, rules.spot.frontDistance + net * M.viewLossPerLevel) : rules.spot.frontDistance;
  return { through: Math.max(0, net), reach };
}
function sightFor(rules, grid) {
  if (!rules.spot.lineOfSight) return null;
  if (!grid) throw new Error('these rules use line of sight: pass { grid } (central-grid.json)');
  return sightFrom(grid);
}

const dist = (a, b) => (a && b && a.spaceId === b.spaceId ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);
const round = (n, d = 2) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
// The readings of agents by id; tolerant of a run file without the "agents" object.
const own = (o, k) => (o && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);

// Which readings count: the pup in its space, near its route, at a new sequence.
export function checks(rules, readings) {
  const route = routeOf(rules.subject.route);
  const out = [];
  let last = -Infinity;
  for (const [i, r] of readings.entries()) {
    const p = r.pup;
    const on = p && p.spaceId === rules.subject.spaceId ? place(route, p.x, p.y) : null;
    const seq = r.seq ?? r.tick ?? null;
    const fresh = seq == null || seq > last;
    if (seq != null && seq > last) last = seq;
    out.push({ i, t: r.t, ms: Date.parse(r.t), usable: !!(on && on.off <= rules.subject.maxOffRoute && fresh), s: on?.s ?? null });
  }
  return { route, list: out };
}

// The dog's heading: its move over the last spot.headingSeconds (from the latest usable
// reading at least that long ago). Standing still, it keeps facing the way it last moved.
function headings(rules) {
  const back = (rules.spot.headingSeconds ?? 2) * 1000;
  const past = [];
  let last = [0, 0];
  return (ms, pup) => {
    let ref = null;
    for (let k = past.length - 1; k >= 0; k--) if (past[k].ms <= ms - back) { ref = past[k]; break; }
    ref ??= past[0] ?? null;
    if (ref) { const h = [pup.x - ref.pup.x, pup.y - ref.pup.y]; if (h[0] || h[1]) last = h; }
    past.push({ ms, pup });
    while (past.length > 2 && past[1].ms <= ms - back) past.shift();
    return last;
  };
}

const newPlayer = (id, name, ms) => ({ id, name, t0: ms, out: null, far: false, farFor: 0, seen: false, sus: 0, maxSus: 0,
  seenSeconds: 0, sightings: 0, tailSum: 0, tailT: 0, spotsAt: [], trace: [], lastSec: -1 });

// One reading for one player. dt: seconds since the previous usable reading (capped).
function step(rules, p, pos, pup, [hx, hy], ms, dt, sees) {
  const S = rules.spot, U = rules.suspicion;
  const d = dist(pos, pup);
  // Time beyond the lost line, in the same capped steps as everything else: an outage can't lose you.
  if (d > rules.lostDistance) { if (p.far) p.farFor += dt; p.far = true; } else { p.far = false; p.farFor = 0; }
  // In front: within viewAngle degrees of its heading (90 = the whole half in front of it).
  const cosView = Math.cos(((S.viewAngle ?? 90) * Math.PI) / 180);
  const front = Number.isFinite(d) && d > 0 && (hx || hy)
    ? (hx * (pos.x - pup.x) + hy * (pos.y - pup.y)) / (Math.hypot(hx, hy) * d) > cosView + 1e-9 : false;
  const { through, reach } = senses(rules, pos);
  const seen = d < S.minDistance || (d <= reach && front && (!sees || sees(pup, pos, through)));
  if (seen) {
    p.sus += U.perSecondSeen * dt; p.seenSeconds += dt;
    if (!p.seen) { p.sightings++; p.spotsAt.push([pup.x, pup.y]); }
  } else p.sus = Math.max(0, p.sus - U.drainPerSecond * dt);
  p.seen = seen;
  p.maxSus = Math.max(p.maxSus, p.sus);
  if (Number.isFinite(d)) { p.tailSum += Math.abs(d - rules.idealDistance) * dt; p.tailT += dt; }
  // On the dog's own tile: caught at once, however quiet you've been.
  if (U.caughtOnSameTile && d === 0) { p.sus = U.caughtAt; p.maxSus = Math.max(p.maxSus, p.sus); p.out = { why: 'caught', ms }; }
  else if (p.far && p.farFor >= rules.lostSeconds - 1e-9) p.out = { why: 'lost', ms };
  else if (p.sus >= U.caughtAt) p.out = { why: 'caught', ms };
  // The trace, about one row a second: [seconds since this player's start, distance, seen, suspicion, seconds beyond the lost line].
  const sec = Math.floor((ms - p.t0) / 1000);
  if (sec !== p.lastSec || p.out) { p.trace.push([sec, round(d, 1), seen ? 1 : 0, round(p.sus), p.far ? round(p.farFor, 1) : 0]); p.lastSec = sec; }
}

// Names aren't unique. Where two players share one (ignoring case), each shows a short piece of
// its id: "Atlas ·5a1z". The id itself is in every result.
export function labels(players) {
  const n = new Map();
  for (const p of players) { const k = String(p.name).toLowerCase(); n.set(k, (n.get(k) ?? 0) + 1); }
  for (const p of players) p.label = n.get(String(p.name).toLowerCase()) > 1 ? `${p.name} ·${String(p.id).slice(-4)}` : p.name;
  return players;
}

const summary = (p, endMs) => ({
  id: p.id, name: p.name,
  outAt: p.out ? new Date(p.out.ms).toISOString() : null,
  lastedSeconds: round(((p.out ? p.out.ms : endMs) - p.t0) / 1000, 0),
  seenSeconds: round(p.seenSeconds, 1), sightings: p.sightings, maxSuspicion: round(p.maxSus),
  meanTail: p.tailT ? round(p.tailSum / p.tailT) : null,
  spotsAt: p.spotsAt, trace: p.trace,
});

export function judge(rules, run, { grid } = {}) {
  // A run file can carry the map it was recorded on, so it stays reproducible if the city changes.
  const sees = sightFor(rules, run.grid ?? grid);
  const readings = run.readings ?? [];
  const { route, list } = checks(rules, readings);
  const L = route.length;
  const sched = Date.parse(run.scheduled);
  const W = rules.window;
  const usable = list.filter((c) => c.usable);
  const crossed = (prev, cur) => prev && cur.s < prev.s - L / 2; // the place along the loop wraps
  let startK = -1;
  for (let k = 1; k < usable.length; k++) {
    const c = usable[k];
    if (c.ms < sched) continue;
    if (c.ms > sched + W.startTimeoutMinutes * 60000) break;
    if (crossed(usable[k - 1], c)) { startK = k; break; }
  }
  if (startK < 0) {
    const last = list.at(-1);
    const waiting = !last || last.ms <= sched + W.startTimeoutMinutes * 60000;
    return waiting ? { status: 'waiting', reason: 'no gate crossing seen yet', routeLength: round(L, 1) }
      : { status: 'cancelled', reason: 'no gate crossing seen within the start timeout', routeLength: round(L, 1) };
  }

  const start = usable[startK];
  const pupAt = (c) => readings[c.i].pup;
  // Entrants: within lostDistance at the start reading, and for the entrySeconds before it,
  // so someone who just happens to be walking past the gate isn't in the run.
  // Time counted in the same capped steps as everything else, so a feed gap can't stand in for presence.
  const entrySeconds = rules.entrySeconds ?? 0, entryCap = W.maxStepSeconds ?? 1;
  const settled = (id) => {
    let near = 0;
    for (let k = startK; k >= 0; k--) {
      const c = usable[k];
      if (!(dist(own(readings[c.i].agents, id), pupAt(c)) <= rules.lostDistance)) return false;
      if (k < startK) near += Math.min(entryCap, Math.max(0, (usable[k + 1].ms - c.ms) / 1000));
      if (near >= entrySeconds - 1e-9) return true;
    }
    return false;
  };
  const players = Object.entries(readings[start.i].agents ?? {})
    .filter(([id]) => settled(id))
    .map(([id, a]) => newPlayer(id, a.name, start.ms));

  const heading = headings(rules);
  for (const c of usable.slice(Math.max(0, startK - 20), startK)) heading(c.ms, pupAt(c)); // the dog's way at the start
  const gapMs = W.maxGapSeconds * 1000, stepCap = W.maxStepSeconds ?? 1;
  let laps = 0, end = null, voided = null, prev = usable[startK - 1], lastMs = start.ms;
  for (let j = start.i; j < list.length; j++) {
    const c = list[j];
    if (c.ms - lastMs > gapMs) { voided = c.t; break; } // no usable reading for too long
    if (!c.usable) continue;
    if (c !== start && crossed(prev, c)) laps++;
    const pup = pupAt(c);
    const h = heading(c.ms, pup);
    const dt = c === start ? 0 : Math.min(stepCap, Math.max(0, (c.ms - prev.ms) / 1000)); // the run begins at the start reading
    for (const p of players) if (!p.out) step(rules, p, own(readings[c.i].agents, p.id), pup, h, c.ms, dt, sees);
    prev = c; lastMs = c.ms;
    if (laps >= W.laps) { end = c; break; }
  }
  if (!voided && !end && list.length && list.at(-1).ms - lastMs > gapMs) voided = list.at(-1).t;
  const status = voided ? 'void' : end ? 'finished' : 'unfinished';
  const endMs = (end ?? prev).ms;
  const result = players.map((p) => ({ ...summary(p, endMs), status: p.out ? p.out.why : end ? 'tailed to the end' : 'still tailing' }));
  const done = (r) => r.status === 'tailed to the end';
  // Finishers first, the lowest tail on top, then fewest seconds seen; the rest by how long they lasted.
  result.sort((a, b) => (done(b) - done(a)) || (done(a) ? ((a.meanTail ?? 1e9) - (b.meanTail ?? 1e9)) || (a.seenSeconds - b.seenSeconds) : (b.lastedSeconds - a.lastedSeconds) || ((a.meanTail ?? 1e9) - (b.meanTail ?? 1e9))) || (a.id < b.id ? -1 : 1));
  labels(result);
  return {
    status, ...(voided ? { reason: `no usable reading for more than ${W.maxGapSeconds} s`, voidedAt: voided } : {}),
    startedAt: start.t, endedAt: end?.t ?? null, laps, routeLength: round(L, 1),
    usableReadings: list.filter((c) => c.usable && c.i >= start.i && (!end || c.i <= end.i)).length,
    players: result,
  };
}

// Practice on your own (the follow page): the same rules, any time. A session starts once a
// player has been within lostDistance for practice.startSeconds, is judged exactly as a run,
// and ends when the player is lost or caught. After being caught, a player must get beyond
// lostDistance before a new session can start. No usable reading for window.maxGapSeconds
// ends every session without a verdict ("feed").
export function practice(rules, readings, { grid } = {}) {
  const sees = sightFor(rules, grid);
  const { route, list } = checks(rules, readings);
  const L = route.length;
  const need = rules.practice?.startSeconds ?? 10;
  const near = new Map();   // id -> seconds within lostDistance, in capped steps
  const live = new Map();   // id -> { p, laps }
  const shaken = new Set(); // caught: must get beyond lostDistance first
  const sessions = [];
  const gapMs = rules.window.maxGapSeconds * 1000, stepCap = rules.window.maxStepSeconds ?? 1;
  let heading = headings(rules), prev = null;
  const close = (id, s, why, ms) => {
    sessions.push({ ...summary(s.p, ms), start: new Date(s.p.t0).toISOString(), end: new Date(ms).toISOString(), why, laps: s.laps });
    live.delete(id);
    if (why === 'caught') shaken.add(id);
  };
  for (const c of list) {
    if (prev && c.ms - prev.ms > gapMs) {
      for (const [id, s] of live) close(id, s, 'feed', prev.ms);
      near.clear(); heading = headings(rules); prev = null;
    }
    if (!c.usable) continue;
    const pup = readings[c.i].pup, agents = readings[c.i].agents ?? {};
    const crossed = prev && c.s < prev.s - L / 2;
    const h = heading(c.ms, pup);
    const dt = prev ? Math.min(stepCap, Math.max(0, (c.ms - prev.ms) / 1000)) : 0;
    for (const [id, s] of live) {
      if (crossed) s.laps++;
      step(rules, s.p, own(agents, id), pup, h, c.ms, dt, sees);
      if (s.p.out) close(id, s, s.p.out.why, c.ms);
    }
    for (const id of [...shaken]) if (!(dist(own(agents, id), pup) <= rules.lostDistance)) shaken.delete(id);
    for (const id of [...near.keys()]) if (!(dist(own(agents, id), pup) <= rules.lostDistance)) near.delete(id);
    for (const [id, a] of Object.entries(agents)) {
      if (live.has(id) || shaken.has(id) || !(dist(a, pup) <= rules.lostDistance)) continue;
      near.set(id, near.has(id) ? near.get(id) + dt : 0);
      if (near.get(id) >= need - 1e-9) {
        near.delete(id);
        const s = { p: newPlayer(id, a.name, c.ms), laps: 0 };
        live.set(id, s);
        step(rules, s.p, a, pup, h, c.ms, 0, sees);
      }
    }
    prev = c;
  }
  const open = [...live].map(([, s]) => ({ ...summary(s.p, prev?.ms ?? s.p.t0), start: new Date(s.p.t0).toISOString(), end: null, why: 'open', laps: s.laps, suspicion: round(s.p.sus), seen: s.p.seen }));
  return { sessions, open };
}

if (typeof process !== 'undefined' && process.argv?.[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const [rulesPath, runPath] = process.argv.slice(2);
  if (!rulesPath || !runPath) { console.error('usage: node judge.mjs rules.json runs/<run>.json'); process.exit(2); }
  const rules = JSON.parse(fs.readFileSync(rulesPath, 'utf8'));
  const grid = rules.map?.grid ? JSON.parse(fs.readFileSync(path.join(path.dirname(path.resolve(rulesPath)), rules.map.grid), 'utf8')) : null;
  const r = judge(rules, JSON.parse(fs.readFileSync(runPath, 'utf8')), { grid });
  if (!process.argv.includes('--trace')) for (const p of r.players ?? []) delete p.trace;
  console.log(JSON.stringify(r, null, 2));
}
