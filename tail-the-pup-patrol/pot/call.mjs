// Calls on the deployed pot:
//   node call.mjs fund <atomic>
//   node call.mjs attest A|B <race id> <race file>
//   node call.mjs settle <race id> <race file>
//   node call.mjs status
import { readFileSync } from 'node:fs';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { KEYS, bytes, deployment, walletUp, loadContract, outcomeOf, ledgerNow, potNight, raceIdFor, addressBytes, saveOutcome, savedOutcome, PRIVATE_STATE_ID } from './pot.mjs';
const [cmd, ...a] = process.argv.slice(2);
const dep = deployment(); if (!dep) { console.log('not deployed'); process.exit(1); }
const hex = (b) => Buffer.from(b).toString('hex');
// node call.mjs balance   -> the pot's tNIGHT, atomic units
// node call.mjs race-id   -> tonight's race id from the sealed schedule
if (cmd === 'balance') { console.log(String(await potNight(dep.address))); process.exit(0); }
if (cmd === 'race-id') { console.log(raceIdFor()); process.exit(0); }
if (cmd === 'status') {
  const l = await ledgerNow(dep.address);
  console.log(JSON.stringify({ address: dep.address, open: l.open, payouts: String(l.payouts), rollovers: String(l.rollovers), agreedUnsettled: String(l.agreedUnsettled), attestedA: l.byA.size().toString(), attestedB: l.byB.size().toString(), settled: l.settled.size().toString() }));
  process.exit(0);
}
const { compiled } = await loadContract();
let args, circuitId = cmd, info = '', reasonNoWinner = null;
if (cmd === 'fund') args = [BigInt(a[0])];
// node call.mjs close <mn_addr_preview1…>: the owner ends this pot and takes back what's left.
else if (cmd === 'close') {
  if (!/^mn_addr_preview1[0-9a-z]+$/.test(a[0] ?? '')) { console.log('usage: node call.mjs close <mn_addr_preview1…>'); process.exit(1); }
  args = [bytes(KEYS().owner), { bytes: addressBytes(a[0]) }];
}
else if (cmd === 'attest' || cmd === 'settle') {
  const [who, raceId, file] = cmd === 'attest' ? a : [null, a[0], a[1]];
  // Run ids name files (outcomes/), so only the schedule's shape: 2026-11-13T2200-official.
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$/.test(raceId ?? '')) { console.log('bad run id'); process.exit(1); }
  // A settle uses the outcome this machine's judge attested, if it has one: exactly what was agreed,
  // without the run file or the city's wallet list (which may have changed, or be down).
  const kept = cmd === 'settle' ? savedOutcome(dep.address, raceId) : null;
  const fresh = kept ? null : await outcomeOf(raceId, JSON.parse(readFileSync(file, 'utf8')));
  const o = kept ?? fresh.o;
  const { winnerId, winnerAddress, walletKind, won, organizer, ranked } = fresh ?? {};
  if (kept) console.log('settling the outcome this judge attested');
  if (cmd === 'attest') {
    // The pot pays only a wallet the winner published. A winner without one when the judges read it
    // isn't paid: the outcome has no winner, and the settle rolls the pot over to the next run.
    reasonNoWinner = won && organizer ? 'organizer' : won && !winnerAddress ? 'no-wallet' : null;
    if (won && organizer) console.log('ORGANIZER: the winner is the organizer\'s agent, which never takes the pot; attesting no winner, the pot rolls over');
    else if (won && !winnerAddress) console.log(`NO WALLET: the winner has no wallet of their own listed (${walletKind ?? 'none'}); attesting no winner, the pot rolls over`);
  }
  info = fresh
    ? `race ${raceId}, ranked ${JSON.stringify(ranked.map(([id, s]) => [id.slice(-4), s]))}, winner ${winnerId ? winnerId.slice(-4) : 'none'} ${winnerAddress ? winnerAddress.slice(0, 16) + '…' : ''}, end ${o.end}, outcome hash computed`
    : `race ${raceId}, ${o.hasWinner ? 'a winner' : 'no winner'}, end ${o.end}, saved outcome`;
  if (cmd === 'attest') {
    // Judge A, B or C: the secret is judgeA / judgeB / judgeC in TAIL_POT_KEYS. (A pot holds the
    // public keys of the judges it was deployed with; the v1 pots have A and B only.)
    if (!['A', 'B', 'C'].includes(who)) { console.log('attest needs a judge: A, B or C'); process.exit(1); }
    const secret = KEYS()[`judge${who}`];
    if (!/^[0-9a-f]{64}$/.test(secret ?? '')) { console.log(`no judge${who} secret in the keys file`); process.exit(1); }
    args = [bytes(secret), o];
  }
  else args = [o, { bytes: o.winner }];
} else { console.log('unknown command'); process.exit(1); }
if (info) console.log(info);
const { w, p } = await walletUp();
try {
  await p.privateStateProvider.forContract(dep.address).set(PRIVATE_STATE_ID, {});
  const r = await submitCallTx(p, { compiledContract: compiled, contractAddress: dep.address, privateStateId: PRIVATE_STATE_ID, circuitId, args });
  if (cmd === 'attest') saveOutcome(dep.address, a[1], args[1], reasonNoWinner);
  console.log(`${cmd} ok: tx ${r.public.txHash} block ${r.public.blockHeight}`);
} catch (e) { console.log(`${cmd} failed: ${String(e?.message ?? e).slice(0, 300)}`); process.exitCode = 1; }
finally { await w.wallet.stop().catch(() => {}); }
process.exit(process.exitCode ?? 0);
