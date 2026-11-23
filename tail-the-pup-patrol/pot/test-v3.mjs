// Off-chain tests for the v3 pot (contract/tail-pot-v3.compact): its compiled circuits run in memory,
// no network and no proofs, with the block time set per call. Compile first:
//   compact compile --skip-zk ../contract/tail-pot-v3.compact contract/managed/tail-pot-v3
//   node test-v3.mjs [compiled contract dir]
// (Money in and out isn't simulated here: the Preview rehearsal checks the transfers.)
import { createHash, randomBytes } from 'node:crypto';
import { createConstructorContext, createCircuitContext, sampleContractAddress } from '@midnight-ntwrk/compact-runtime';

const dir = process.argv[2] ?? './contract/managed/tail-pot-v3';
const { Contract, ledger, pureCircuits } = await import(`${dir.startsWith('/') ? '' : './'}${dir}/contract/index.js`);

const b32 = () => new Uint8Array(randomBytes(32));
const zero = new Uint8Array(32);
const sha = (s) => new Uint8Array(createHash('sha256').update(s).digest());
const hex = (b) => Buffer.from(b).toString('hex');
const link = (s) => { const b = new Uint8Array(96); b.set(new TextEncoder().encode(s)); return b; };
const T0 = 1_800_000_000; // a block time, seconds
const START = T0 + 86_400; // the run starts a day later
const CLOSE = START - 3600; // its auction closes an hour before
const NIGHT = zero;
const RES = 100_000_000n; // a $5 reserve in tNIGHT atomic units (at $0.05)
const STEP = 20_000_000n; // a $1 minimum raise

const secret = { A: b32(), B: b32(), C: b32() };
const key = Object.fromEntries(Object.entries(secret).map(([k, v]) => [k, pureCircuits.judgeKey(v)]));
const wallet = { op: b32(), mig: b32(), s1: b32(), s2: b32(), s3: b32(), win: b32() };
const user = (b) => ({ bytes: b });
const slotOf = { A: 0n, B: 1n, C: 2n };
const J = (who) => [secret[who], slotOf[who]];

const results = [];
function check(name, ok, detail = '') { results.push([ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); }

async function deploy(args) {
  const c = new Contract({});
  const { currentContractState, currentZswapLocalState, currentPrivateState } = await c.initialState(
    createConstructorContext({}, hex(b32())), ...args);
  return { c, state: currentContractState, zswap: currentZswapLocalState, ps: currentPrivateState, address: sampleContractAddress() };
}
const ctorArgs = (over = {}) => {
  const a = { game: sha('seal'), token: NIGHT, op: wallet.op, mig: wallet.mig, min: 1_000_000n, max: 10_000_000_000n, j: [key.A, key.B, zero, zero, zero], ...over };
  return [a.game, a.token, a.op, a.mig, a.min, a.max, ...a.j];
};
async function call(pot, circuit, args, time = T0) {
  try {
    const ctx = createCircuitContext({ circuitId: circuit, contractAddress: pot.address, coinPublicKeyOrZswapState: pot.zswap,
      contractState: pot.state, privateState: pot.ps, time });
    const r = await pot.c.circuits[circuit](ctx, ...args);
    pot.state = r.context.queryContexts[pot.address].state;
    pot.zswap = r.context.zswapLocalStates[pot.address] ?? pot.zswap;
    pot.ps = r.context.callContext?.currentPrivateState ?? pot.ps;
    return null;
  } catch (e) { return String(e?.message ?? e); }
}
const L = (pot) => ledger(pot.state.data ?? pot.state);
const ok = (name, err) => check(name, err === null, err ?? '');
const fails = (name, err, want) => check(name, err !== null && err.includes(want), err ?? 'went through');
const outcome = (race, kind, hasWinner = false, winner = zero, successor = zero, result = 'r') => ({ race, result: sha(result), kind: BigInt(kind), hasWinner, winner, successor });
const bid = (pot, race, w, amount, time = T0) => call(pot, 'bid', [race, user(w), amount, sha(`img-${amount}`), link('https://example.com/banner.png')], time);
const tenth = (n) => n / 10n;

// ---- constructor -------------------------------------------------------------------------------
const ctorFails = async (name, over, want) => { try { await deploy(ctorArgs(over)); check(name, false, 'went through'); } catch (e) { check(name, String(e.message).includes(want), e.message); } };
await ctorFails('ctor: empty operator', { op: zero }, "operator address can't be empty");
await ctorFails('ctor: empty migration', { mig: zero }, "migration address can't be empty");
await ctorFails('ctor: reserve min 0', { min: 0n }, 'reserve bounds');
await ctorFails('ctor: reserve min > max', { min: 10n, max: 5n }, 'reserve bounds');
await ctorFails('ctor: reserve max too large', { max: 10n ** 18n }, 'reserve max too large');
await ctorFails('ctor: one judge', { j: [key.A, zero, zero, zero, zero] }, 'at least two judges');
await ctorFails('ctor: the same judge twice', { j: [key.A, key.A, zero, zero, zero] }, 'judges must differ');
await ctorFails('ctor: slot 2 repeats slot 0', { j: [key.A, key.B, key.A, zero, zero] }, 'judges must differ');

let pot = await deploy(ctorArgs());
check('deploy: two judges, open, empty pot', L(pot).open && L(pot).judges.size() === 2n && L(pot).pot === 0n);

// ---- opening runs ------------------------------------------------------------------------------
const run1 = sha('2026-11-20T2200-official');
fails('open: not a judge', await call(pot, 'openRun', [b32(), 0n, run1, BigInt(START), RES, STEP]), 'not a judge');
fails('open: wrong slot', await call(pot, 'openRun', [secret.A, 1n, run1, BigInt(START), RES, STEP]), 'not a judge');
fails('open: reserve below the bounds', await call(pot, 'openRun', [...J('A'), run1, BigInt(START), 1n, 1n]), 'reserve out of bounds');
fails('open: reserve above the bounds', await call(pot, 'openRun', [...J('A'), run1, BigInt(START), 10n ** 11n, STEP]), 'reserve out of bounds');
fails('open: no minimum raise', await call(pot, 'openRun', [...J('A'), run1, BigInt(START), RES, 0n]), 'minimum raise');
fails('open: raise above the reserve', await call(pot, 'openRun', [...J('A'), run1, BigInt(START), RES, RES + 1n]), 'minimum raise');
fails('open: auction would already be closed', await call(pot, 'openRun', [...J('A'), run1, BigInt(START), RES, STEP], CLOSE), 'too late');
ok('open: judge A opens run 1', await call(pot, 'openRun', [...J('A'), run1, BigInt(START), RES, STEP]));
check('open: closes an hour before the start', L(pot).closeAt.lookup(run1) === BigInt(CLOSE));
fails('open: twice', await call(pot, 'openRun', [...J('B'), run1, BigInt(START), RES, STEP]), 'run already open');

// ---- the auction -------------------------------------------------------------------------------
fails('bid: no such run', await bid(pot, sha('nope'), wallet.s1, RES), 'no such run');
fails('bid: naming no wallet', await bid(pot, run1, zero, RES), 'names a wallet');
fails('bid: below the reserve', await bid(pot, run1, wallet.s1, RES - 1n), 'at least the reserve');
ok('bid: s1 at the reserve', await bid(pot, run1, wallet.s1, RES));
check('bid: s1 on top, one bid', L(pot).topBid.lookup(run1) === RES && hex(L(pot).topWallet.lookup(run1)) === hex(wallet.s1) && L(pot).bids.lookup(run1) === 1n);
check('bid: banner hash and link recorded', hex(L(pot).banner.lookup(run1)) === hex(sha(`img-${RES}`)) && new TextDecoder().decode(L(pot).bannerLink.lookup(run1)).startsWith('https://example.com/banner.png'));
// Top 100: the step (+20) is more than 10% (+10): 119 fails, 120 passes.
fails('bid: raise below the minimum raise', await bid(pot, run1, wallet.s2, RES + STEP - 1n), 'minimum raise');
ok('bid: s2 raises by the minimum raise', await bid(pot, run1, wallet.s2, RES + STEP));
check('bid: s2 on top', hex(L(pot).topWallet.lookup(run1)) === hex(wallet.s2) && L(pot).topBid.lookup(run1) === RES + STEP);
// Top 120, step 20: 10% is 12, so the step decides again: 139 fails. Raise the top far above the step:
ok('bid: s3 jumps to 1,000', await bid(pot, run1, wallet.s3, 1_000_000_000n));
// Top 1,000: 10% (100) is more than the step (20): 1,020 passes the step but not 10%.
fails('bid: raise below 10%', await bid(pot, run1, wallet.s1, 1_000_000_000n + STEP), 'at least 10%');
ok('bid: s1 raises by 10%', await bid(pot, run1, wallet.s1, 1_100_000_000n));
check('bid: four bids, s1 on top at 1,100', L(pot).bids.lookup(run1) === 4n && L(pot).topBid.lookup(run1) === 1_100_000_000n);
fails('bid: too large', await bid(pot, run1, wallet.s2, 10n ** 16n), 'bid too large');
check('bid: the close hasn\'t moved (early bids)', L(pot).closeAt.lookup(run1) === BigInt(CLOSE));

// The soft close: a bid in the last 5 minutes moves the close 5 minutes later, up to start - 30 min.
ok('soft close: bid 4 min before the close', await bid(pot, run1, wallet.s2, 1_210_000_000n, CLOSE - 240));
check('soft close: close moved 5 min later', L(pot).closeAt.lookup(run1) === BigInt(CLOSE + 300));
ok('soft close: bid in the extension', await bid(pot, run1, wallet.s3, 1_331_000_000n, CLOSE + 200));
check('soft close: moved again', L(pot).closeAt.lookup(run1) === BigInt(CLOSE + 600));
// Keep extending to the cap (start - 30 min = CLOSE + 1800).
let top = 1_331_000_000n, t = CLOSE + 500, who = [wallet.s1, wallet.s2];
for (let i = 0; i < 8; i++) {
  top = top * 11n / 10n + 1n;
  await bid(pot, run1, who[i % 2], top, t);
  t = Number(L(pot).closeAt.lookup(run1)) - 100;
}
check('soft close: capped at 30 min before the start', L(pot).closeAt.lookup(run1) === BigInt(START - 1800), `closeAt ${L(pot).closeAt.lookup(run1) - BigInt(CLOSE)} s after the first close`);
fails('bid: after the close', await bid(pot, run1, wallet.s1, top * 2n, START - 1800), 'the auction is closed');
const won = L(pot).topBid.lookup(run1);
const sponsor1 = L(pot).topWallet.lookup(run1);

// ---- adding to the pot -------------------------------------------------------------------------
fails('add: nothing', await call(pot, 'addToPot', [0n]), 'nothing to add');
ok('add: 20 tNIGHT, no banner', await call(pot, 'addToPot', [20_000_000n]));
check('add: in the pot', L(pot).pot === 20_000_000n);

// ---- judging a valid run -----------------------------------------------------------------------
const o1 = outcome(run1, 0, true, wallet.win);
fails('attest: before the run starts', await call(pot, 'attest', [...J('A'), o1], START - 60), "hasn't started");
fails('attest: a winner with no wallet', await call(pot, 'attest', [...J('A'), outcome(run1, 0, true, zero)], START + 3600), 'a pot winner has a wallet');
fails('attest: the operator as pot winner', await call(pot, 'attest', [...J('A'), outcome(run1, 0, true, wallet.op)], START + 3600), 'never takes the pot');
// A judge can replace its vote until two agree: A first names another winner, then changes it.
const o1x = outcome(run1, 0, true, wallet.s3);
ok('attest: A, a different winner first', await call(pot, 'attest', [...J('A'), o1x], START + 3600));
ok('attest: B, the winner', await call(pot, 'attest', [...J('B'), o1], START + 3600));
check('attest: A and B differ: not agreed', !L(pot).agreed.member(pureCircuits.runKey(run1)));
fails('attest: A repeats its vote', await call(pot, 'attest', [...J('A'), o1x], START + 3600), 'already attested this outcome');
ok('attest: A replaces its vote', await call(pot, 'attest', [...J('A'), o1], START + 3600));
check('attest: now agreed', L(pot).agreed.member(pureCircuits.runKey(run1)));
fails('attest: no change once agreed', await call(pot, 'attest', [...J('A'), o1x], START + 3600), 'already agreed');
fails('bid: once judged', await bid(pot, run1, wallet.s1, won * 2n, START + 3600), 'this run is judged');
fails('settle: to another address', await call(pot, 'settle', [o1, user(wallet.s1), tenth(won)], START + 3600), "not the pot winner's address");
fails('settle: share too small', await call(pot, 'settle', [o1, user(wallet.win), tenth(won) - 1n], START + 3600), 'a tenth of the winning bid');
fails('settle: share too big', await call(pot, 'settle', [o1, user(wallet.win), tenth(won) + 1n], START + 3600), 'a tenth of the winning bid');
ok('settle: pays the winner', await call(pot, 'settle', [o1, user(wallet.win), tenth(won)], START + 3600));
check('settle: pot paid out, operator due a tenth, the bid kept on record', L(pot).pot === 0n && L(pot).operatorDue === tenth(won) && L(pot).topBid.lookup(run1) === won && L(pot).payouts === 1n);
fails('settle: twice', await call(pot, 'settle', [o1, user(wallet.win), tenth(won)], START + 3600), 'already settled');
check('sponsor recorded for the run', hex(sponsor1).length === 64);

// ---- a winner, but nothing in the pot (no bid, nothing rolled over): settles, pays nobody -------
const run0 = sha('2026-11-20T2300-official');
const pot0 = await deploy(ctorArgs());
ok('empty pot: open', await call(pot0, 'openRun', [...J('A'), run0, BigInt(START), RES, STEP]));
const oz = outcome(run0, 0, true, wallet.win);
await call(pot0, 'attest', [...J('A'), oz], START + 3600);
await call(pot0, 'attest', [...J('B'), oz], START + 3600);
fails('empty pot: still only to the winner', await call(pot0, 'settle', [oz, user(wallet.s1), 0n], START + 3600), "not the pot winner's address");
ok('empty pot: settles', await call(pot0, 'settle', [oz, user(wallet.win), 0n], START + 3600));
check('empty pot: no payout, a rollover', L(pot0).payouts === 0n && L(pot0).rollovers === 1n);

// ---- a run with a bid and no winner: rolls over --------------------------------------------------
const run2 = sha('2026-11-21T2200-official');
ok('open: run 2', await call(pot, 'openRun', [...J('B'), run2, BigInt(START + 86_400), RES, STEP], T0 + 100));
ok('bid: run 2 at the reserve', await bid(pot, run2, wallet.s1, RES, T0 + 200));
const o2 = outcome(run2, 0, false);
await call(pot, 'attest', [...J('A'), o2], START + 90_000);
await call(pot, 'attest', [...J('B'), o2], START + 90_000);
ok('settle: no winner', await call(pot, 'settle', [o2, user(zero), tenth(RES)], START + 90_000));
check('rollover: 90% of the bid stays in the pot', L(pot).pot === RES - tenth(RES) && L(pot).rollovers === 1n);

// ---- a run with no bid and no winner -------------------------------------------------------------
const run3 = sha('2026-11-22T2200-official');
ok('open: run 3', await call(pot, 'openRun', [...J('A'), run3, BigInt(START + 172_800), RES, STEP], T0 + 300));
const o3 = outcome(run3, 0, false);
await call(pot, 'attest', [...J('A'), o3], START + 180_000);
await call(pot, 'attest', [...J('B'), o3], START + 180_000);
fails('settle: no bid, share must be 0', await call(pot, 'settle', [o3, user(zero), 1n], START + 180_000), 'a tenth');
ok('settle: no bid, rolls over', await call(pot, 'settle', [o3, user(zero), 0n], START + 180_000));
check('rollover: pot unchanged', L(pot).pot === RES - tenth(RES) && L(pot).rollovers === 2n);

// ---- a void run: the sponsor gets the winning bid back -------------------------------------------
const run4 = sha('2026-11-23T2200-official');
ok('open: run 4', await call(pot, 'openRun', [...J('A'), run4, BigInt(START + 259_200), RES, STEP], T0 + 400));
ok('bid: run 4', await bid(pot, run4, wallet.s2, RES * 3n, T0 + 500));
const o4 = outcome(run4, 1);
await call(pot, 'attest', [...J('A'), o4], START + 270_000);
await call(pot, 'attest', [...J('B'), o4], START + 270_000);
const due4 = L(pot).operatorDue, pot4 = L(pot).pot;
ok('settle: void', await call(pot, 'settle', [o4, user(zero), 0n], START + 270_000));
check('void: settled, the bid on record, pot and operator due unchanged', L(pot).settled.member(pureCircuits.runKey(run4)) && L(pot).topBid.lookup(run4) === RES * 3n && L(pot).pot === pot4 && L(pot).operatorDue === due4 && L(pot).voids === 1n);

// ---- sweep -------------------------------------------------------------------------------------
ok('sweep: the operator\'s share', await call(pot, 'sweep', []));
check('sweep: nothing due after', L(pot).operatorDue === 0n);
fails('sweep: twice', await call(pot, 'sweep', []), 'nothing due');

// ---- rotation ----------------------------------------------------------------------------------
const rot = { slot: 2n, key: key.C, nonce: b32() };
ok('rotate: A backs adding C', await call(pot, 'rotate', [...J('A'), rot]));
check('rotate: one backer is not enough', L(pot).judges.size() === 2n);
ok('rotate: B backs it', await call(pot, 'rotate', [...J('B'), rot]));
check('rotate: C is a judge', L(pot).judges.size() === 3n);
fails('rotate: carried out once', await call(pot, 'rotate', [...J('C'), rot]), 'already carried out');

// ---- the move ----------------------------------------------------------------------------------
const run5 = sha('2026-11-24T2200-official');
ok('open: run 5 (still open at the move)', await call(pot, 'openRun', [...J('A'), run5, BigInt(START + 345_600), RES, STEP], T0 + 600));
ok('bid: run 5', await bid(pot, run5, wallet.s1, RES, T0 + 700));
const mv = outcome(sha('move-season-3'), 2, false, zero, b32(), 'move');
fails('move: a run\'s id', await call(pot, 'attest', [...J('A'), outcome(run5, 2, false, zero, b32(), 'move')], START + 400_000), "a move can't use a run's id");
await call(pot, 'attest', [...J('A'), mv]);
await call(pot, 'attest', [...J('C'), mv]);
ok('settle: the move', await call(pot, 'settle', [mv, user(zero), 0n]));
check('move: pot sent, closed', L(pot).pot === 0n && !L(pot).open);
fails('bid: after the move', await bid(pot, run5, wallet.s2, RES * 2n, T0 + 800), 'this pot has moved');
fails('add: after the move', await call(pot, 'addToPot', [1n]), 'this pot has moved');
// The open run's sponsor isn't stranded: judged void, the bid goes back.
const o5 = outcome(run5, 1);
await call(pot, 'attest', [...J('A'), o5], START + 360_000);
await call(pot, 'attest', [...J('B'), o5], START + 360_000);
ok('settle: a run open at the move, void: its bid back', await call(pot, 'settle', [o5, user(zero), 0n], START + 360_000));
check('move: run 5 settled as void after the move', L(pot).settled.member(pureCircuits.runKey(run5)) && L(pot).voids === 2n);
// A run open at the move, judged valid with no winner: its share can't roll over (the pot can't move
// again): it follows the pot to the migration address.
const pm = await deploy(ctorArgs());
const r6 = sha('2026-11-25T2200-official');
ok('post-move: open a run', await call(pm, 'openRun', [...J('A'), r6, BigInt(START), RES, STEP]));
ok('post-move: a bid', await bid(pm, r6, wallet.s1, RES));
const mv2 = outcome(sha('move-x'), 2, false, zero, b32(), 'move');
await call(pm, 'attest', [...J('A'), mv2]); await call(pm, 'attest', [...J('B'), mv2]);
ok('post-move: the move', await call(pm, 'settle', [mv2, user(zero), 0n]));
const o6 = outcome(r6, 0, false);
await call(pm, 'attest', [...J('A'), o6], START + 3600); await call(pm, 'attest', [...J('B'), o6], START + 3600);
ok('post-move: the run settles, no winner', await call(pm, 'settle', [o6, user(zero), tenth(RES)], START + 3600));
check('post-move: nothing left in the pot (sent on), the operator\'s tenth due', L(pm).pot === 0n && L(pm).operatorDue === tenth(RES));

const failed = results.filter(([ok]) => !ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
