// node --test judge.test.mjs : the judge on a synthetic dog that walks the route exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { judge, practice, routeOf, sightFrom, labels, fishThrough, senses, newcomersFor, glanceBegins, glanceState, glanceChance, roundAt, roundTime } from './judge.mjs';
import { countsAsRun } from './judge.mjs';
import { verifyRound, beaconGaps, neededRounds, trustedBeacon } from './beacon.mjs';
import { fromSnapshot, applyDelta, drift, clone } from './citystate.mjs';

const file = JSON.parse(fs.readFileSync(new URL('./rules.json', import.meta.url), 'utf8'));
// The synthetic dog walks straight lines with no city map, so these tests turn sight off; the
// line-of-sight test below uses a small map of its own.
// The older tests also put several synthetic players on one tile, so smell (Season 3) is off for them;
// the Season 3 tests at the end turn it on.
const rules = { ...file, spot: { ...file.spot, lineOfSight: false }, smell: undefined };
const route = routeOf(rules.subject.route);
const SPEED = 1.8, STEP = 0.5; // tiles a second; seconds a reading
const T0 = Date.parse('2026-11-08T21:00:00Z');
const iso = (sec) => new Date(T0 + sec * 1000).toISOString();
function at(s) {
  s = ((s % route.length) + route.length) % route.length;
  const g = route.segs.find((q) => s >= q.from && s < q.from + q.len) ?? route.segs.at(-1);
  const u = (s - g.from) / g.len;
  return { spaceId: 'central', x: Math.round(g.ax + u * (g.bx - g.ax)), y: Math.round(g.ay + u * (g.by - g.ay)) };
}
// A reading every half second from 20 s before the dog reaches the gate. players: id -> (sec, s) => position
function run(players, { seconds = 700, startS = -36, scheduled = T0, mutate } = {}) {
  const readings = [];
  for (let k = 0; k < seconds / STEP; k++) {
    const sec = k * STEP, s = startS + sec * SPEED;
    const agents = {};
    for (const [id, f] of Object.entries(players)) { const p = f(sec, s); if (p) agents[id] = { name: id, ...p }; }
    readings.push({ t: iso(sec), seq: 1000 + k, pup: at(s), agents });
  }
  mutate?.(readings);
  return { scheduled: new Date(scheduled).toISOString(), readings };
}
const behind = (tiles) => (sec, s) => at(s - tiles);
const byId = (r) => Object.fromEntries(r.players.map((p) => [p.id, p]));

test('the window: starts at the gate crossing, ends after 3 more laps', () => {
  const r = judge(rules, run({ tail: behind(6) }));
  assert.equal(r.status, 'finished');
  assert.ok(Math.abs((Date.parse(r.startedAt) - T0) / 1000 - 20) <= 1);
  assert.equal(r.laps, 3);
  assert.ok(Math.abs((Date.parse(r.endedAt) - Date.parse(r.startedAt)) / 1000 - 3 * route.length / SPEED) <= 2);
});

test('a steady tail lasts; a hug is caught; drifting away is lost', () => {
  const p = byId(judge(rules, run({ tail: behind(6), hug: behind(1), far: behind(9), drifting: (sec, s) => at(s - 8 - sec * 0.1) })));
  assert.equal(p.tail.status, 'tailed to the end');
  assert.ok(p.tail.maxSuspicion < rules.suspicion.caughtAt);
  assert.equal(p.hug.status, 'caught');
  assert.equal(p.far.status, 'tailed to the end');
  assert.equal(p.drifting.status, 'lost');
  assert.ok(p.tail.meanTail < p.far.meanTail);
});

test('ranking: finishers first, the lowest tail on top, ties to the least seen', () => {
  const r = judge(rules, run({ eight: behind(8), five: behind(5.4), hug: behind(0.5) }));
  assert.deepEqual(r.players.map((p) => p.id), ['five', 'eight', 'hug']);
  const glimpse = (sec, s) => (sec >= 100 && sec < 101 ? at(s + 4) : at(s - 5.4));
  const q = judge(rules, run({ wide: behind(8), glimpse }));
  assert.deepEqual(q.players.map((p) => p.id), ['glimpse', 'wide']); // a steadier tail outranks being seen less
});

test('a passer-by at the start is not in the run; someone there for entrySeconds is', () => {
  const r = judge(rules, run({ passing: (sec, s) => (sec < 16 ? at(s - 40) : at(s - 6)), settled: behind(6) }));
  assert.deepEqual(r.players.map((p) => p.id), ['settled']);
});

test('lost takes lostSeconds in a row; a shorter absence is forgiven; out of the space is far', () => {
  const away = (from, secs, f) => (sec, s) => (sec >= from && sec < from + secs ? f(sec, s) : at(s - 6));
  const p = byId(judge(rules, run({
    blip: away(100, rules.lostSeconds - 2, (sec, s) => at(s - 40)),
    gone: away(100, rules.lostSeconds + 2, (sec, s) => ({ ...at(s - 6), spaceId: 'north' })),
    missing: away(100, rules.lostSeconds + 2, () => null),
  })));
  assert.equal(p.blip.status, 'tailed to the end');
  assert.equal(p.gone.status, 'lost');
  assert.equal(p.missing.status, 'lost');
  assert.equal(p.gone.outAt, iso(100 + rules.lostSeconds));
});

test('an outage shorter than the void limit does not lose you', () => {
  // Far for 2 s, a 20 s hole in the readings, far for 2 s more, then back: 5 capped seconds at most.
  const pl = (sec, s) => (sec >= 100 && sec < 124 ? at(s - 40) : at(s - 6));
  const p = byId(judge(rules, run({ pl }, { mutate: (rd) => rd.splice(204, 40) })));
  assert.equal(p.pl.status, 'tailed to the end');
});

test('the start reading itself adds no time', () => {
  const p = byId(judge(rules, run({ close: behind(1) })));
  assert.equal(p.close.trace[0][3], 0);
});

test('the trace carries the seconds spent beyond the lost line', () => {
  const pl = (sec, s) => (sec >= 100 && sec < 106 ? at(s - 40) : at(s - 6));
  const t = byId(judge(rules, run({ pl }))).pl.trace;
  assert.ok(t.some((r) => r[4] >= 4 && r[4] <= 6));
  assert.equal(t.at(-1)[4], 0);
});

test('entry needs observed time near the dog: a feed gap does not count', () => {
  // Readings stop for 15 s before the start. Two readings either side are not 10 s of presence.
  const start = 20; // the gate crossing in run()
  const gap = (rd) => { const a = (start - 16) / STEP, n = 15 / STEP; rd.splice(a, n); };
  const r = judge(rules, run({ tail: behind(6) }, { mutate: gap }));
  assert.equal(r.status, 'finished');
  assert.deepEqual(r.players.map((p) => p.id), []);
});

test('a run carrying its map is judged on it, not the current one', () => {
  const R = { ...file, spot: { ...file.spot, lineOfSight: true } };
  const x = run({}, { seconds: 10 });
  assert.throws(() => judge(R, x), /line of sight/);
  assert.equal(judge(R, { ...x, grid: { w: 1, h: 1, runs: [[1, 1]] } }).status, 'waiting');
});

test('suspicion builds per second seen and drains per second quiet', () => {
  const U = rules.suspicion, need = U.caughtAt / U.perSecondSeen;
  const ahead = (secs) => (sec, s) => (sec >= 100 && sec < 100 + secs ? at(s + 4) : at(s - 6));
  const p = byId(judge(rules, run({ long: ahead(need + 1), short: ahead(need / 2) })));
  assert.equal(p.long.status, 'caught');
  assert.equal(p.short.status, 'tailed to the end');
  assert.equal(p.short.sightings >= 1, true);
  assert.ok(Math.abs(p.short.maxSuspicion - U.caughtAt / 2) <= U.perSecondSeen);
});

test('only agents within 10 at the start are in', () => {
  const r = judge(rules, run({ late: (sec, s) => (sec < 40 ? at(s - 30) : at(s - 6)), near: behind(6) }));
  assert.deepEqual(r.players.map((p) => p.id), ['near']);
});

test('no crossing yet is waiting, then cancelled; a long outage voids the race', () => {
  assert.equal(judge(rules, run({}, { seconds: 10 })).status, 'waiting');
  assert.equal(judge(rules, run({}, { mutate: (rd) => { for (const x of rd) x.pup = at(50); } })).status, 'cancelled');
  const hole = (from, secs) => (rd) => { for (let k = from / STEP; k < (from + secs) / STEP; k++) rd[k].pup = null; };
  assert.equal(judge(rules, run({ tail: behind(6) }, { mutate: hole(100, rules.window.maxGapSeconds + 5) })).status, 'void');
  assert.equal(judge(rules, run({ tail: behind(6) }, { mutate: hole(100, rules.window.maxGapSeconds - 5) })).status, 'finished');
  const cut = (rd) => rd.splice(200, (rules.window.maxGapSeconds + 5) / STEP);
  assert.equal(judge(rules, run({ tail: behind(6) }, { mutate: cut })).status, 'void');
});

test('an outage neither builds nor drains suspicion beyond the step cap', () => {
  const ahead = (sec, s) => (sec >= 100 && sec < 101 ? at(s + 4) : at(s - 6));
  const gap = (rd) => rd.splice(200, 40); // 20 s missing right after the sighting
  const p = byId(judge(rules, run({ a: ahead }, { mutate: gap })));
  assert.ok(p.a.maxSuspicion <= rules.suspicion.perSecondSeen * (1 + rules.window.maxStepSeconds));
});

test('repeated sequences are ignored', () => {
  const r = run({ tail: behind(6) });
  const base = judge(rules, r).usableReadings;
  const stale = run({ tail: behind(6) }, { mutate: (rd) => { for (let k = 200; k < 210; k++) rd[k].seq = rd[199].seq; } });
  assert.equal(judge(rules, stale).usableReadings, base - 10);
});

test('the same race always gives the same verdict', () => {
  const x = run({ tail: behind(6), hug: behind(1) });
  assert.deepEqual(judge(rules, x), judge(rules, structuredClone(x)));
});

test('players are ids: two agents sharing a name stay apart and both show a short id', () => {
  const x = run({ 'user-agent-aaaa1111': behind(6), 'user-agent-bbbb2222': behind(1) });
  for (const r of x.readings) for (const a of Object.values(r.agents)) a.name = 'Atlas';
  const r = judge(rules, x);
  const p = byId(r);
  assert.equal(p['user-agent-aaaa1111'].status, 'tailed to the end');
  assert.equal(p['user-agent-bbbb2222'].status, 'caught');
  assert.equal(p['user-agent-aaaa1111'].label, 'Atlas ·1111');
  assert.equal(p['user-agent-bbbb2222'].label, 'Atlas ·2222');
  assert.deepEqual(labels([{ id: 'x1', name: 'Solo' }]).map((q) => q.label), ['Solo']);
});

test('a name like __proto__ is just a name, and a missing id is just missing', () => {
  const x = run({ tail: behind(6) });
  for (const r of x.readings) { const a = r.agents.tail; delete r.agents.tail; r.agents = Object.assign(Object.create(null), JSON.parse('{"__proto__":' + JSON.stringify({ ...a, name: '__proto__' }) + '}')); }
  const p = judge(rules, JSON.parse(JSON.stringify(x))).players;
  assert.equal(p.length, 1);
  assert.equal(p[0].name, '__proto__');
});

test('practice: starts after startSeconds within 10, ends at lost or caught', () => {
  const need = rules.practice.startSeconds;
  const pl = (sec, s) => (sec < 20 ? at(s - 30) : sec < 150 ? at(s - 6) : sec < 250 ? at(s - 40) : at(s - 0.5));
  const { sessions, open } = practice(rules, run({ pl }).readings);
  assert.equal(sessions.length, 2);
  assert.ok(Math.abs((Date.parse(sessions[0].start) - T0) / 1000 - (20 + need)) <= 1);
  assert.equal(sessions[0].why, 'lost');
  assert.equal(sessions[1].why, 'caught');
  assert.equal(open.length, 0);
});

test('practice: an open session, laps counted, and a feed outage ends it', () => {
  const r = practice(rules, run({ tail: behind(6) }).readings);
  assert.equal(r.sessions.length, 0);
  assert.equal(r.open.length, 1);
  assert.ok(r.open[0].laps >= 3);
  const out = practice(rules, run({ tail: behind(6) }, { mutate: (rd) => rd.splice(200, 80) }).readings);
  assert.equal(out.sessions[0].why, 'feed');
  assert.equal(out.open.length, 1); // picked up again after the outage
});

test('line of sight: a building between hides you; without the map the judge refuses', () => {
  const grid = { w: 7, h: 3, runs: [[1, 7], [1, 3], [0, 1], [1, 3], [1, 7]] };
  const sees = sightFrom(grid);
  assert.equal(sees({ x: 0, y: 1 }, { x: 6, y: 1 }), false);
  assert.equal(sees({ x: 0, y: 0 }, { x: 6, y: 0 }), true);
  assert.throws(() => judge(file, run({})), /line of sight/);
  const s2 = sightFrom(JSON.parse(fs.readFileSync(new URL('./central-grid.json', import.meta.url), 'utf8')));
  assert.equal(s2({ x: 103, y: 27 }, { x: 103, y: 34 }), false); // courtyard south of the NE street
  assert.equal(s2({ x: 103, y: 27 }, { x: 98, y: 27 }), true);   // along the street
});

test('on the dog\'s tile: caught at once; next to it is not', () => {
  const pup = at(20);
  const readings = Array.from({ length: 60 }, (_, k) => ({ t: iso(k * STEP), seq: 1000 + k, pup,
    agents: { on: { name: 'on', ...(k < 40 ? { ...pup, x: pup.x + 5 } : pup) }, beside: { name: 'beside', ...pup, x: pup.x + 1 } } }));
  const { sessions } = practice({ ...rules, suspicion: { ...rules.suspicion, caughtAt: 99 } }, readings);
  assert.equal(sessions.find((s) => s.id === 'on')?.why, 'caught');
  assert.equal(sessions.find((s) => s.id === 'beside'), undefined);
});

test('exactly minDistance away is not too close ("closer than"); just inside is', () => {
  // A dog standing still (no heading, so nothing is "in front"): only the too-close rule applies.
  const pup = at(20), m = rules.spot.minDistance;
  const readings = Array.from({ length: 60 }, (_, k) => ({ t: iso(k * STEP), seq: 1000 + k, pup,
    agents: { edge: { name: 'edge', ...pup, x: pup.x + m }, inside: { name: 'inside', ...pup, x: pup.x + m - 0.5 } } }));
  const { sessions, open } = practice(rules, readings);
  const by = Object.fromEntries([...sessions, ...open].map((o) => [o.id, o]));
  assert.equal(by.edge.seenSeconds, 0);
  assert.ok(by.inside.seenSeconds > 0);
});

test('raw fish lets the dog see through thin walls, by how much is carried', () => {
  const sees = sightFrom({ w: 9, h: 1, runs: [[1, 2], [0, 2], [1, 1], [0, 1], [1, 3]] }); // walls at x = 2,3 and 5
  const A = { x: 0, y: 0 }, thin = { x: 4, y: 0 }, far = { x: 8, y: 0 };
  assert.equal(sees(A, thin), false);
  assert.equal(sees(A, thin, 1), false);
  assert.equal(sees(A, thin, 2), true);
  assert.equal(sees(A, far, 2), false);
  assert.equal(sees(A, far, 3), true);
  assert.deepEqual([0, 1, 99, 100, 9999, 10000, 1e6].map((n) => fishThrough(file, n)), [0, 1, 1, 2, 2, 3, 3]);
});

test('matcha offsets fish; ahead on its own it shortens the dog\'s view', () => {
  const S = (fish, matcha) => { const { through, reach } = senses(file, { fish, matcha }); return { through, reach }; };
  assert.deepEqual(S(0, 0), { through: 0, reach: 10 });
  assert.deepEqual(S(500, 0), { through: 2, reach: 10 });      // fish level 2
  assert.deepEqual(S(500, 2), { through: 1, reach: 10 });      // minus matcha level 1
  assert.deepEqual(S(500, 10), { through: 0, reach: 10 });     // even
  assert.deepEqual(S(0, 2), { through: 0, reach: 8 });
  assert.deepEqual(S(0, 10), { through: 0, reach: 6 });
  assert.deepEqual(S(0, 500), { through: 0, reach: 6 });       // never below minView
});

test('matcha: in front at 9 tiles is seen without it, not seen with enough of it', () => {
  const ahead = (extra) => (sec, s) => { const p = at(sec >= 100 && sec < 104 ? s + 9 : s - 6); return { ...p, ...extra }; };
  const p = byId(judge(rules, run({ plain: ahead({}), sipping: ahead({ matcha: 10 }) })));
  assert.ok(p.plain.seenSeconds > 2);
  assert.ok(p.sipping.seenSeconds < p.plain.seenSeconds);
});

// ---- applying the feed ------------------------------------------------------------------
const snap = () => ({ sequence: '100', staticVersion: 7, dynamicWorld: { tick: 100, timestamp: 1000,
  npcs: [{ name: 'Central Patrol 01', position: { spaceId: 'central', x: 10, y: 10 } }],
  agents: [{ id: 'a', name: 'Ann', position: { spaceId: 'central', x: 1, y: 2 } }, { id: 'b', name: 'Bo', position: { spaceId: 'central', x: 5, y: 5 } }] } });
const delta = (from, to, batch) => ({ type: 'spectator_delta', staticVersion: 7, fromSequence: String(from), toSequence: String(to), batch: { tick: to, timestamp: 1000 + (to - 100) * 500, ...batch } });

test('feed: partial position patches, arrivals, departures, the dog', () => {
  const s = fromSnapshot(snap());
  assert.equal(applyDelta(s, delta(100, 101, {
    agentPatches: [{ id: 'a', merge: { position: { x: 3 } } }, { id: 'c', set: { name: 'Cy', position: { spaceId: 'central', x: 9, y: 9 } } }],
    npcPatches: [{ name: 'Central Patrol 01', merge: { position: { y: 11 } } }],
    removedAgentIds: ['b'],
  })), 'applied');
  assert.deepEqual(s.agents.get('a'), { name: 'Ann', position: { spaceId: 'central', x: 3, y: 2 }, fish: 0, matcha: 0 });
  assert.equal(s.agents.get('c').name, 'Cy');
  assert.equal(s.agents.has('b'), false);
  assert.deepEqual(s.npcs.get('Central Patrol 01'), { spaceId: 'central', x: 10, y: 11 });
  assert.equal(s.seq, 101);
  assert.equal(s.unknown, 0);
});

test('feed: raw fish follows the inventory', () => {
  const b = snap(); b.dynamicWorld.agents[0].inventory = { fish: 5, ore: 2 };
  const s = fromSnapshot(b);
  assert.equal(s.agents.get('a').fish, 5);
  applyDelta(s, delta(100, 101, { agentPatches: [{ id: 'a', merge: { inventory: { ore: 9 } } }] }));
  assert.equal(s.agents.get('a').fish, 5);
  applyDelta(s, delta(101, 102, { agentPatches: [{ id: 'a', merge: { inventory: { fish: 12 } } }] }));
  assert.equal(s.agents.get('a').fish, 12);
  applyDelta(s, delta(102, 103, { agentPatches: [{ id: 'a', set: { inventory: { ore: 1 } } }] }));
  assert.equal(s.agents.get('a').fish, 0);
});

test('feed: matcha follows the inventory too', () => {
  const b = snap(); b.dynamicWorld.agents[0].inventory = { matcha_smoothie: 3 };
  const s = fromSnapshot(b);
  assert.equal(s.agents.get('a').matcha, 3);
  applyDelta(s, delta(100, 101, { agentPatches: [{ id: 'a', merge: { inventory: { matcha_smoothie: 1 } } }] }));
  assert.equal(s.agents.get('a').matcha, 1);
});

test('feed: an old message is stale, a skipped one is a gap', () => {
  const s = fromSnapshot(snap());
  assert.equal(applyDelta(s, delta(99, 100, {})), 'stale');
  assert.equal(applyDelta(s, delta(102, 103, {})), 'gap');
  assert.equal(s.seq, 100);
});

test('feed: a batch overlapping what we already have is a gap, not a re-apply', () => {
  const s = fromSnapshot(snap());
  assert.equal(applyDelta(s, delta(100, 101, {})), 'applied');
  assert.equal(applyDelta(s, delta(100, 102, {})), 'gap');
});

test('feed: drift counts the agents that disagree', () => {
  const a = fromSnapshot(snap()), b = clone(a);
  assert.equal(drift(a, b, 'central'), 0);
  applyDelta(b, delta(100, 101, { agentPatches: [{ id: 'a', merge: { position: { x: 3 } } }], removedAgentIds: ['b'] }));
  assert.equal(drift(a, b, 'central'), 2);
});

// ---- Season 3: smell, newcomers, shared places ----------------------------------------------
const s3 = { ...rules, smell: file.smell, newcomer: file.newcomer };
const beside = (tiles, dx) => (sec, s) => { const p = at(s - tiles); return { ...p, x: p.x + dx }; };

test('smell: a short shared tile is nothing; a long one makes both smelly, and the nose finds them', () => {
  // Two on one tile 5 behind (inside the 6-tile nose), for the whole run.
  const twins = byId(judge(s3, run({ a: behind(5), b: behind(5) })));
  assert.equal(twins.a.status, 'caught'); assert.equal(twins.b.status, 'caught');
  assert.ok(twins.a.smellySeconds > 0);
  // The same two, a tile apart: never smelly, and a 5-tile tail at the side isn't seen.
  const apart = byId(judge(s3, run({ a: behind(5), b: beside(5, 1) })));
  assert.equal(apart.a.smellySeconds, undefined);
  assert.notEqual(apart.a.status, 'caught');
  // Sharing for less than afterSeconds, then apart: never smelly.
  const brief = byId(judge(s3, run({ a: behind(5), b: (sec, s) => (sec < 30 ? at(s - 5) : beside(5, 1)(sec, s)) })));
  assert.equal(brief.a.smellySeconds, undefined);
});

test('smell: the nose reaches noseDistance only; beyond it, a smelly pair is not smelled', () => {
  // 8 tiles back along the route: further than the nose in a straight line except where the route
  // turns. Behind the dog, so only the nose can see them: every row seen is smelly and within it.
  const far = byId(judge(s3, run({ a: behind(8), b: behind(8) }, { seconds: 300 })));
  const rows = far.a.trace;
  assert.ok(rows.some((r) => r[5] === 1), 'smelly at some point');
  for (const [sec, d, seen, , , smelly] of rows) {
    if (seen) assert.ok(smelly === 1 && d <= file.smell.noseDistance, `seen at ${sec}s only by the nose (d ${d})`);
    if (smelly && d > file.smell.noseDistance) assert.equal(seen, 0, `beyond the nose at ${sec}s`);
  }
});

test('smell lingers lingerSeconds after the pair parts', () => {
  // Together for afterSeconds + 20 (judged seconds), then a tile apart; 9 back, so rarely smelled.
  const togetherFor = file.smell.afterSeconds + 20;
  const r = judge(s3, run({ a: behind(9), b: (sec, s) => (sec < 30 + togetherFor ? at(s - 9) : beside(9, 1)(sec, s)) }, { seconds: 200 }));
  const tr = byId(r).a.trace;
  const smellyRows = tr.filter((row) => row[5] === 1).map((row) => row[0]);
  assert.ok(smellyRows.length, 'smelly');
  // The last smelly second is lingerSeconds (±1 for whole seconds) after the last together second.
  const lastSmelly = smellyRows.at(-1);
  const startMs = Date.parse(r.startedAt), lastTogetherSec = (T0 + (30 + togetherFor) * 1000 - startMs) / 1000;
  assert.ok(Math.abs(lastSmelly - (lastTogetherSec + file.smell.lingerSeconds)) <= 1.5, `last smelly ${lastSmelly}s, parted ${lastTogetherSec}s`);
});

test('newcomer: suspicion builds at half speed within `within` tiles, full speed further out or when smelly', () => {
  // 2.5 tiles behind: inside minDistance (3), so seen every reading.
  const plain = byId(judge(s3, run({ n: behind(2.5) }, { seconds: 120 })));
  const fresh = byId(judge(s3, run({ n: behind(2.5) }, { seconds: 120 }), { newcomers: new Set(['n']) }));
  assert.equal(plain.n.status, 'caught'); assert.equal(fresh.n.status, 'caught');
  assert.ok(fresh.n.lastedSeconds > plain.n.lastedSeconds, `a newcomer lasts longer (${fresh.n.lastedSeconds} > ${plain.n.lastedSeconds})`);
  assert.equal(fresh.n.newcomer, true);
});

test('newcomer: worked out from the veterans list and the season\'s runs; written in the run file wins', () => {
  const key = (id) => `k:${id}`;
  const vets = { 'k:old': 5, 'k:two': 2 };
  const season = [{ result: { players: [{ id: 'two' }, { id: 'once' }] } }];
  const nc = newcomersFor(s3, vets, season, ['old', 'two', 'once', 'brand'], key);
  assert.deepEqual([...nc].sort(), ['brand', 'once']); // two: 2 before + 1 this season = 3, not new
  const r = run({ n: behind(2.5) }, { seconds: 120 }); r.newcomers = ['n'];
  assert.equal(byId(judge(s3, r)).n.newcomer, true);
});

test('places: a true tie shares a place; the next player takes the place after both', () => {
  // x and y on one tile all run (smell off here): exactly equal, a forced true tie. z further back.
  const r = judge({ ...s3, smell: undefined }, run({ x: behind(6), y: behind(6), z: behind(9) }, { seconds: 700 }));
  const p = byId(r);
  assert.equal(p.x.meanTail, p.y.meanTail); assert.equal(p.x.seenSeconds, p.y.seenSeconds);
  assert.equal(p.x.status, 'tailed to the end');
  assert.equal(p.x.place, 1); assert.equal(p.y.place, 1);
  assert.equal(p.z.place, p.z.status === 'tailed to the end' ? 3 : p.z.place);
  assert.ok(r.players.every((q, i) => q.place <= i + 1));
});

// ---- Season 4: fish ring, back glance, pace matching ---------------------------------------------
test('fish ring: net fish level widens the any-side ring, matcha cancels it, capped', () => {
  const ring = (fish, matcha) => senses(file, { fish, matcha }).ring;
  assert.equal(ring(0, 0), file.spot.minDistance);
  assert.equal(ring(1, 0), file.spot.minDistance + 1);          // fish level 1
  assert.equal(ring(500, 0), file.spot.minDistance + 2);        // level 2
  assert.equal(ring(50000, 0), Math.min(file.spot.fish.maxRing, file.spot.minDistance + 3));
  assert.equal(ring(500, 2), file.spot.minDistance + 1);        // 2 - 1
  assert.equal(ring(500, 10), file.spot.minDistance);           // even
  assert.equal(ring(0, 500), file.spot.minDistance);            // matcha never shrinks it
});

test('back glance: the beacon round decides it; the chance grows with the crowd, capped; cue, looking, nothing', () => {
  const G = file.glance, B = G.beacon;
  assert.equal(glanceChance(G, 0), 0);
  assert.ok(glanceChance(G, 2) > glanceChance(G, 1));
  assert.equal(glanceChance(G, 50), glanceChance(G, Math.ceil(G.maxPerSecond / G.perAgentPerSecond)));
  // A randomness just under / over the chance for one agent nearby.
  const c1 = glanceChance(G, 1), hex13 = (f) => Math.floor(f * 2 ** 52).toString(16).padStart(13, '0') + '0'.repeat(51);
  assert.equal(glanceBegins(G, hex13(c1 * 0.99), 1), true);
  assert.equal(glanceBegins(G, hex13(Math.min(0.999, c1 * 1.01)), 1), false);
  assert.equal(glanceBegins(G, hex13(c1 * 0.99), 0), false, 'no one near: no glance');
  assert.equal(glanceBegins(G, 'not a beacon', 5), false);
  const r = roundAt(B, Date.parse('2026-11-25T22:00:00Z'));
  assert.ok(roundTime(B, r) <= Date.parse('2026-11-25T22:00:00Z') && Date.parse('2026-11-25T22:00:00Z') < roundTime(B, r + 1));
  const t = 1_000_000;
  assert.equal(glanceState(G, [t], t), 'cue');
  assert.equal(glanceState(G, [t], t + G.cueSeconds * 1000), 'looking');
  assert.equal(glanceState(G, [t], t + (G.cueSeconds + G.seconds) * 1000 + 1), null);
});

// A beacon that begins a glance every round (randomness 0), for the synthetic runs.
const allRounds = (r) => { const B = file.glance.beacon, out = {}; const a = roundAt(B, Date.parse(r.readings[0].t)), b = roundAt(B, Date.parse(r.readings.at(-1).t)); for (let k = a; k <= b; k++) out[k] = '0'.repeat(64); return { ...r, beacon: out }; };

test('back glance: newcomers are ignored by it', () => {
  const g = { ...rules, pace: undefined };
  const r = allRounds(run({ n: behind(3.6) }, { seconds: 700 }));
  const vet = byId(judge(g, r)), fresh = byId(judge(g, r, { newcomers: new Set(['n']) }));
  assert.ok(vet.n.glancedSeconds > 0);
  assert.equal(fresh.n.glancedSeconds, undefined);
});

test('back glance (a glance every round): a too-close follower is caught; one at the ideal distance still finishes', () => {
  // Behind along the route: on the straights 3.6 is inside the 4-tile glance and 5 is outside; at the
  // corners the straight-line distance shrinks, so the ideal follower can be glanced at there too.
  const g = { ...rules, pace: undefined };
  const close = byId(judge(g, allRounds(run({ c: behind(3.6) }, { seconds: 700 }))));
  const ideal = byId(judge(g, allRounds(run({ i: behind(5) }, { seconds: 700 }))));
  assert.equal(close.c.status, 'caught');
  assert.equal(ideal.i.status, 'tailed to the end');
});

// A straight street: the dog steps one tile east a reading (two a second).
function street(players, readingsN = 60) {
  const out = [];
  for (let k = 0; k < readingsN; k++) {
    const pup = { spaceId: 'central', x: 30 + k, y: 40 };
    const agents = {};
    for (const [id, f] of Object.entries(players)) agents[id] = { name: id, spaceId: 'central', ...f(k) };
    out.push({ t: iso(k * STEP), seq: 1000 + k, pup, agents });
  }
  return out;
}
test('pace matching: in step within its distance for its seconds is heard; further back is not; a shared pause keeps the count', () => {
  const pr = { ...rules, glance: undefined };
  const near = (k) => ({ x: 30 + k - 4, y: 40 }), far = (k) => ({ x: 30 + k - 6, y: 40 });
  const { sessions, open } = practice({ ...pr, practice: { startSeconds: 0 } }, street({ near, far }, 60));
  const by = Object.fromEntries([...sessions, ...open].map((o) => [o.id, o]));
  assert.ok(by.near.heardSeconds > 0, 'heard in step at 4 tiles');
  assert.equal(by.far?.heardSeconds, undefined, 'not at 6 tiles');
});

test('beacon: a real drand quicknet round verifies; a changed round, randomness or signature does not', () => {
  const B = file.glance.beacon, r = 34252929, rand = '7da2d90b5b0a8600ddb520f09ecb1e02e6737d07c8ae21ce556afe8a9fff9144', sig = 'aa785d46c7940d279566f2eec0cf18e61b7b4495e321567f7a860a4f92eacdb026a594b34047e057a54ac126abbbb292';
  assert.equal(verifyRound(B, r, rand, sig), true);
  assert.equal(verifyRound(B, r + 1, rand, sig), false, 'another round');
  assert.equal(verifyRound(B, r, rand.replace(/^./, (c) => (c === '0' ? '1' : '0')), sig), false, 'randomness not from the signature');
  assert.equal(verifyRound(B, r, rand, sig.replace(/.$/, (c) => (c === '0' ? '1' : '0'))), false, 'a changed signature');
  assert.equal(verifyRound(B, r, rand, undefined), false);
});

test('newcomers: a run lost or caught within quickExitSeconds does not count', () => {
  const NC = file.newcomer;
  assert.equal(countsAsRun(NC, { status: 'lost', lastedSeconds: NC.quickExitSeconds - 1 }), false);
  assert.equal(countsAsRun(NC, { status: 'caught', lastedSeconds: 3 }), false);
  assert.equal(countsAsRun(NC, { status: 'caught', lastedSeconds: NC.quickExitSeconds }), true);
  assert.equal(countsAsRun(NC, { status: 'tailed to the end', lastedSeconds: 30 }), true);
  const run = (status, lastedSeconds) => ({ result: { players: [{ id: 'q', status, lastedSeconds }] } });
  const quick = [run('lost', 10), run('caught', 20), run('lost', 59), run('lost', 5)];
  assert.deepEqual([...newcomersFor(file, {}, quick, ['q'], (id) => id)], ['q'], 'four quick exits: still new');
  const real = [run('lost', 61), run('caught', 300), run('tailed to the end', 560)];
  assert.deepEqual([...newcomersFor(file, {}, real, ['q'], (id) => id)], [], 'three real runs: a veteran');
});

test('beacon: a run file is complete only with every round from its first reading to its last, verified', () => {
  const B = file.glance.beacon, r = 34252929;
  const at = (k) => new Date((B.genesis + (k - 1) * B.period) * 1000 + 500).toISOString();
  const run = { readings: [{ t: at(r) }, { t: at(r) }] };
  assert.deepEqual(neededRounds(B, run), [r]);
  assert.deepEqual(beaconGaps(B, run), [r], 'missing');
  run.beacon = { [r]: '7da2d90b5b0a8600ddb520f09ecb1e02e6737d07c8ae21ce556afe8a9fff9144' };
  assert.deepEqual(beaconGaps(B, run), [r], 'no signature');
  run.beaconSignatures = { [r]: 'aa785d46c7940d279566f2eec0cf18e61b7b4495e321567f7a860a4f92eacdb026a594b34047e057a54ac126abbbb292' };
  assert.deepEqual(beaconGaps(B, run), []);
  run.readings.push({ t: at(r + 1) });
  assert.deepEqual(beaconGaps(B, run), [r + 1], 'a later round missing');
});

test('beacon: the key comes from the sealed rules; a run file naming another beacon is refused', () => {
  assert.equal(trustedBeacon(file, { readings: [] }), file.glance.beacon);
  assert.equal(trustedBeacon(file, { rules: file }), file.glance.beacon);
  const forged = { ...file, glance: { ...file.glance, beacon: { ...file.glance.beacon, publicKey: 'ab'.repeat(96) } } };
  assert.throws(() => trustedBeacon(file, { rules: forged }), /different beacon/);
  assert.throws(() => trustedBeacon(file, { rules: { ...file, glance: undefined } }), /different beacon/);
});

test('beacon: a run file with bad reading times is refused, not passed with no rounds; out of order is fine', () => {
  const B = file.glance.beacon;
  assert.throws(() => beaconGaps(B, { readings: [{ t: 'nonsense' }, { t: 'nonsense' }] }), /bad time/);
  assert.throws(() => beaconGaps(B, { readings: [{ t: '2026-11-25T22:00:00Z' }, {}] }), /bad time/);
  // Out of order (a reconnect): the range still spans earliest to latest.
  const at = (k) => new Date((B.genesis + (k - 1) * B.period) * 1000 + 500).toISOString();
  assert.deepEqual(neededRounds(B, { readings: [{ t: at(10) }, { t: at(12) }, { t: at(9) }] }), [9, 10, 11, 12]);
});
