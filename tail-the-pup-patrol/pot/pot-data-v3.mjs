// Publish a v3 pot for the site, from the contract itself (on the games server, every minute).
//   node pot-data-v3.mjs <web data dir>      writes pot.json and pot-runs.json there
// pot.json:      the pot (the contract's own pot: not its balance, which also holds the open runs' top
//                bids and the operator's share) and the current run: the next one, or the one under
//                way, with its sponsor auction.
// pot-runs.json: every run the pot knows: start, reserve, raise and their price, the auction (close,
//                bids, top bid, its wallet and banner, and the bid history this publisher saw), its
//                state, and the judging: which judges have posted, agreed, settled.
// The bid history: the contract keeps only the top bid, so each minute's run records a new top bid
// when it sees one (two bids within the same minute show as the later one).
// Written atomically; on any failure the old files stay (the page shows a stale auction as paused).
// pot-status.json: whether the last run worked, and if not why: Midnight's indexer failing (checked
// directly: its HTTP code) or the game's own reader (the indexer answers fine), and since when; the
// page's paused notice names that cause.
import { POT_VERSION } from './pot-version.mjs';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
// The contract (v3 or v4) comes from the deployment file: pot-version.mjs, imported above.

const out = process.argv[2];
if (!out) { console.log('usage: node pot-data-v3.mjs <web data dir>'); process.exit(1); }
// The operator's pause on an open auction (e.g. a season switch): published as 'held', no page offers a bid.
const HELD = existsSync(`${out}/auction-hold.json`);
const statusFile = `${out}/pot-status.json`;
const writeStatus = (s) => { try { writeFileSync(`${statusFile}.tmp`, `${JSON.stringify(s)}\n`); renameSync(`${statusFile}.tmp`, statusFile); } catch { /* the page then says only that the data stopped */ } };
const INDEXER = 'https://indexer.preview.midnight.network/api/v4/graphql';
// Any failure, wherever it happens (a failed top-level await surfaces here too): record the cause.
let failing = false;
process.on('uncaughtException', async (e) => {
  if (failing) process.exit(1);
  failing = true;
  console.error(e);
  // The failed request's own HTTP answer (the indexer client reports it) says it first; else ask the
  // indexer directly (it can flap: a direct check alone could miss a failure it just had).
  const own = Number(e?.statusCode ?? e?.response?.status ?? 0);
  let code = 0; // 0: no answer at all
  if (own >= 400) code = own;
  else try {
    const r = await fetch(INDEXER, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"{ block { height } }"}', signal: AbortSignal.timeout(15000) });
    code = r.status;
    if (r.ok && !(await r.json().catch(() => null))?.data?.block) code = -1; // answers, but no block
  } catch { code = 0; }
  const cause = code === 200 ? 'game' : 'indexer';
  let before = null;
  try { before = JSON.parse(readFileSync(statusFile, 'utf8')); } catch { before = null; }
  const since = before && before.ok === false && before.cause === cause && before.since ? before.since : new Date().toISOString();
  writeStatus({ ok: false, cause, code, since, at: new Date().toISOString() });
  process.exit(1);
});

const { ledgerNow } = await import('./pot.mjs');
const v3 = await import('./pot-v3.mjs');
const dep = v3.deploymentV3();
if (!dep) { console.log('no v3 pot'); process.exit(1); }
const l = await ledgerNow(dep.address);
if (!l) throw new Error(`no contract at ${dep.address} (the indexer gave none)`);
const { pureCircuits } = await v3.loadContract();
const opened = v3.openedRunsV3(dep.address);
const idOf = new Map(Object.keys(opened).map((id) => [v3.hex(v3.sha(id)), id]));

// Names for wallets that belong to agents (anyone can sponsor; an agent's own wallet gets its name).
const who = new Map();
try {
  const [wallets, agents] = await Promise.all([
    v3.walletList(),
    fetch('https://midnight.city/observer/api/agents', { signal: AbortSignal.timeout(30000) }).then((r) => r.json()).then((d) => d.agents ?? []),
  ]);
  const names = new Map(agents.filter((a) => typeof a.id === 'string').map((a) => [a.id, a.name]));
  for (const w of wallets) {
    if (w.network !== 'midnight-preview' || w.walletKind !== 'external_display' || !w.unshieldedAddress) continue;
    try { who.set(v3.hex(v3.addressBytes(w.unshieldedAddress.toLowerCase())), { agentId: w.agentId, name: names.get(w.agentId) ?? null }); } catch { /* unreadable: skip */ }
  }
} catch { /* names are a nicety */ }

const now = Date.now();
const iso = (s) => new Date(Number(s) * 1000).toISOString();
// Refused sponsors (banner-v3 reject): anonymous everywhere, and never with a banner.
let refused = {};
// Missing: nobody is refused. Unreadable: nothing is published (a refused sponsor must never show).
try { refused = JSON.parse(readFileSync(`${out}/refused-sponsors.json`, 'utf8')); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
// The last published runs, for the bid history this publisher has kept.
let before = {};
try { before = JSON.parse(readFileSync(`${out}/pot-runs.json`, 'utf8')).runs ?? {}; } catch { before = {}; }
const judges = [...l.judges].map(([slot, key]) => ({ slot: v3.SLOTS[Number(slot)] ?? String(slot), key }));
const runs = {};
for (const [race, run] of l.runs) {
  const key = v3.hex(race);
  const id = idOf.get(key) ?? `run-${key.slice(0, 12)}`;
  const rk = pureCircuits.runKey(race);
  const closesAt = Number(l.closeAt.lookup(race)) * 1000;
  const top = l.topBid.member(race) ? l.topBid.lookup(race) : 0n;
  const settled = l.settled.member(rk), agreed = l.agreed.member(rk);
  const bids = l.bids.member(race) ? Number(l.bids.lookup(race)) : 0;
  // A settled run's held bid is spent (0); its sponsor is still on record.
  const hasSponsor = bids > 0 && l.topWallet.member(race);
  const wallet = hasSponsor ? v3.hex(l.topWallet.lookup(race)) : null;
  const history = [...(before[id]?.history ?? [])];
  if (hasSponsor && closesAt > now && (!history.length || history.at(-1).amount !== String(top))) {
    history.push({ at: new Date(now).toISOString(), amount: String(top), wallet, name: who.get(wallet)?.name ?? null });
  }
  // Each entry's name afresh: anonymous while its wallet is refused, its agent's name again once allowed.
  for (const [i, h] of history.entries()) {
    if (!h) continue;
    history[i] = refused[h.wallet] ? { ...h, name: null, refused: true } : { at: h.at, amount: h.amount, wallet: h.wallet, name: who.get(h.wallet)?.name ?? (h.refused ? null : h.name ?? null) };
  }
  runs[id] = {
    start: iso(run.start),
    closesAt: new Date(closesAt).toISOString(),
    reserve: String(run.reserve),
    step: String(run.step),
    ...(opened[id] ? { reserveUsd: opened[id].reserveUsd, stepUsd: opened[id].stepUsd, priceUsd: opened[id].priceUsd, source: opened[id].source, pricedAt: opened[id].pricedAt } : {}),
    // An open auction is 'held' while <out>/auction-hold.json exists (the operator's pause, e.g. a season
    // switch): the pages offer no bids, and the file's reason is shown.
    state: settled ? 'settled' : agreed ? 'agreed' : closesAt > now && l.open ? (HELD ? 'held' : 'auction') : 'closed',
    bids,
    topBid: String(top),
    sponsor: hasSponsor ? {
      wallet, ...(refused[wallet] ? { agentId: null, name: null, refused: true } : (who.get(wallet) ?? { agentId: null, name: null })),
      banner: v3.hex(l.banner.lookup(race)), link: v3.linkText(l.bannerLink.lookup(race)),
    } : null,
    history: history.slice(-20),
    // The judging, from the contract: each judge's vote on this run (posted or not), then agreed, settled.
    judging: { judges: judges.map((j) => ({ slot: j.slot, posted: l.votes.member(pureCircuits.pairKey(rk, j.key)) })), agreed, settled },
  };
}
// The current run: the earliest not yet settled whose start is less than three hours ago (its
// auction, then the run itself, then its judging); with none, the latest settled in the last six
// hours (official, until the next run's auction opens).
const byStart = (a, b) => Date.parse(a[1].start) - Date.parse(b[1].start);
const current = Object.entries(runs).filter(([, r]) => r.state !== 'settled' && Date.parse(r.start) > now - 3 * 3_600_000).sort(byStart)[0]
  ?? Object.entries(runs).filter(([, r]) => r.state === 'settled' && Date.parse(r.start) > now - 6 * 3_600_000).sort(byStart).at(-1);
const at = new Date().toISOString();
const write = (name, data) => { const f = `${out}/${name}`; writeFileSync(`${f}.tmp`, `${JSON.stringify(data, null, 1)}\n`); renameSync(`${f}.tmp`, f); };
write('pot-runs.json', { version: 3, potVersion: POT_VERSION, contract: dep.address, at, runs });
// What the current run's pot winner would get: the pot plus 90% of the run's top bid (the contract
// holds a bid apart until the run is settled, so a void run can give it back whole; it joins the pot
// at the settle, less the operator's tenth).
const curTop = current && current[1].state !== 'settled' ? BigInt(current[1].topBid) : 0n;
const prize = l.pot + curTop - curTop / 10n;
write('pot.json', { version: 3, potVersion: POT_VERSION, contract: dep.address, night: String(l.pot), prize: String(prize), open: l.open, at,
  run: current ? { id: current[0], ...current[1] } : null });
writeStatus({ ok: true, at });
console.log(`pot ${l.pot}, ${Object.keys(runs).length} runs, current: ${current ? `${current[0]} (${current[1].state})` : 'none'}`);
process.exit(0);
