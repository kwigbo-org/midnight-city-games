// After a v2 settle: read what the transaction actually paid from the Preview indexer, and record it
// for the Runs tab in the site's data/payouts.json (keyed by run id), beside the v1 records.
//   node record-payout-v2.mjs <run id> <settle tx hash> <run file> <payouts.json>
// In v2 the run's winner and the pot's winner can differ: the pot goes to the highest-ranked finisher
// who entered it. Both are recorded, by name; the pot winner as the judge saved it when it attested.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
process.env.TAIL_POT_CONTRACT = 'tail-pot-v2';
const v2 = await import('./pot-v2.mjs');

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

const dep = v2.deploymentV2();
const saved = dep ? v2.savedOutcomeV2(dep.address, race) : null;
if (!saved) throw new Error(`no saved outcome for ${race}: record on the judge's machine that settled it`);
const run = JSON.parse(readFileSync(runFile, 'utf8'));
const players = run.result?.players ?? [];
const first = players[0];
const winnerId = v2.savedWinnerIdV2(dep.address, race);
// Only what went to the pot winner the judges agreed on counts: any other output (a wallet's change)
// isn't the pot's.
const toWinner = (owner) => { try { return v2.hex(v2.addressBytes(String(owner).toLowerCase())) === v2.hex(saved.winner); } catch { return false; } };
const paid = saved.kind === 0n && saved.hasWinner
  ? (t.unshieldedCreatedOutputs ?? []).filter((o) => o.tokenType === NIGHT && toWinner(o.owner)).map((o) => ({ to: o.owner, night: String(o.value) }))
  : [];
const entry = {
  race,
  version: 2,
  settledAt: new Date(t.block.timestamp < 1e12 ? t.block.timestamp * 1000 : t.block.timestamp).toISOString(),
  tx,
  block: t.block.height,
  // void: cancelled or void, every entry refunded. paid: the pot went to its winner. rollover: no
  // finisher had entered, so the pot carries to the next run.
  result: saved.kind === 1n ? 'void' : paid.length ? 'paid' : 'rollover',
  // The run's winner, whether or not they entered the pot.
  winner: first?.status === 'tailed to the end' ? (first.name ?? first.label ?? null) : null,
  // The pot's winner: the highest-ranked finisher who entered it.
  potWinner: saved.hasWinner ? (players.find((p) => p.id === winnerId)?.name ?? null) : null,
  paid,
};
let all = {};
try { all = JSON.parse(readFileSync(out, 'utf8')); } catch { all = {}; }
all[race] = entry;
writeFileSync(`${out}.tmp`, `${JSON.stringify(all, null, 1)}\n`);
renameSync(`${out}.tmp`, out);
console.log('recorded', JSON.stringify(entry));
