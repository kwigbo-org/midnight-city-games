// Publish a v2 pot for the site, from the contract itself (on the games server, every minute).
//   node pot-data-v2.mjs <web data dir>      writes pot.json and pot-runs.json there
// pot.json:      the pot (the contract's own pot, not its balance, which also holds unsettled fees and
//                the operator's share) and the next run open for entries, with its fee and price.
// pot-runs.json: every run the pot knows: fee, price, start, state, entrants and sponsors (wallets,
//                matched to agents through the city's public lists).
// Written atomically; on any failure the old files stay (the page hides a stale pot.json).
import { renameSync, writeFileSync } from 'node:fs';
process.env.TAIL_POT_CONTRACT = 'tail-pot-v2';
const { ledgerNow } = await import('./pot.mjs');
const v2 = await import('./pot-v2.mjs');

const out = process.argv[2];
if (!out) { console.log('usage: node pot-data-v2.mjs <web data dir>'); process.exit(1); }
const dep = v2.deploymentV2();
if (!dep) { console.log('no v2 pot'); process.exit(1); }
const l = await ledgerNow(dep.address);
if (!l) { console.log(`no contract at ${dep.address}`); process.exit(1); }
const { pureCircuits } = await v2.loadContract();
const opened = v2.openedRuns(dep.address);
const idOf = new Map(Object.keys(opened).map((id) => [v2.hex(v2.sha(id)), id]));

// Agent names for wallets: the city's wallet list (own published wallets) and agent roster.
const who = new Map();
try {
  const [wallets, agents] = await Promise.all([
    v2.walletList(),
    fetch('https://midnight.city/observer/api/agents', { signal: AbortSignal.timeout(30000) }).then((r) => r.json()).then((d) => d.agents ?? []),
  ]);
  const names = new Map(agents.filter((a) => typeof a.id === 'string').map((a) => [a.id, a.name]));
  for (const w of wallets) {
    if (w.network !== 'midnight-preview' || w.walletKind !== 'external_display' || !w.unshieldedAddress) continue;
    try { who.set(v2.hex(v2.addressBytes(w.unshieldedAddress.toLowerCase())), { agentId: w.agentId, name: names.get(w.agentId) ?? null }); } catch { /* unreadable: skip */ }
  }
} catch { /* names are a nicety: wallets still listed */ }
const person = (walletBytes) => ({ wallet: v2.hex(walletBytes), ...(who.get(v2.hex(walletBytes)) ?? { agentId: null, name: null }) });

const now = Date.now();
const entries = [...l.entryWallets];
const sponsors = [...l.sponsorWallets];
const runs = {};
for (const [race, run] of l.runs) {
  const key = v2.hex(race);
  const id = idOf.get(key) ?? `run-${key.slice(0, 12)}`;
  const mine = (pairs) => pairs.filter(([k, w]) => v2.hex(k) === v2.hex(pureCircuits.pairKey(race, w)));
  const rk = pureCircuits.runKey(race);
  const start = Number(run.start) * 1000;
  runs[id] = {
    start: new Date(start).toISOString(),
    fee: String(run.fee),
    cut: String(run.cut),
    ...(opened[id] ? { usd: opened[id].usd, priceUsd: opened[id].priceUsd, source: opened[id].source, pricedAt: opened[id].pricedAt } : {}),
    // A pot that has moved (closed) takes no more entries: none of its runs is open.
    state: l.settled.member(rk) ? 'settled' : l.agreed.member(rk) ? 'agreed' : start > now && l.open ? 'open' : 'closed',
    entrants: mine(entries).map(([k, w]) => ({ ...person(w), paid: String(l.entries.lookup(k)) })),
    sponsors: mine(sponsors).map(([k, w]) => ({ ...person(w), amount: String(l.sponsored.lookup(k)) })),
  };
}
const next = Object.entries(runs).filter(([, r]) => r.state === 'open').sort((a, b) => Date.parse(a[1].start) - Date.parse(b[1].start))[0];
const at = new Date().toISOString();
const write = (name, data) => { const f = `${out}/${name}`; writeFileSync(`${f}.tmp`, `${JSON.stringify(data, null, 1)}\n`); renameSync(`${f}.tmp`, f); };
write('pot-runs.json', { version: 2, contract: dep.address, at, runs });
write('pot.json', { version: 2, contract: dep.address, night: String(l.pot), open: l.open, at,
  nextRun: next ? { id: next[0], start: next[1].start, fee: next[1].fee, usd: next[1].usd ?? null, priceUsd: next[1].priceUsd ?? null, source: next[1].source ?? null, pricedAt: next[1].pricedAt ?? null, entrants: next[1].entrants.length } : null });
console.log(`pot ${l.pot}, ${Object.keys(runs).length} runs, next: ${next ? next[0] : 'none'}`);
process.exit(0);
