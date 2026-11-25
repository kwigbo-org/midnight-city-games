// After a v3 settle: read what the transaction actually paid from the Preview indexer, and record it
// for the Runs tab in the site's data/payouts.json (keyed by run id), beside the v1 records.
//   node record-payout-v3.mjs <run id> <settle tx hash> <run file> <payouts.json>
// The run's winner and the pot's winner can differ: the pot goes to the highest-ranked finisher with
// a wallet of its own. Both are recorded, by name, with who was passed over and why, and the sponsor.
import './pot-version.mjs';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
// The contract (v3 or v4) comes from the deployment file: pot-version.mjs, imported above.
const v3 = await import('./pot-v3.mjs');
const { ledgerNow } = await import('./pot.mjs');

const [race, tx, runFile, out] = process.argv.slice(2);
if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$/.test(race ?? '')) throw new Error('bad run id');
if (!/^[0-9a-f]{64}$/.test(tx ?? '')) throw new Error('settle tx hash must be 64 hex characters');
const INDEXER = 'https://indexer.preview.midnight.network/api/v4/graphql';
const NIGHT = '0'.repeat(64);

let t = null;
for (let i = 0; i < 12 && !t; i++) { // the indexer can trail the node by a few seconds
  const res = await fetch(INDEXER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ query: `{ transactions(offset: { hash: "${tx}" }) { block { height timestamp } unshieldedCreatedOutputs { owner value tokenType } } }` }),
  });
  t = (await res.json())?.data?.transactions?.[0] ?? null;
  if (!t) await new Promise((r) => setTimeout(r, 5000));
}
if (!t) throw new Error(`settle tx ${tx} not on the indexer`);

const dep = v3.deploymentV3();
const saved = dep ? v3.savedOutcomeV3(dep.address, race) : null;
if (!saved) throw new Error(`no saved outcome for ${race}: record on the judge's machine that settled it`);
const run = JSON.parse(readFileSync(runFile, 'utf8'));
const players = run.result?.players ?? [];
const first = players[0];
const { winnerId, winnerIds, rookieId, skipped } = v3.savedExtraV3(dep.address, race);
// v3: one pot winner; v4: up to 5 sharing it (a true tie).
const V4 = 'winners' in saved;
const winnerWallets = [...(V4 ? saved.winner.slice(0, Number(saved.winners)).map((w) => v3.hex(w)) : saved.hasWinner ? [v3.hex(saved.winner)] : []),
  ...(saved.hasRookie ? [v3.hex(saved.rookie)] : [])]; // v5: the rookie's tenth counts as paid too
const nameOf = (id) => players.find((p) => p.id === id)?.name ?? null;
// The run's sponsorship, from the pot: the winning bid and the wallet it named.
const l = await ledgerNow(dep.address);
const bids = l.bids.member(saved.race) ? Number(l.bids.lookup(saved.race)) : 0;
const sponsor = bids > 0 ? { wallet: v3.hex(l.topWallet.lookup(saved.race)), bids } : null;
// Only what went to the pot winner the judges agreed on counts: any other output (a wallet's change)
// isn't the pot's.
const toWinner = (owner) => { try { return winnerWallets.includes(v3.hex(v3.addressBytes(String(owner).toLowerCase()))); } catch { return false; } };
const paid = saved.kind === 0n && winnerWallets.length
  ? (t.unshieldedCreatedOutputs ?? []).filter((o) => o.tokenType === NIGHT && toWinner(o.owner)).map((o) => ({ to: o.owner, night: String(o.value) }))
  : [];
const entry = {
  race,
  version: 3, // the record's format (the site reads 3); the pot contract's own version beside it
  potVersion: 'hasRookie' in saved ? 5 : V4 ? 4 : 3,
  settledAt: new Date(t.block.timestamp < 1e12 ? t.block.timestamp * 1000 : t.block.timestamp).toISOString(),
  tx,
  block: t.block.height,
  // void: cancelled or void, the sponsor refunded. paid: the pot went to its winner. rollover: no
  // finisher with a wallet of its own, so the pot carries to the next run.
  result: saved.kind === 1n ? 'void' : paid.length ? 'paid' : 'rollover',
  // The run's winner, whatever its wallet.
  winner: first?.status === 'tailed to the end' ? (first.name ?? first.label ?? null) : null,
  // The pot's winner: the highest-ranked finisher with a wallet of its own (not the organizer's).
  potWinner: winnerWallets.length ? nameOf(winnerId) : null,
  // v4, a true tie: everyone who shared the pot (names), in the order the judges named their wallets.
  ...(V4 && winnerIds.length > 1 ? { potWinners: winnerIds.map(nameOf) } : {}),
  // v5: the newcomer who took the rookie tenth.
  ...(saved.hasRookie ? { rookie: nameOf(rookieId) } : {}),
  // Finishers ranked above the pot winner who couldn't take it, and why (no-wallet, organizer).
  passedOver: skipped.map(([id, why]) => ({ name: nameOf(id), why })),
  sponsor,
  paid,
};
let all = {};
try { all = JSON.parse(readFileSync(out, 'utf8')); } catch { all = {}; }
all[race] = entry;
writeFileSync(`${out}.tmp`, `${JSON.stringify(all, null, 1)}\n`);
renameSync(`${out}.tmp`, out);
console.log('recorded', JSON.stringify(entry));
