// The live city feed, every tick: the public spectator snapshot, then the public spectator
// socket the city's own viewer uses (wss://midnight.city/observer/ws). No account, no key.
//
//   const feed = new CityFeed({ space: 'central' });
//   feed.on('reading', (r) => …);   // after each tick: { t, seq, tick, state }
//   feed.on('health', (h) => …);    // resyncs, drift, gaps, reconnects
//   feed.start();
//
// Checks on the state it builds:
// - a missing message (a gap in the sequence) means a fresh snapshot, never a guess;
// - every `resyncSeconds` it takes a fresh snapshot and compares it with its own state at the
//   same sequence. Any difference is counted as drift and the snapshot wins (the ticks since
//   are replayed on top of it).
//
// The socket client is a small one of our own over TLS, without compression: Node's built-in
// WebSocket decodes only the first of the city's compressed frames (the rest come out empty).
import tls from 'node:tls';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { fromSnapshot, applyDelta, clone, drift } from './citystate.mjs';

export const HOST = 'midnight.city';
export const OBSERVER = `https://${HOST}/observer`;

export class CityFeed extends EventEmitter {
  constructor({ space = 'central', resyncSeconds = 60, idleSeconds = 10, log = () => {} } = {}) {
    super();
    Object.assign(this, { space, resyncSeconds, idleSeconds, log });
    this.state = null;
    this.health = { since: new Date().toISOString(), ticks: 0, resyncs: 0, driftChecks: 0, driftAgents: 0, gaps: 0, reconnects: 0, lastError: null };
    this.recent = [];      // the last few raw messages, to replay on top of a snapshot
    this.history = new Map(); // seq -> state, the last few ticks, for drift checks
    this.sock = null;
    this.stopped = false;
  }

  async snapshot() {
    const r = await fetch(`${OBSERVER}/api/spectator/bootstrap?space=${encodeURIComponent(this.space)}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`observer answered ${r.status}`);
    const b = await r.json();
    return { b, s: fromSnapshot(b) };
  }

  start() { this.stopped = false; this.connect(0); this.resyncTimer = setInterval(() => this.resync().catch((e) => this.fail(e)), this.resyncSeconds * 1000); }
  stop() { this.stopped = true; clearInterval(this.resyncTimer); clearTimeout(this.idleTimer); this.sock?.destroy(); }
  fail(e) { this.health.lastError = `${new Date().toISOString()} ${String(e?.message ?? e).slice(0, 120)}`; this.log(this.health.lastError); this.emit('health', this.health); }

  async connect(attempt) {
    if (this.stopped) return;
    this.sock?.destroy();
    try {
      const { b, s } = await this.snapshot();
      this.state = s; this.recent = []; this.history.clear(); this.pending = null;
      this.staticVersion = b.staticVersion;
      this.open();
    } catch (e) {
      this.fail(e);
      setTimeout(() => this.connect(attempt + 1), Math.min(30000, 1000 * 2 ** attempt));
    }
  }

  reconnect(why) {
    if (this.stopped) return;
    this.health.reconnects++;
    this.fail(new Error(`reconnecting: ${why}`));
    this.sock?.destroy(); this.sock = null;
    setTimeout(() => this.connect(0), 1000);
  }

  open() {
    const path = `/observer/ws?staticVersion=${encodeURIComponent(this.staticVersion)}&sequence=${this.state.seq}&space=${encodeURIComponent(this.space)}`;
    const sock = tls.connect(443, HOST, { servername: HOST });
    this.sock = sock;
    let buf = Buffer.alloc(0), upgraded = false, frag = [];
    const idle = () => { clearTimeout(this.idleTimer); this.idleTimer = setTimeout(() => this.reconnect('no message for a while'), this.idleSeconds * 1000); };
    sock.on('secureConnect', () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: ${HOST}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n`
        + `Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${crypto.randomBytes(16).toString('base64')}\r\nUser-Agent: tail-the-pup-patrol recorder\r\n\r\n`);
      idle();
    });
    sock.on('error', (e) => { if (this.sock === sock) this.reconnect(e.message); });
    sock.on('close', () => { if (this.sock === sock) this.reconnect('socket closed'); });
    sock.on('data', (d) => {
      if (this.sock !== sock) return;
      buf = Buffer.concat([buf, d]);
      if (!upgraded) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const head = buf.subarray(0, i).toString();
        if (!/^HTTP\/1\.1 101/.test(head)) return this.reconnect(head.split('\r\n')[0]);
        upgraded = true; buf = buf.subarray(i + 4);
      }
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 15, fin = buf[0] & 128;
        let len = buf[1] & 127, o = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); o = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); o = 10; }
        if (buf.length < o + len) return;
        const payload = buf.subarray(o, o + len);
        buf = buf.subarray(o + len);
        idle();
        if (op === 9) { this.send(0xa, payload); continue; }   // ping -> pong
        if (op === 8) return this.reconnect('server closed the socket');
        if (op === 10) continue;
        frag.push(payload);
        if (!fin) continue;
        const text = Buffer.concat(frag).toString('utf8');
        frag = [];
        if (!text) continue;
        let m;
        try { m = JSON.parse(text); } catch { this.fail(new Error('unreadable message')); continue; }
        this.onMessage(m);
      }
    });
  }

  send(op, payload) { // client frames are masked
    if (payload.length > 125) return; // control frames can't be longer; nothing else is sent
    const mask = crypto.randomBytes(4);
    const body = Buffer.from(payload.map((x, k) => x ^ mask[k % 4]));
    this.sock?.write(Buffer.concat([Buffer.from([0x80 | op, 0x80 | body.length]), mask, body]));
  }

  onMessage(m) {
    if (m?.staticVersion != null && this.staticVersion != null && m.staticVersion !== this.staticVersion) return this.reconnect('city map changed');
    const r = applyDelta(this.state, m);
    if (r === 'gap') { this.health.gaps++; return this.reconnect(`missing message before ${m.fromSequence}`); }
    if (r !== 'applied') return;
    this.health.ticks++;
    this.recent.push(m); if (this.recent.length > 40) this.recent.shift();
    this.history.set(this.state.seq, clone(this.state));
    if (this.history.size > 40) this.history.delete(this.history.keys().next().value);
    if (this.pending) this.compare();
    this.emit('reading', { t: new Date(this.state.timestamp ?? Date.now()).toISOString(), seq: this.state.seq, tick: this.state.tick, state: this.state });
  }

  // Take a fresh snapshot; compare when our own state reaches its sequence.
  async resync() {
    if (!this.state) return;
    const { s } = await this.snapshot();
    this.pending = s;
    this.compare();
  }

  compare() {
    const snap = this.pending;
    if (!snap || this.state.seq < snap.seq) return; // not there yet: wait for the tick
    this.pending = null;
    const ours = this.history.get(snap.seq);
    if (!ours) { this.fail(new Error(`no state kept for sequence ${snap.seq}: skipped a drift check`)); return; }
    this.health.resyncs++; this.health.driftChecks++;
    const n = drift(ours, snap, this.space) + (posKey(ours.npcs) === posKey(snap.npcs) ? 0 : 1);
    if (!n) { this.emit('health', this.health); return; }
    this.health.driftAgents += n;
    this.fail(new Error(`drift: ${n} positions differed from the snapshot at ${snap.seq}; took the snapshot`));
    // The snapshot wins: rebuild from it and replay the ticks since.
    const s = clone(snap);
    for (const m of this.recent) if (Number(m.toSequence) > s.seq) applyDelta(s, m);
    this.state = s;
  }
}

const posKey = (npcs) => [...npcs].map(([k, p]) => `${k}:${p ? `${p.spaceId}:${p.x},${p.y}` : '-'}`).sort().join('|');
