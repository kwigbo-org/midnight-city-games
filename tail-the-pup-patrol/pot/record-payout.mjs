// After a settle: read what the transaction actually paid from the Preview indexer, and record it
// for the Runs tab in the site's data/payouts.json (keyed by race id).
//   node record-payout.mjs <race id> <settle tx hash> <run file> <payouts.json>
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { deployment, savedReason } from './pot.mjs';

const [race, tx, runFile, out] = process.argv.slice(2);
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

const paid = (t.unshieldedCreatedOutputs ?? []).filter((o) => o.tokenType === NIGHT).map((o) => ({ to: o.owner, night: String(o.value) }));
const run = JSON.parse(readFileSync(runFile, 'utf8'));
const first = run.result?.players?.[0];
// Why a winner wasn't paid, as this machine's judge saw it when it attested (organizer, or no wallet
// of their own). Not re-read from the city now: its wallet list may have changed since.
const reason = first?.status === 'tailed to the end' && !paid.length ? savedReason(deployment()?.address, race) : null;
const entry = {
  race,
  settledAt: new Date(t.block.timestamp < 1e12 ? t.block.timestamp * 1000 : t.block.timestamp).toISOString(),
  tx,
  block: t.block.height,
  result: paid.length ? 'paid' : 'rollover',
  // The run's winner, paid or not (no wallet of their own when the judges read it: rolled over).
  winner: first?.status === 'tailed to the end' ? first.name : null,
  ...(reason ? { reason } : {}),
  paid,
};
let all = {};
try { all = JSON.parse(readFileSync(out, 'utf8')); } catch { all = {}; }
all[race] = entry;
writeFileSync(`${out}.tmp`, `${JSON.stringify(all, null, 1)}\n`);
renameSync(`${out}.tmp`, out);
console.log('recorded', JSON.stringify(entry));
