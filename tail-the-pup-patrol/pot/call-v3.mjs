// Calls on a v3 pot (contract/tail-pot-v3.compact). The pot is deployment-v3.json, or TAIL_POT_DEPLOYMENT.
//   node call-v3.mjs status
//   node call-v3.mjs run-id [next|upcoming]                          today's, tomorrow's, or the first not yet started
//   node call-v3.mjs auction <run id>                                its auction: reserve, raise, close, top bid, banner
//   node call-v3.mjs open-run <judge A..E> <run id> <start ISO> [--price <usd per NIGHT>]   reserve $5, raise $1 in NIGHT
//   node call-v3.mjs bid <run id> <mn_addr_preview1…> <atomic> <image file> <https link>    this kit's wallet pays
//   node call-v3.mjs add <atomic>                                    to the pot, no banner (moving a pot in)
//   node call-v3.mjs attest <judge A..E> <run id> <run file>         the outcome from your own recording
//   node call-v3.mjs settle <run id | move id>                       the outcome this judge attested
//   node call-v3.mjs sweep                                           the operator's share to its address
//   node call-v3.mjs rotate <judge A..E> <slot A..E> <judge key hex | empty> [nonce hex]
//   node call-v3.mjs move <judge A..E> <move id> <successor contract address>  then: settle <move id>
//   node call-v3.mjs refund-sponsor <judge A..E> <run id>           the operator's call: this pot's sponsor bid for the
//                                                                   run back in full (the contract's kind-1 outcome), e.g. a bid left on
//                                                                   an old pot at a switch. Only this pot's copy of the run: a run judged
//                                                                   on another pot stands. Then settle (and don't record it in payouts)
// The judge secret is judgeA..judgeE in TAIL_POT_KEYS; the fees are paid by TAIL_POT_WALLET.
import './pot-version.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
// The contract (v3 or v4) comes from the deployment file: pot-version.mjs, imported above.
// 0.5 DUST over the wallet's fee estimate (lib/midnight.mjs): calls that take tNIGHT can be underpaid without it.
process.env.TAIL_POT_FEE_OVERHEAD ??= '500000000000000';
const { submitCallTx } = await import('@midnight-ntwrk/midnight-js-contracts');
const { KEYS, walletUp, ledgerNow, PRIVATE_STATE_ID } = await import('./pot.mjs');
const v3 = await import('./pot-v3.mjs');
const { chainTime } = await import('./lib/midnight.mjs');
const V4 = ['tail-pot-v4', 'tail-pot-v5'].includes(process.env.TAIL_POT_CONTRACT), V5 = process.env.TAIL_POT_CONTRACT === 'tail-pot-v5';
const noRookie = () => (V5 ? { hasRookie: false, rookie: v3.ZERO } : {});

const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4}-[a-z]+$/;
const MOVE_ID = /^move-[0-9a-z-]{1,40}$/;
const ADDR = /^mn_addr_preview1[0-9a-z]+$/;
const [cmd, ...a] = process.argv.slice(2);
const need = (ok, msg) => { if (!ok) { console.log(msg); process.exit(1); } };

// A scheduled run from the sealed rules: "<run id> <start>". Today's, tomorrow's ('next'), or the
// first that hasn't started yet ('upcoming': what to open after a settle, whatever the hour; a
// settle that runs past midnight must not skip a day).
if (cmd === 'run-id') {
  const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const r = a[0] === 'upcoming'
    ? [...v3.runsOn(day(0)), ...v3.runsOn(day(1))].find((x) => Date.parse(x.start) > Date.now())
    : v3.runsOn(day(a[0] === 'next' ? 1 : 0))[0];
  need(r, 'no scheduled run');
  console.log(`${r.id} ${r.start}`);
  process.exit(0);
}

const dep = v3.deploymentV3();
if (!dep) { console.log('no v3 pot: deployment-v3.json'); process.exit(1); }
const { compiled, pureCircuits } = await v3.loadContract();
const secretOf = (letter) => {
  const s = KEYS()[`judge${letter}`];
  need(/^[0-9a-f]{64}$/.test(s ?? ''), `no judge${letter} secret in the keys file`);
  return v3.bytes(s);
};
const user = (b) => ({ bytes: b });
const tn = (n) => `${n / v3.NIGHT_UNIT}.${(n % v3.NIGHT_UNIT).toString().padStart(6, '0')}`;
const iso = (s) => new Date(Number(s) * 1000).toISOString();

if (cmd === 'status') {
  const l = await ledgerNow(dep.address);
  const judges = [...l.judges].map(([s, k]) => `${v3.SLOTS[Number(s)]}:${v3.hex(k).slice(0, 8)}`);
  console.log(JSON.stringify({ address: dep.address, open: l.open, judges, pot: tn(l.pot), operatorDue: tn(l.operatorDue),
    runs: Number(l.runs.size()), settled: Number(l.settled.size()), payouts: String(l.payouts), rollovers: String(l.rollovers), voids: String(l.voids) }));
  process.exit(0);
}
// Whether two judges have agreed a run's outcome: "yes" or "no".
if (cmd === 'agreed') {
  const [runId] = a;
  need(RUN_ID.test(runId ?? ''), 'usage: agreed <run id>');
  const l = await ledgerNow(dep.address);
  const { pureCircuits: pc } = await v3.loadContract();
  console.log(l.agreed.member(pc.runKey(v3.sha(runId))) ? 'yes' : 'no');
  process.exit(0);
}
// Where a run's judging stands, from the chain alone (no keys): one line, e.g.
// "A=yes B=no agreed=no settled=no" (A/B: that judge's vote is posted).
if (cmd === 'judging') {
  const [runId] = a;
  need(RUN_ID.test(runId ?? ''), 'usage: judging <run id>');
  const l = await ledgerNow(dep.address);
  const rk = pureCircuits.runKey(v3.sha(runId));
  const yn = (b) => (b ? 'yes' : 'no');
  const votes = [...l.judges].map(([s, k]) => `${v3.SLOTS[Number(s)] ?? s}=${yn(l.votes.member(pureCircuits.pairKey(rk, k)))}`);
  console.log(`${votes.join(' ')} agreed=${yn(l.agreed.member(rk))} settled=${yn(l.settled.member(rk))}`);
  process.exit(0);
}
if (cmd === 'auction') {
  const [runId] = a;
  need(RUN_ID.test(runId ?? ''), 'usage: auction <run id>');
  const l = await ledgerNow(dep.address);
  const r = v3.sha(runId);
  need(l.runs.member(r), `no run ${runId} on this pot`);
  const run = l.runs.lookup(r);
  const top = l.topBid.member(r) ? l.topBid.lookup(r) : 0n;
  console.log(JSON.stringify({ run: runId, start: iso(run.start), reserve: tn(run.reserve), step: tn(run.step), closes: iso(l.closeAt.lookup(r)),
    bids: l.bids.member(r) ? Number(l.bids.lookup(r)) : 0, topBid: tn(top),
    topWallet: top > 0n ? v3.hex(l.topWallet.lookup(r)) : null, banner: top > 0n ? v3.hex(l.banner.lookup(r)) : null,
    link: top > 0n ? v3.linkText(l.bannerLink.lookup(r)) : null }));
  process.exit(0);
}

let circuitId = cmd, args, after = null;
if (cmd === 'open-run') {
  const [who, runId, startIso, flag, price] = a;
  need(RUN_ID.test(runId ?? '') && !Number.isNaN(Date.parse(startIso ?? '')), 'usage: open-run <judge A..E> <run id> <start ISO> [--price <usd>]');
  const p = await v3.auctionPrices(flag === '--price' ? Number(price) : null);
  const start = BigInt(Math.floor(Date.parse(startIso) / 1000));
  console.log(`run ${runId}: start ${iso(start)}, auction closes ${iso(start - 3600n)}, reserve ${tn(p.reserve)} tNIGHT ($${p.reserveUsd}), minimum raise ${tn(p.step)} ($${p.stepUsd}) at $${p.priceUsd}/NIGHT (${p.source}, ${p.at})`);
  circuitId = 'openRun';
  args = [secretOf(who), v3.slotOf(who), v3.sha(runId), start, p.reserve, p.step];
  after = () => v3.saveOpenedRunV3(dep.address, runId, { start: iso(start), reserve: String(p.reserve), step: String(p.step), reserveUsd: p.reserveUsd, stepUsd: p.stepUsd, priceUsd: p.priceUsd, source: p.source, pricedAt: p.at });
} else if (cmd === 'bid') {
  const [runId, addr, amount, image, link] = a;
  need(RUN_ID.test(runId ?? '') && ADDR.test(addr ?? '') && /^[1-9][0-9]*$/.test(amount ?? '') && image && link,
    'usage: bid <run id> <mn_addr_preview1…> <atomic> <image file> <https link>');
  const hash = new Uint8Array(createHash('sha256').update(readFileSync(image)).digest());
  args = [v3.sha(runId), user(v3.addressBytes(addr)), BigInt(amount), hash, v3.linkBytes(link)];
  console.log(`bid ${tn(BigInt(amount))} tNIGHT on ${runId} for ${addr.slice(0, 22)}…, banner ${v3.hex(hash).slice(0, 12)}… at ${link}`);
} else if (cmd === 'add') {
  const [amount] = a;
  need(/^[1-9][0-9]*$/.test(amount ?? ''), 'usage: add <atomic>');
  circuitId = 'addToPot';
  args = [BigInt(amount)];
} else if (cmd === 'attest') {
  const [who, runId, file] = a;
  need(RUN_ID.test(runId ?? '') && file, 'usage: attest <judge A..E> <run id> <run file>');
  const l = await ledgerNow(dep.address);
  const race = v3.sha(runId);
  need(l.runs.member(race), `no run ${runId} on this pot`);
  // Judge only after the run's start, by the chain's time: the run is over, and so is its auction.
  const startsAt = Number(l.runs.lookup(race).start) * 1000;
  const now = (await chainTime()).getTime();
  need(now > startsAt + 60_000, `${runId} starts at ${new Date(startsAt).toISOString()} (chain time now ${new Date(now).toISOString()}): judge after the run`);
  const runJson = JSON.parse(readFileSync(file, 'utf8'));
  // Season 4: no attest unless every beacon round of the run is there and verifies (beacon.mjs), so a
  // missing or forged round can't pass as "no glance". Fix a gap with: node beacon.mjs <run file> --fill
  {
    // The beacon comes from this kit's sealed rules.json only, never from the run file (beacon.mjs trustedBeacon).
    const here = new URL('.', import.meta.url);
    const sealed = [new URL('rules.json', here), new URL('../rules.json', here)].find((u) => existsSync(u));
    need(sealed || !V5, 'attest on a v5 pot needs Season 4\'s rules.json (and beacon.mjs) beside the tools');
    const lib = existsSync(new URL('beacon.mjs', here)) ? './beacon.mjs' : '../beacon.mjs';
    const { beaconGaps, trustedBeacon } = sealed ? await import(lib) : {};
    let B = null;
    try { B = sealed ? trustedBeacon(JSON.parse(readFileSync(sealed, 'utf8')), runJson) : null; } catch (e) { need(false, `${runId}: ${e.message}`); }
    if (B) {
      let gaps = []; try { gaps = beaconGaps(B, runJson); } catch (e) { need(false, `${runId}: ${e.message}`); }
      need(!gaps.length, `${runId}: ${gaps.length} beacon rounds missing or unverified (first ${gaps[0]}): run node beacon.mjs ${file} --fill, then attest`);
      console.log('beacon: every round of the run verifies');
    }
  }
  // The organizer: its id (judges A and B) or its hash (the public deployment record).
  const organizer = dep.organizerAgentId ?? (dep.organizerAgentIdHash ? `sha256:${dep.organizerAgentIdHash}` : null);
  const r = await v3.outcomeV3(runId, runJson, dep.operator, organizer);
  console.log(`run ${runId}: ${r.kind === 0n ? 'valid' : 'cancelled or void (the sponsor refunded)'}, ranked ${JSON.stringify(r.ranked.map(([id, s]) => [id.slice(-4), s]))}, pot winner ${r.winnerId ? `${r.winnerId.slice(-4)} ${r.winnerAddress.slice(0, 18)}…` : 'none'}${r.skipped.length ? `, passed over ${JSON.stringify(r.skipped.map(([id, why]) => [id.slice(-4), why]))}` : ''}`);
  args = [secretOf(who), v3.slotOf(who), r.o];
  if (V4 && r.winners?.length > 1) console.log(`a true tie: the pot is shared by ${r.winners.length} (${r.winners.map((w) => w.id.slice(-4)).join(', ')})`);
  if (V5 && r.rookie) console.log(`the rookie prize: ${r.rookie.id.slice(-4)} ${r.rookie.address.slice(0, 18)}…`);
  after = () => v3.saveOutcomeV3(dep.address, runId, r.o, { winnerId: r.winnerId, winnerIds: (r.winners ?? []).map((w) => w.id), rookieId: r.rookie?.id ?? null, skipped: r.skipped });
} else if (cmd === 'move') {
  const [who, moveId, successor] = a;
  need(MOVE_ID.test(moveId ?? '') && /^[0-9a-f]{64}$/.test(successor ?? ''), 'usage: move <judge A..E> <move id, e.g. move-season-3> <successor contract address>');
  const o = { race: v3.sha(moveId), result: v3.sha(`move:${successor}`), kind: 2n, ...(V4 ? { winners: 0n, winner: Array(5).fill(v3.ZERO), ...noRookie() } : { hasWinner: false, winner: v3.ZERO }), successor: v3.bytes(successor) };
  console.log(`move ${moveId}: the whole pot to the migration address, to fund ${successor}`);
  circuitId = 'attest';
  args = [secretOf(who), v3.slotOf(who), o];
  after = () => v3.saveOutcomeV3(dep.address, moveId, o);
} else if (cmd === 'refund-sponsor') {
  // Both judges must post exactly this, so the result is fixed by the run id alone.
  const [who, runId] = a;
  need(RUN_ID.test(runId ?? ''), 'usage: refund-sponsor <judge A..E> <run id>');
  const lv = await ledgerNow(dep.address);
  need(lv.runs.member(v3.sha(runId)), `no run ${runId} on this pot`);
  const o = { race: v3.sha(runId), result: v3.sha(`void:${runId}`), kind: 1n, ...(V4 ? { winners: 0n, winner: Array(5).fill(v3.ZERO), ...noRookie() } : { hasWinner: false, winner: v3.ZERO }), successor: v3.ZERO };
  console.log(`refund-sponsor ${runId}: this pot's winning bid for it back to its sponsor in full (accepted after the run's start)`);
  circuitId = 'attest';
  args = [secretOf(who), v3.slotOf(who), o];
  after = () => v3.saveOutcomeV3(dep.address, runId, o, { reason: 'sponsor refunded by the operator' });
} else if (cmd === 'settle') {
  const [runId] = a;
  need(RUN_ID.test(runId ?? '') || MOVE_ID.test(runId ?? ''), 'usage: settle <run id | move id>');
  const o = v3.savedOutcomeV3(dep.address, runId);
  need(o, `no saved outcome for ${runId}: settle on a judge's machine that attested it`);
  // The operator's share of the winning bid: a tenth, rounded down (the contract checks it).
  let share = 0n, each = 0n, tenth = 0n;
  if (o.kind === 0n) {
    const l = await ledgerNow(dep.address);
    const b = l.topBid.member(o.race) ? l.topBid.lookup(o.race) : 0n;
    share = b / v3.SHARE_DIVISOR;
    const after = l.pot + b - share;
    // v5: the rookie's tenth of the pot (set aside with or without a rookie); v4/v5: each winner's share
    // of the rest, rounded down.
    if (V5) tenth = after / 10n;
    if (V4 && o.winners > 0n) each = (after - tenth) / o.winners;
  }
  const paying = V4 ? (o.winners > 0n ? `pays ${o.winners} pot winner${o.winners > 1n ? 's' : ''} ${tn(each)} each` : 'rolls over') : (o.hasWinner ? 'pays the pot winner' : 'rolls over');
  console.log(`settling ${runId}: ${o.kind === 0n ? `${paying}, operator's share ${tn(share)}` : o.kind === 1n ? 'void: the winning bid back to its sponsor' : 'move'}`);
  if (V5) console.log(o.hasRookie ? `the rookie gets ${tn(tenth)}` : `no rookie: its ${tn(tenth)} stays in the pot`);
  args = V5 ? [o, share, tenth, each] : V4 ? [o, share, each] : [o, user(o.hasWinner ? o.winner : v3.ZERO), share];
} else if (cmd === 'sweep') {
  args = [];
} else if (cmd === 'rotate') {
  const [who, slot, key, nonce] = a;
  need(/^[A-E]$/.test(slot ?? '') && (key === 'empty' || /^[0-9a-f]{64}$/.test(key ?? '')) && (nonce === undefined || /^[0-9a-f]{64}$/.test(nonce)),
    'usage: rotate <judge A..E> <slot A..E> <judge key hex | empty> [nonce: 64 hex]');
  const n = nonce ?? randomBytes(32).toString('hex');
  console.log(`rotation: slot ${slot} -> ${key === 'empty' ? 'empty' : key.slice(0, 8)}, nonce ${n} (the second judge must back the same)`);
  args = [secretOf(who), v3.slotOf(who), { slot: v3.slotOf(slot), key: key === 'empty' ? v3.ZERO : v3.bytes(key), nonce: v3.bytes(n) }];
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
