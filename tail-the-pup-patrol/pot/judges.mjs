// Publish the pot's judges for the site's Judges tab, read from the live contract itself.
//   node judges.mjs <judges-roster.json> <out judges.json>
// The roster says who runs each judge slot (people's words); the public key and the number of runs
// each judge attested come from the chain, so the page can't claim a judge the contract doesn't have.
// Written atomically; on any failure the old file stays.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { deployment, ledgerNow, loadContract, OPERATOR_ADDRESS } from './pot.mjs';

const [rosterFile, out] = process.argv.slice(2);
if (!rosterFile || !out) { console.log('usage: node judges.mjs <judges-roster.json> <out judges.json>'); process.exit(1); }
const dep = deployment();
if (!dep) { console.log('no deployment.json'); process.exit(1); }
const l = await ledgerNow(dep.address);
if (!l) { console.log(`no contract at ${dep.address}`); process.exit(1); }
const hex = (b) => Buffer.from(b).toString('hex');
const roster = JSON.parse(readFileSync(rosterFile, 'utf8'));

// The judge slots this contract has, with how many runs each attested.
// v1: judgeA/judgeB and their attestation maps. v2: up to five slots; a judge's vote on a run is
// votes[pairKey(runKey(run), judge key)], counted over every run the contract has.
let judges;
if (l.judges !== undefined) {
  const { pureCircuits } = await loadContract();
  const runIds = [...l.runs].map(([race]) => race);
  judges = [...l.judges].map(([slot, key]) => {
    const letter = 'ABCDE'[Number(slot)];
    const attested = runIds.filter((race) => l.votes.member(pureCircuits.pairKey(pureCircuits.runKey(race), key))).length;
    return { slot: letter, publicKey: hex(key), attested, ...(roster.find((r) => r.slot === letter) ?? { runBy: null }) };
  });
} else {
  judges = [['A', l.judgeA, l.byA], ['B', l.judgeB, l.byB]].map(([slot, key, attested]) => ({
    slot, publicKey: hex(key), attested: Number(attested.size()), ...(roster.find((r) => r.slot === slot) ?? { runBy: null }),
  }));
}

const data = {
  contract: dep.address,
  network: 'preview',
  gameHash: hex(l.gameHash),
  ...(l.window !== undefined ? { windowSeconds: Number(l.window) } : {}),
  open: l.open,
  settled: Number(l.settled.size()),
  payouts: String(l.payouts),
  rollovers: String(l.rollovers),
  judges,
  operator: OPERATOR_ADDRESS, // the organizer's agent's wallet: never a pot winner (the site reads it here)
  at: new Date().toISOString(),
};
writeFileSync(`${out}.tmp`, `${JSON.stringify(data, null, 1)}\n`);
renameSync(`${out}.tmp`, out);
console.log(`judges.json: ${judges.map((j) => `${j.slot} ${j.publicKey.slice(0, 8)} (${j.attested} attested)`).join(', ')}`);
process.exit(0);
