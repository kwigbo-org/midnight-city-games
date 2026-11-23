// Calls on a v2 pot (contract/tail-pot-v2.compact). The pot is deployment-v2.json, or TAIL_POT_DEPLOYMENT.
//   node call-v2.mjs status
//   node call-v2.mjs run-id [next|upcoming]                          today's, tomorrow's, or the first not yet started
//   node call-v2.mjs refund-all <run id>                             every entrant of a settled void run
//   node call-v2.mjs open-run <judge A..E> <run id> <start ISO> [--price <usd per NIGHT>]   fee = $1 in NIGHT
//   node call-v2.mjs enter <run id> <mn_addr_preview1…>             an agent's own wallet (this kit's wallet pays)
//   node call-v2.mjs sponsor <run id> <mn_addr_preview1…> <atomic>   all of it to the pot
//   node call-v2.mjs attest <judge A..E> <run id> <run file>         the outcome from your own recording
//   node call-v2.mjs settle <run id | move id>                       the outcome this judge attested
//   node call-v2.mjs refund <run id> <mn_addr_preview1…>             an entrant of a void run
//   node call-v2.mjs sweep                                           the operator's share to its address
//   node call-v2.mjs rotate <judge A..E> <slot A..E> <judge key hex | empty> [nonce hex]
//   node call-v2.mjs move <judge A..E> <move id> <successor contract address>  then: settle <move id>
// The judge secret is judgeA..judgeE in TAIL_POT_KEYS; the fees are paid by TAIL_POT_WALLET.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
process.env.TAIL_POT_CONTRACT = 'tail-pot-v2';
// 0.5 DUST over the wallet's fee estimate (lib/midnight.mjs): without it, enter and sponsor can be underpaid.
process.env.TAIL_POT_FEE_OVERHEAD ??= '500000000000000';
const { submitCallTx } = await import('@midnight-ntwrk/midnight-js-contracts');
const { KEYS, walletUp, ledgerNow, PRIVATE_STATE_ID } = await import('./pot.mjs');
const v2 = await import('./pot-v2.mjs');
const { chainTime } = await import('./lib/midnight.mjs');

const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$/;
const MOVE_ID = /^move-[0-9a-z-]{1,40}$/;
const ADDR = /^mn_addr_preview1[0-9a-z]+$/;
const [cmd, ...a] = process.argv.slice(2);
const dep = v2.deploymentV2();
if (!dep) { console.log('no v2 pot: deployment-v2.json'); process.exit(1); }
const { compiled, pureCircuits } = await v2.loadContract();
const need = (ok, msg) => { if (!ok) { console.log(msg); process.exit(1); } };
const secretOf = (letter) => {
  const s = KEYS()[`judge${letter}`];
  need(/^[0-9a-f]{64}$/.test(s ?? ''), `no judge${letter} secret in the keys file`);
  return v2.bytes(s);
};
const user = (b) => ({ bytes: b });
const tn = (n) => `${n / v2.NIGHT_UNIT}.${(n % v2.NIGHT_UNIT).toString().padStart(6, '0')}`;

// A scheduled run from the sealed rules: "<run id> <start>". Today's, tomorrow's ('next'), or the
// first that hasn't started yet ('upcoming': what to open after a settle, whatever the hour; a
// settle that runs past midnight must not skip a day).
if (cmd === 'run-id') {
  const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const r = a[0] === 'upcoming'
    ? [...v2.runsOn(day(0)), ...v2.runsOn(day(1))].find((x) => Date.parse(x.start) > Date.now())
    : v2.runsOn(day(a[0] === 'next' ? 1 : 0))[0];
  need(r, 'no scheduled run');
  console.log(`${r.id} ${r.start}`);
  process.exit(0);
}

if (cmd === 'status') {
  const l = await ledgerNow(dep.address);
  const judges = [...l.judges].map(([s, k]) => `${v2.SLOTS[Number(s)]}:${v2.hex(k).slice(0, 8)}`);
  console.log(JSON.stringify({ address: dep.address, open: l.open, judges, pot: tn(l.pot), operatorDue: tn(l.operatorDue),
    runs: Number(l.runs.size()), settled: Number(l.settled.size()), payouts: String(l.payouts), rollovers: String(l.rollovers), voids: String(l.voids) }));
  process.exit(0);
}

let circuitId = cmd, args, after = null;
if (cmd === 'open-run') {
  const [who, runId, startIso, flag, price] = a;
  need(RUN_ID.test(runId ?? '') && !Number.isNaN(Date.parse(startIso ?? '')), 'usage: open-run <judge A..E> <run id> <start ISO> [--price <usd>]');
  const f = await v2.feeFor(1, flag === '--price' ? Number(price) : null);
  const start = BigInt(Math.floor(Date.parse(startIso) / 1000));
  console.log(`run ${runId}: start ${new Date(Number(start) * 1000).toISOString()}, fee ${tn(f.fee)} tNIGHT ($${f.usd} at $${f.priceUsd}/NIGHT, ${f.source}, ${f.at}), operator cut ${tn(f.cut)}`);
  circuitId = 'openRun';
  args = [secretOf(who), v2.slotOf(who), v2.sha(runId), start, f.fee, f.cut];
  after = () => v2.saveOpenedRun(dep.address, runId, { start: new Date(Number(start) * 1000).toISOString(), fee: String(f.fee), cut: String(f.cut), usd: f.usd, priceUsd: f.priceUsd, source: f.source, pricedAt: f.at });
} else if (cmd === 'enter' || cmd === 'refund') {
  const [runId, addr] = a;
  need(RUN_ID.test(runId ?? '') && ADDR.test(addr ?? ''), `usage: ${cmd} <run id> <mn_addr_preview1…>`);
  args = [v2.sha(runId), user(v2.addressBytes(addr))];
} else if (cmd === 'refund-all') {
  // Every entrant of a void run gets the fee back (to the wallet named in the entry), one call each.
  const [runId] = a;
  need(RUN_ID.test(runId ?? ''), 'usage: refund-all <run id>');
  const l = await ledgerNow(dep.address);
  const race = v2.sha(runId);
  need(l.refundable.member(race), `${runId} isn't a settled void run: nothing to refund`);
  const owed = [...l.entryWallets].filter(([k, w]) => v2.hex(k) === v2.hex(pureCircuits.pairKey(race, w)) && l.entries.lookup(k) > 0n).map(([, w]) => w);
  console.log(`${runId}: ${owed.length} entr${owed.length === 1 ? 'y' : 'ies'} to refund`);
  if (!owed.length) process.exit(0);
  const { w, p } = await walletUp();
  // One call each, 120 s apart (the next call spends this one's fee coins); a rejected call is tried
  // up to three times. Run it again to finish: entries already refunded are skipped.
  let failed = 0;
  const wait = () => new Promise((res) => setTimeout(res, 120_000));
  for (const [i, wb] of owed.entries()) {
    if (i > 0) await wait();
    for (let attempt = 1; ; attempt++) {
      try {
        await p.privateStateProvider.forContract(dep.address).set(PRIVATE_STATE_ID, {});
        const r = await submitCallTx(p, { compiledContract: compiled, contractAddress: dep.address, privateStateId: PRIVATE_STATE_ID, circuitId: 'refund', args: [race, user(wb)] });
        console.log(`refund ok: ${v2.hex(wb).slice(0, 8)}… tx ${r.public.txHash}`);
        break;
      } catch (e) {
        if (/submitTx rejected/.test(String(e?.message)) && attempt < 3) { console.log(`refund rejected, retry ${attempt} of 2 in 120 s`); await wait(); continue; }
        failed++; console.log(`refund failed: ${v2.hex(wb).slice(0, 8)}… ${String(e?.message ?? e).slice(0, 200)}`);
        break;
      }
    }
  }
  await w.wallet.stop().catch(() => {});
  process.exit(failed ? 1 : 0);
} else if (cmd === 'sponsor') {
  const [runId, addr, amount] = a;
  need(RUN_ID.test(runId ?? '') && ADDR.test(addr ?? '') && /^[1-9][0-9]*$/.test(amount ?? ''), 'usage: sponsor <run id> <mn_addr_preview1…> <atomic>');
  args = [v2.sha(runId), user(v2.addressBytes(addr)), BigInt(amount)];
} else if (cmd === 'attest') {
  const [who, runId, file] = a;
  need(RUN_ID.test(runId ?? '') && file, 'usage: attest <judge A..E> <run id> <run file>');
  const l = await ledgerNow(dep.address);
  // Judge only once entries are closed (the run's start has passed): every judge then sees the same
  // entrants. A judge who posted while entries were open could name a different pot winner.
  const race = v2.sha(runId);
  need(l.runs.member(race), `no run ${runId} on this pot`);
  const startsAt = Number(l.runs.lookup(race).start) * 1000;
  // The chain's time, not this machine's clock: entries close by block time.
  const now = (await chainTime()).getTime();
  need(now > startsAt + 60_000, `entries for ${runId} close at ${new Date(startsAt).toISOString()} (chain time now ${new Date(now).toISOString()}): judge after that`);
  const r = await v2.outcomeV2(runId, JSON.parse(readFileSync(file, 'utf8')), l, pureCircuits);
  console.log(`run ${runId}: ${r.kind === 0n ? 'valid' : 'cancelled or void (refunds)'}, ranked ${JSON.stringify(r.ranked.map(([id, s]) => [id.slice(-4), s]))}, pot winner ${r.winnerId ? `${r.winnerId.slice(-4)} ${r.winnerAddress.slice(0, 18)}…` : 'none'}`);
  args = [secretOf(who), v2.slotOf(who), r.o];
  after = () => v2.saveOutcomeV2(dep.address, runId, r.o, { winnerId: r.winnerId });
} else if (cmd === 'move') {
  const [who, moveId, successor] = a;
  need(MOVE_ID.test(moveId ?? '') && /^[0-9a-f]{64}$/.test(successor ?? ''), 'usage: move <judge A..E> <move id, e.g. move-season-2> <successor contract address>');
  const o = { race: v2.sha(moveId), result: v2.sha(`move:${successor}`), kind: 2n, hasWinner: false, winner: v2.ZERO, successor: v2.bytes(successor) };
  console.log(`move ${moveId}: the whole pot to the migration address, to fund ${successor}`);
  circuitId = 'attest';
  args = [secretOf(who), v2.slotOf(who), o];
  after = () => v2.saveOutcomeV2(dep.address, moveId, o);
} else if (cmd === 'settle') {
  const [runId] = a;
  need(RUN_ID.test(runId ?? '') || MOVE_ID.test(runId ?? ''), 'usage: settle <run id | move id>');
  const o = v2.savedOutcomeV2(dep.address, runId);
  need(o, `no saved outcome for ${runId}: settle on a judge's machine that attested it`);
  console.log(`settling ${runId}: ${o.kind === 0n ? (o.hasWinner ? 'pays the pot winner' : 'rolls over') : o.kind === 1n ? 'void: refunds' : 'move'}`);
  args = [o, user(o.hasWinner ? o.winner : v2.ZERO)];
} else if (cmd === 'sweep') {
  args = [];
} else if (cmd === 'rotate') {
  const [who, slot, key, nonce] = a;
  need(/^[A-E]$/.test(slot ?? '') && (key === 'empty' || /^[0-9a-f]{64}$/.test(key ?? '')) && (nonce === undefined || /^[0-9a-f]{64}$/.test(nonce)),
    'usage: rotate <judge A..E> <slot A..E> <judge key hex | empty> [nonce: 64 hex]');
  const n = nonce ?? randomBytes(32).toString('hex');
  console.log(`rotation: slot ${slot} -> ${key === 'empty' ? 'empty' : key.slice(0, 8)}, nonce ${n} (the second judge must back the same)`);
  args = [secretOf(who), v2.slotOf(who), { slot: v2.slotOf(slot), key: key === 'empty' ? v2.ZERO : v2.bytes(key), nonce: v2.bytes(n) }];
} else { console.log('unknown command'); process.exit(1); }

const { w, p } = await walletUp();
try {
  await p.privateStateProvider.forContract(dep.address).set(PRIVATE_STATE_ID, {});
  const submit = () => submitCallTx(p, { compiledContract: compiled, contractAddress: dep.address, privateStateId: PRIVATE_STATE_ID, circuitId, args });
  // The node rejects a transaction built on fee coins this wallet just spent (calls in quick
  // succession): wait for them to settle and try again, up to three times.
  let r;
  for (let attempt = 1; ; attempt++) {
    try { r = await submit(); break; } catch (e) {
      if (!/submitTx rejected/.test(String(e?.message)) || attempt === 3) throw e;
      console.log(`the node rejected it (likely coins this wallet just spent); retry ${attempt} of 2 in 120 s`);
      await new Promise((res) => setTimeout(res, 120_000));
    }
  }
  if (after) after();
  console.log(`${cmd} ok: tx ${r.public.txHash} block ${r.public.blockHeight}`);
} catch (e) { console.log(`${cmd} failed: ${String(e?.message ?? e).slice(0, 300)}`); process.exitCode = 1; }
finally { await w.wallet.stop().catch(() => {}); }
process.exit(process.exitCode ?? 0);
