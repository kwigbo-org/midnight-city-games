// The sponsor's banner upload (games server, behind Caddy at /api/banner): the top bidder sends the
// image its bid named, and it shows on the site at once (the auction shows who's winning with it). The
// operator takes down any that breaks the rules: `banner-v3.mjs reject` (the image leaves the site).
//   node banner-upload.mjs <web data dir> [port]       listens on 127.0.0.1 only (default 8787)
// POST /api/banner?run=<run id>, the image as the body (PNG, JPEG or WebP; at most 300 KB). Accepted
// only if its SHA-256 is the banner of that run's top bid on the pot contract right now (so only the
// top bidder can upload, and only that file), it is exactly 1200 x 200, and the run isn't settled.
// One banner per run: an accepted upload replaces that run's earlier one, and the banner of a run that
// has a new top bid (outbid) leaves the site. Shown images are <web data dir>/banners/<hash>.<ext>.
// A sender gets 40 tries per 10 minutes.
// Early: the sponsor page sends the image the moment the wallet submits, usually before the chain shows
// the bid (403). Such an image is held here (in memory, for 10 minutes; at most 3 per sender and 20 in
// all) and tried again every 15 s, so it goes up once the bid lands even if the sender's page has closed.
// When it's full, the sender holding the most loses its oldest: one sender can't push others out.
import './pot-version.mjs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The contract (v3 or v4) comes from the deployment file: pot-version.mjs, imported above.
const { ledgerNow } = await import('./pot.mjs');
const v3 = await import('./pot-v3.mjs');
const { imageInfo, bannerProblem, MAX_BYTES } = await import('./banner-v3.mjs');

const web = process.argv[2];
const port = Number(process.argv[3] ?? 8787);
if (!web) { console.log('usage: node banner-upload.mjs <web data dir> [port]'); process.exit(1); }
const PENDING = fileURLToPath(new URL('./banners-pending/', import.meta.url));
const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$/;
const FILE = /^[0-9a-f]{64}\.(png|jpg|webp)$/;

// 40 tries per sender per 10 minutes (an upload's own retries take 8). The sender is X-Real-IP, which Caddy sets to the connecting
// address (replacing anything a client sent); this listens on loopback only, so only Caddy reaches it.
const tries = new Map();
function allowed(ip) {
  const now = Date.now();
  const recent = (tries.get(ip) ?? []).filter((t) => now - t < 600_000);
  if (recent.length >= 40) { tries.set(ip, recent); return false; }
  recent.push(now);
  tries.set(ip, recent);
  if (tries.size > 5000) for (const [k, v] of tries) if (!v.some((t) => now - t < 600_000)) tries.delete(k);
  return true;
}

// The banner record (banners.json) is shared with banner-v3.mjs: the same lock directory, waited for
// as long as that tool may hold it (a fetch takes up to ~20 s). A lock left by a crash (older than two
// minutes) is cleared.
class Busy extends Error {}
async function withLock(f) {
  const lock = `${web}/.banners.lock`;
  for (let i = 0; ; i++) {
    try { mkdirSync(lock); break; } catch {
      // A stale lock is moved aside atomically first: of two waiters only one can take it, so neither
      // deletes a fresh lock the other has just made.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 120_000) {
          const aside = `${lock}.stale-${process.pid}-${Date.now()}`;
          renameSync(lock, aside);
          rmSync(aside, { recursive: true, force: true });
          continue;
        }
      } catch { /* gone, or another waiter moved it: try again */ }
      if (i >= 120) throw new Busy('busy');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  try { return await f(); } finally { rmSync(lock, { recursive: true, force: true }); }
}
const readRefused = () => { try { return JSON.parse(readFileSync(`${web}/refused-sponsors.json`, 'utf8')); } catch (e) { if (e?.code === 'ENOENT') return {}; throw e; } };
// A missing record is empty; an unreadable one fails the request (never overwritten as if empty).
const readState = () => {
  try { return JSON.parse(readFileSync(`${web}/banners.json`, 'utf8')); } catch (e) { if (e?.code === 'ENOENT') return {}; throw e; }
};
const saveState = (s) => { writeFileSync(`${web}/banners.json.tmp`, `${JSON.stringify(s, null, 1)}\n`); renameSync(`${web}/banners.json.tmp`, `${web}/banners.json`); };
// A file is named by its content, so two runs can share one: it goes only when no run still uses it.
const drop = (file, state) => {
  if (!file || !FILE.test(file) || Object.values(state).some((s) => s.status === 'pending' && s.pending === file)) return;
  if (existsSync(`${PENDING}${file}`)) unlinkSync(`${PENDING}${file}`);
};
const unshow = (file, state) => {
  const name = String(file ?? '').replace(/^banners\//, '');
  if (!FILE.test(name) || Object.values(state).some((s) => s.status === 'approved' && s.file === `banners/${name}`)) return;
  if (existsSync(`${web}/banners/${name}`)) unlinkSync(`${web}/banners/${name}`);
};

async function accept(runId, body) {
  const hash = createHash('sha256').update(body).digest('hex');
  const problem = bannerProblem(body, hash); // type, 1200 x 200, size (the hash is the body's own)
  if (problem) return [400, { error: `the banner won't do: ${problem}` }];
  const dep = v3.deploymentV3();
  if (!dep) return [503, { error: 'no pot right now' }];
  const { pureCircuits } = await v3.loadContract();
  const file = `${hash}.${imageInfo(body).type}`;
  // The chain is read inside the lock, with the record: what's checked is what's written.
  return withLock(async () => {
    const l = await ledgerNow(dep.address);
    if (!l) return [503, { error: 'the pot is unreachable right now; try again in a minute' }];
    const topOf = (r) => (l.runs.member(r) && l.bids.member(r) && l.bids.lookup(r) > 0n && l.banner.member(r) ? v3.hex(l.banner.lookup(r)) : null);
    const race = v3.sha(runId);
    if (!l.runs.member(race)) return [404, { error: 'no such run' }];
    if (l.settled.member(pureCircuits.runKey(race))) return [409, { error: 'that run is over' }];
    if (topOf(race) !== hash) return [403, { error: "this isn't the banner of the run's top bid (bid first, with this image; if you were outbid, it's theirs now)" }];
    // A sponsor whose banner was taken down is refused: no banner from that wallet.
    const wallet = l.topWallet.member(race) ? v3.hex(l.topWallet.lookup(race)) : null;
    if (wallet && readRefused()[wallet]) return [409, { error: "this wallet can't sponsor runs" }];
    const state = readState();
    const before = state[runId];
    if (before?.hash === hash && before.status === 'approved') return [200, { status: 'approved' }];
    if (before?.hash === hash && before.status === 'rejected') return [409, { error: 'this banner was not approved for the run' }];
    // One banner per run: an outbid run's banner leaves (held or shown; settled runs keep theirs);
    // so does this run's earlier upload.
    for (const [id, s] of Object.entries(state)) {
      if (id === runId || !['pending', 'approved'].includes(s.status) || !RUN_ID.test(id) || topOf(v3.sha(id)) === s.hash) continue;
      if (l.settled.member(pureCircuits.runKey(v3.sha(id)))) continue;
      state[id] = { hash: s.hash, status: 'outbid', decidedAt: new Date().toISOString() };
      drop(s.pending, state); unshow(s.file, state);
    }
    if (before && before.hash !== hash && ['pending', 'approved'].includes(before.status)) {
      state[runId] = { ...before, status: 'replaced' };
      drop(before.pending, state); unshow(before.file, state);
    }
    mkdirSync(`${web}/banners`, { recursive: true });
    writeFileSync(`${web}/banners/${file}.tmp`, body);
    renameSync(`${web}/banners/${file}.tmp`, `${web}/banners/${file}`);
    state[runId] = { hash, wallet, status: 'approved', file: `banners/${file}`, via: 'upload', shownAt: new Date().toISOString() };
    saveState(state);
    // Anything held from before (the approval step's folder) that no run points at: removed.
    if (existsSync(PENDING)) for (const f of readdirSync(PENDING)) if (FILE.test(f)) drop(f, state);
    console.log(`${new Date().toISOString()} ${runId}: banner ${file} on the site`);
    return [200, { status: 'shown' }];
  });
}

const HOLD_MS = 600_000, HOLD_MAX = 20, HOLD_PER_SENDER = 3;
const held = new Map(); // `${run}:${sha256}` -> { runId, body, ip, until } (insertion order: oldest first)
function oldestOf(ip) { for (const [k, h] of held) if (h.ip === ip) return k; return null; }
function hold(runId, body, ip) {
  const key = `${runId}:${createHash('sha256').update(body).digest('hex')}`;
  if (held.has(key)) { held.get(key).until = Date.now() + HOLD_MS; return; }
  const count = new Map();
  for (const h of held.values()) count.set(h.ip, (count.get(h.ip) ?? 0) + 1);
  if ((count.get(ip) ?? 0) >= HOLD_PER_SENDER) held.delete(oldestOf(ip));
  else if (held.size >= HOLD_MAX) {
    const [most] = [...count].sort((a, b) => b[1] - a[1])[0];
    held.delete(oldestOf(most));
  }
  held.set(key, { runId, body, ip, until: Date.now() + HOLD_MS });
}
let retrying = false;
setInterval(async () => {
  if (retrying || !held.size) return;
  retrying = true;
  try {
    for (const [key, h] of [...held]) {
      if (Date.now() > h.until) { held.delete(key); console.log(`${new Date().toISOString()} ${h.runId}: a held banner expired (no bid with it reached the chain)`); continue; }
      try {
        const [code, obj] = await accept(h.runId, h.body);
        if (code === 200) { held.delete(key); console.log(`${new Date().toISOString()} ${h.runId}: a held banner went up (its bid reached the chain)`); }
        else if (code !== 403 && code !== 503 && code < 500) { held.delete(key); console.log(`${new Date().toISOString()} ${h.runId}: a held banner refused ${code}: ${obj.error ?? ''}`); }
      } catch { /* busy or unreachable: next round */ }
    }
  } finally { retrying = false; }
}, 15_000).unref();

const server = createServer((req, res) => {
  // The sender may be gone by the time an answer is ready (a long wait for the lock): then nothing is sent.
  const send = (code, obj) => {
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    try { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); } catch { /* gone */ }
  };
  const url = new URL(req.url, 'http://local');
  if (req.method !== 'POST' || url.pathname !== '/api/banner') return send(404, { error: 'not found' });
  const ip = String(req.headers['x-real-ip'] ?? req.socket.remoteAddress ?? '');
  if (!allowed(ip)) { console.log(`${new Date().toISOString()} upload refused 429: too many tries from one sender`); return send(429, { error: 'too many tries: wait a few minutes' }); }
  const runId = url.searchParams.get('run') ?? '';
  if (!RUN_ID.test(runId)) return send(400, { error: 'bad run id' });
  if (Number(req.headers['content-length'] ?? 0) > MAX_BYTES) return send(413, { error: `larger than ${MAX_BYTES / 1024} KB` });
  const chunks = []; let n = 0, over = false;
  req.on('error', () => { /* the sender went away */ });
  req.on('data', (c) => {
    if (over) return; // the rest is read and dropped (Caddy caps it), then 413 is sent whole
    n += c.length;
    if (n > MAX_BYTES) { over = true; chunks.length = 0; return; }
    chunks.push(c);
  });
  req.on('end', async () => {
    if (over) return send(413, { error: `larger than ${MAX_BYTES / 1024} KB` });
    // Every attempt is logged with its answer (no sender address), so a failed upload can be traced.
    try {
      const [code, obj] = await accept(runId, Buffer.concat(chunks));
      if (code !== 200) console.log(`${new Date().toISOString()} ${runId}: upload refused ${code}: ${obj.error ?? ''}`);
      // Not on the chain yet: held, and put up by this service once the bid lands.
      if (code === 403) { hold(runId, Buffer.concat(chunks), ip); return send(403, { ...obj, held: true }); }
      send(code, obj);
    }
    catch (e) {
      if (e instanceof Busy) return send(503, { error: 'busy right now; try again in a minute' });
      console.log(`${new Date().toISOString()} ${runId}: ${String(e?.message ?? e).slice(0, 200)}`); send(500, { error: 'it went wrong on our side; try again' });
    }
  });
  req.setTimeout(90_000, () => req.destroy()); // longer than the longest wait for the lock
});
server.listen(port, '127.0.0.1', () => console.log(`banner upload on 127.0.0.1:${port}, data ${web}`));
