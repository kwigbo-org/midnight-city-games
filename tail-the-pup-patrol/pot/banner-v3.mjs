// The sponsor banner for a run on the v3 pot. Uploaded banners (banner-upload.mjs, the usual way) show
// at once; the operator takes down any that breaks the rules with `reject`, which also takes the image
// off the site. Banners given by link (the older way) are fetched and wait for `approve`.
//   node banner-v3.mjs fetch <run id|auto> <web data dir>    after the auction closes: fetch, check, hold
//   node banner-v3.mjs approve <run id> <web data dir>        the operator's OK: the site shows it
//   node banner-v3.mjs reject <run id> <web data dir> [why]   the site shows "Sponsored by …" instead
//   node banner-v3.mjs list <web data dir>                     each run's banner and its status
//   node banner-v3.mjs allow <wallet hex> <web data dir>        lift a sponsor's refusal
// A banner taken down (reject) refuses its sponsor's wallet from then on (the operator's rule): it goes
// in <web data dir>/refused-sponsors.json, which the sponsor page, the upload and the site honour (the
// contract itself still takes any bid; a refused wallet's bid gets no banner and no name).
// fetch: the winning bid's link, https only, at most 300 KB; it must hash to the banner on chain, be
// PNG, JPEG or WebP, and be exactly 1200 × 200. A fetched image waits outside the site
// (banners-pending/, next to this file) until approved; approved: copied to
// <web data dir>/banners/<hash>.<ext>, where an uploaded one goes straight away.
// <web data dir>/banners.json says, per run: pending, approved (with its file), rejected or unusable.
import './pot-version.mjs';
import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// The contract (v3 or v4) comes from the deployment file: pot-version.mjs, imported above.
const { ledgerNow } = await import('./pot.mjs');
const v3 = await import('./pot-v3.mjs');

export const WIDTH = 1200, HEIGHT = 200, MAX_BYTES = 300 * 1024;
const PENDING = fileURLToPath(new URL('./banners-pending/', import.meta.url));

// The image's type and size from its own bytes (no image library): PNG, JPEG or WebP, else null.
export function imageInfo(b) {
  if (b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(m)) {
        return { type: 'jpg', height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { type: 'webp', width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') { const x = b.readUInt32LE(21); return { type: 'webp', width: (x & 0x3fff) + 1, height: ((x >>> 14) & 0x3fff) + 1 }; }
    if (chunk === 'VP8X') return { type: 'webp', width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  return null;
}

// Addresses the server must never be sent to on a stranger's say-so: loopback, private, link-local
// (the cloud metadata service), shared, documentation, benchmarking, multicast and other reserved
// ranges, IPv4 and IPv6 (with the IPv6 forms that embed an IPv4 address).
const BLOCKED = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]]) {
  BLOCKED.addSubnet(net, bits, 'ipv4');
}
// (Not ::/96 or ::ffff:0:0/96 here: the matcher applies those to every IPv4 address; the IPv4 inside
// such an IPv6 address is checked on its own below.)
for (const [net, bits] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) {
  BLOCKED.addSubnet(net, bits, 'ipv6');
}
export function privateAddress(ip) {
  const v = isIP(ip);
  if (v === 4) return BLOCKED.check(ip, 'ipv4');
  if (v === 6) {
    // An IPv4-mapped address (::ffff:a.b.c.d) is judged as its IPv4 address too.
    // An address embedding an IPv4 one (::ffff:a.b.c.d, ::a.b.c.d, or the same in hex) is judged by it.
    const low = ip.toLowerCase();
    const dotted = /^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(low);
    const hex = /^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(low);
    const v4 = dotted ? dotted[1] : hex ? [parseInt(hex[1], 16) >> 8, parseInt(hex[1], 16) & 255, parseInt(hex[2], 16) >> 8, parseInt(hex[2], 16) & 255].join('.') : null;
    return BLOCKED.check(ip, 'ipv6') || (v4 ? BLOCKED.check(v4, 'ipv4') : false);
  }
  return true;
}

// The address lookup for the banner fetch: done at connect time, by the connection itself, so the
// address checked is the address used (no second lookup a hostile DNS server could answer differently).
function publicLookup(hostname, options, callback) {
  dnsLookup(hostname, { all: true }, (err, addrs) => {
    if (err) return callback(err);
    const bad = addrs.find((a) => privateAddress(a.address));
    if (!addrs.length || bad) return callback(new Error('the link points at a private or reserved address'));
    const a = addrs[0];
    if (options?.all) return callback(null, [a]);
    return callback(null, a.address, a.family);
  });
}

// Fetch a sponsor's banner link with the server's safety first: https on the standard port only, no
// credentials, a public host (checked as it connects), no redirects, at most MAX_BYTES read, 20 s.
export function fetchBanner(link) {
  const u = new URL(link);
  if (u.protocol !== 'https:') return Promise.reject(new Error('the link is not https'));
  if (u.port && u.port !== '443') return Promise.reject(new Error('the link uses another port than 443'));
  if (u.username || u.password) return Promise.reject(new Error('the link carries credentials'));
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && privateAddress(host)) return Promise.reject(new Error('the link points at a private or reserved address'));
  return new Promise((resolve, reject) => {
    const req = httpsRequest({ host, servername: isIP(host) ? undefined : host, port: 443, path: `${u.pathname}${u.search}`, method: 'GET',
      lookup: publicLookup, headers: { 'user-agent': 'tail-the-pup-patrol banner check', accept: 'image/*' }, timeout: 20000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return reject(new Error(`the link redirects (${res.statusCode}): give the image's own address`)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`the link answered ${res.statusCode}`)); }
      if (Number(res.headers['content-length'] ?? 0) > MAX_BYTES) { res.destroy(); return reject(new Error(`larger than ${MAX_BYTES / 1024} KB`)); }
      const chunks = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > MAX_BYTES) { res.destroy(); req.destroy(); reject(new Error(`larger than ${MAX_BYTES / 1024} KB`)); } else chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('the link took too long')));
    req.on('error', reject);
    req.end();
  });
}

// Whether an image file is a usable banner: the reason it isn't, or null.
export function bannerProblem(b, wantHash) {
  if (b.length > MAX_BYTES) return `larger than ${MAX_BYTES / 1024} KB`;
  if (createHash('sha256').update(b).digest('hex') !== wantHash) return "it doesn't match the banner the bid named (its hash differs)";
  const info = imageInfo(b);
  if (!info) return 'not a PNG, JPEG or WebP image';
  if (info.width !== WIDTH || info.height !== HEIGHT) return `${info.width} × ${info.height}: a banner is ${WIDTH} × ${HEIGHT}`;
  return null;
}

async function main() {
  const [cmd, runArg, dataDir, ...rest] = process.argv.slice(2);
  const web = cmd === 'list' ? runArg : dataDir;
  if (!['fetch', 'approve', 'reject', 'list', 'allow'].includes(cmd) || !web) {
    console.log('usage: node banner-v3.mjs fetch <run id|auto> <web data dir> | approve <run id> <web data dir> | reject <run id> <web data dir> [why] | list <web data dir> | allow <wallet hex> <web data dir>');
    process.exit(1);
  }
  // One banner command at a time (the 21:01 and 21:31 jobs, the operator's approve): a lock directory.
  const lock = `${web}/.banners.lock`;
  for (let i = 0; ; i++) {
    try { mkdirSync(lock); break; } catch { if (i >= 60) { console.log(`busy: ${lock} (remove it if no banner command is running)`); process.exit(1); } await new Promise((r) => setTimeout(r, 1000)); }
  }
  process.on('exit', () => { try { rmSync(lock, { recursive: true, force: true }); } catch { /* gone */ } });
  const stateFile = `${web}/banners.json`;
  let state = {};
  try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { state = {}; }
  const save = () => { writeFileSync(`${stateFile}.tmp`, `${JSON.stringify(state, null, 1)}\n`); renameSync(`${stateFile}.tmp`, stateFile); };
  if (cmd === 'list') { for (const [id, s] of Object.entries(state)) console.log(id, s.status, s.hash?.slice(0, 12) ?? '', s.reason ?? ''); return; }
  // Refused sponsors (under the same lock).
  const refusedFile = `${web}/refused-sponsors.json`;
  let refused = {};
  try { refused = JSON.parse(readFileSync(refusedFile, 'utf8')); } catch (e) { if (e?.code !== 'ENOENT') { console.log(`can't read ${refusedFile}: fix it first`); process.exit(1); } }
  const saveRefused = () => { writeFileSync(`${refusedFile}.tmp`, `${JSON.stringify(refused, null, 1)}\n`); renameSync(`${refusedFile}.tmp`, refusedFile); };
  if (cmd === 'allow') {
    const w = String(runArg ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(w)) { console.log('allow <wallet hex (64)> <web data dir>'); process.exit(1); }
    if (!refused[w]) { console.log(`${w.slice(0, 12)}…: not refused`); return; }
    delete refused[w];
    saveRefused();
    console.log(`${w.slice(0, 12)}…: may sponsor again`);
    return;
  }

  const runId = runArg === 'auto' ? v3.runsOn(new Date().toISOString().slice(0, 10))[0]?.id : runArg;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$/.test(runId ?? '')) { console.log('bad run id'); process.exit(1); }
  const dep = v3.deploymentV3();
  if (!dep) { console.log('no v3 pot'); process.exit(1); }
  const l = await ledgerNow(dep.address);
  const r = v3.sha(runId);
  if (!l.runs.member(r)) { console.log(`no run ${runId} on this pot`); process.exit(1); }
  if (!(l.bids.member(r) && l.bids.lookup(r) > 0n)) { console.log(`${runId}: no sponsor, no banner`); return; }
  const hash = v3.hex(l.banner.lookup(r));
  const link = v3.linkText(l.bannerLink.lookup(r));

  if (cmd === 'fetch') {
    const closes = Number(l.closeAt.lookup(r)) * 1000;
    if (Date.now() < closes) { console.log(`${runId}: the auction is still open (closes ${new Date(closes).toISOString()})`); process.exit(1); }
    if (state[runId]?.hash === hash && ['pending', 'approved', 'rejected'].includes(state[runId].status)) { console.log(`${runId}: already ${state[runId].status}`); return; }
    let problem = null, body = null;
    try {
      if (!link) throw new Error('no banner was uploaded, and the bid has no link');
      body = await fetchBanner(link);
      problem = bannerProblem(body, hash);
    } catch (e) { problem = String(e?.message ?? e).slice(0, 200); }
    if (problem) {
      state[runId] = { hash, link, status: 'unusable', reason: problem, checkedAt: new Date().toISOString() };
      save();
      console.log(`${runId}: unusable banner (${problem}): the site shows "Sponsored by …"`);
      return;
    }
    mkdirSync(PENDING, { recursive: true });
    const file = `${hash}.${imageInfo(body).type}`;
    writeFileSync(`${PENDING}${file}`, body);
    const wallet = l.topWallet.member(r) ? v3.hex(l.topWallet.lookup(r)) : null;
    state[runId] = { hash, wallet, link, status: 'pending', pending: file, checkedAt: new Date().toISOString() };
    save();
    console.log(`${runId}: banner ${file} checked, waiting for approval: node banner-v3.mjs approve ${runId} ${web}`);
    return;
  }
  const s = state[runId];
  if (!s || s.hash !== hash) { console.log(`${runId}: no fetched banner for the winning bid (run fetch first)`); process.exit(1); }
  if (s.pending !== undefined && !/^[0-9a-f]{64}\.(png|jpg|webp)$/.test(s.pending)) { console.log(`${runId}: bad file name in banners.json`); process.exit(1); }
  if (cmd === 'approve') {
    if (s.status === 'unusable') { console.log(`${runId}: unusable (${s.reason}): nothing to approve`); process.exit(1); }
    if (!existsSync(`${PENDING}${s.pending}`)) { console.log(`${runId}: the checked image is gone; fetch again`); process.exit(1); }
    mkdirSync(`${web}/banners`, { recursive: true });
    copyFileSync(`${PENDING}${s.pending}`, `${web}/banners/${s.pending}`);
    state[runId] = { ...s, status: 'approved', file: `banners/${s.pending}`, decidedAt: new Date().toISOString() };
    save();
    console.log(`${runId}: approved, on the site`);
  } else {
    state[runId] = { hash: s.hash, wallet: s.wallet ?? null, link: s.link, status: 'rejected', reason: rest.join(' ') || 'not approved', decidedAt: new Date().toISOString() };
    save();
    // Shown already (an upload shows at once): it leaves the site, unless another run still shows it.
    const shown = /^banners\/[0-9a-f]{64}\.(png|jpg|webp)$/.test(s.file ?? '') ? s.file : null;
    if (shown && !Object.values(state).some((x) => x.status === 'approved' && x.file === shown) && existsSync(`${web}/${shown}`)) unlinkSync(`${web}/${shown}`);
    // Its sponsor is refused from now on: the wallet whose bid the banner came with (recorded when it was
    // uploaded or fetched), else the run's top bidder now (whose bid names this same banner).
    // (reject only acts on the banner of the run's top bid: the hash was checked above.)
    const wallet = s.wallet ?? (s.hash === hash && l.topWallet.member(r) ? v3.hex(l.topWallet.lookup(r)) : null);
    if (wallet && !refused[wallet]) { refused[wallet] = { since: new Date().toISOString(), run: runId, reason: rest.join(' ') || 'banner taken down' }; saveRefused(); }
    console.log(`${runId}: rejected: the banner is off the site; its sponsor (wallet ${wallet?.slice(0, 12) ?? '?'}…) is refused from now on`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main().then(() => process.exit(0), (e) => { console.log(String(e?.message ?? e)); process.exit(1); });
