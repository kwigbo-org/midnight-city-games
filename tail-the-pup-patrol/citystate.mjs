// The city as the public spectator feed describes it: one snapshot, then a delta every tick.
// Pure and shared: the recorder (Node) and the pages (browser) apply the feed the same way.
//
// Only what the game needs is kept: every NPC's position (the dog is an NPC, by name) and
// every agent's name and position, by the city's agent id.
//
//   const s = fromSnapshot(await (await fetch(`${OBSERVER}/api/spectator/bootstrap?space=central`)).json());
//   applyDelta(s, message)   // each message from wss://midnight.city/observer/ws?space=central&sequence=…

const pos = (p) => (p && typeof p.x === 'number' && typeof p.y === 'number'
  ? { spaceId: typeof p.spaceId === 'string' ? p.spaceId : null, x: p.x, y: p.y } : null);

const count = (n) => (typeof n === 'number' && n > 0 ? n : 0);
// Items the game reads: the inventory arrives whole (set) or as just the items that changed (merge).
function patchItem(cur, p, item) {
  if (p.set && 'inventory' in p.set) return count(p.set.inventory?.[item]);
  if (p.unset?.includes?.('inventory')) return 0;
  const m = p.merge?.inventory;
  return m && item in m ? count(m[item]) : cur;
}

export function fromSnapshot(b) {
  const w = b.dynamicWorld ?? {};
  const s = { seq: Number(b.sequence), tick: w.tick ?? null, timestamp: w.timestamp ?? null, npcs: new Map(), agents: new Map(), unknown: 0 };
  for (const n of w.npcs ?? []) if (typeof n.name === 'string') s.npcs.set(n.name, pos(n.position));
  for (const a of w.agents ?? []) if (typeof a.id === 'string') s.agents.set(a.id, { name: typeof a.name === 'string' ? a.name : null, position: pos(a.position), fish: count(a.inventory?.fish), matcha: count(a.inventory?.matcha_smoothie) });
  return s;
}

// position patches arrive as a partial merge ({x} only, say) or a full set.
function patchPosition(cur, p) {
  if (p.set && 'position' in p.set) return pos(p.set.position);
  if (p.unset?.includes?.('position')) return null;
  const m = p.merge?.position;
  if (!m) return cur;
  if (!cur) return pos(m);
  return { spaceId: typeof m.spaceId === 'string' ? m.spaceId : cur.spaceId, x: typeof m.x === 'number' ? m.x : cur.x, y: typeof m.y === 'number' ? m.y : cur.y };
}

// Apply one feed message. Returns 'applied', 'stale' (already have it) or 'gap' (a message is
// missing: the state is no longer trustworthy, take a new snapshot).
export function applyDelta(s, m) {
  if (m?.type !== 'spectator_delta' || !m.batch) return 'stale';
  const from = Number(m.fromSequence), to = Number(m.toSequence);
  if (to <= s.seq) return 'stale';
  if (from !== s.seq) return 'gap'; // strictly contiguous: one snapshot, then each delta in turn
  const b = m.batch;
  for (const p of b.npcPatches ?? []) {
    if (typeof p.name !== 'string') continue;
    s.npcs.set(p.name, patchPosition(s.npcs.get(p.name) ?? null, p));
  }
  for (const name of b.removedNpcNames ?? []) s.npcs.delete(name);
  for (const p of b.agentPatches ?? []) {
    if (typeof p.id !== 'string') continue;
    const cur = s.agents.get(p.id);
    const name = typeof p.set?.name === 'string' ? p.set.name : typeof p.merge?.name === 'string' ? p.merge.name : cur?.name ?? null;
    const position = patchPosition(cur?.position ?? null, p);
    // A patch for an agent we have never seen that doesn't say who or where it is: the
    // state is incomplete for that agent until the next snapshot.
    if (!cur && (!name || !position)) s.unknown++;
    s.agents.set(p.id, { name, position, fish: patchItem(cur?.fish ?? 0, p, 'fish'), matcha: patchItem(cur?.matcha ?? 0, p, 'matcha_smoothie') });
  }
  for (const id of b.removedAgentIds ?? []) s.agents.delete(id);
  s.seq = to;
  s.tick = b.tick ?? s.tick;
  s.timestamp = b.timestamp ?? b.generatedAt ?? s.timestamp;
  return 'applied';
}

// What a reading keeps: positions only, comparable between two states.
export function positions(s, spaceId) {
  const out = new Map();
  for (const [id, a] of s.agents) if (a.position && (!spaceId || a.position.spaceId === spaceId)) out.set(id, `${a.position.spaceId}:${a.position.x},${a.position.y}:${a.fish ?? 0}:${a.matcha ?? 0}`);
  return out;
}

// How far two states disagree: agents present in one only, or at different positions.
export function drift(a, b, spaceId) {
  const pa = positions(a, spaceId), pb = positions(b, spaceId);
  let n = 0;
  for (const [id, v] of pa) if (pb.get(id) !== v) n++;
  for (const id of pb.keys()) if (!pa.has(id)) n++;
  return n;
}

export function clone(s) {
  return { ...s, npcs: new Map(s.npcs), agents: new Map(s.agents) };
}
