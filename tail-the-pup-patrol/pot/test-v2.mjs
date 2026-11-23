// Off-chain tests for the v2 pot (contract/tail-pot-v2.compact): its compiled circuits run in memory,
// no network and no proofs, with the block time set per call. Compile first:
//   compact compile --skip-zk ../contract/tail-pot-v2.compact contract/managed/tail-pot-v2
//   node test-v2.mjs
import { createHash, randomBytes } from 'node:crypto';
import { createConstructorContext, createCircuitContext, sampleContractAddress } from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger, pureCircuits } from './contract/managed/tail-pot-v2/contract/index.js';

const b32 = () => new Uint8Array(randomBytes(32));
const zero = new Uint8Array(32);
const sha = (s) => new Uint8Array(createHash('sha256').update(s).digest());
const hex = (b) => Buffer.from(b).toString('hex');
const T0 = 1_800_000_000; // a block time, seconds; runs start an hour later
const NIGHT = zero;

const secret = { A: b32(), B: b32(), C: b32(), D: b32() };
const key = Object.fromEntries(Object.entries(secret).map(([k, v]) => [k, pureCircuits.judgeKey(v)]));
const wallet = { op: b32(), mig: b32(), w1: b32(), w2: b32(), w3: b32() };
const user = (b) => ({ bytes: b });
// Each judge names its slot. A and B start in 0 and 1; C is added to 2; D replaces B in 1.
const slotOf = { A: 0n, B: 1n, C: 2n, D: 1n };
const J = (who) => [secret[who], slotOf[who]];

let results = [];
function check(name, ok, detail = '') { results.push([ok, name, detail]); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); }

async function deploy(args) {
  const c = new Contract({});
  const { currentContractState, currentZswapLocalState, currentPrivateState } = await c.initialState(
    createConstructorContext({}, hex(b32())), ...args);
  return { c, state: currentContractState, zswap: currentZswapLocalState, ps: currentPrivateState, address: sampleContractAddress() };
}
const ctorArgs = (over = {}) => {
  const a = { game: sha('seal'), token: NIGHT, op: wallet.op, mig: wallet.mig, min: 1_000_000n, max: 1_000_000_000n, j: [key.A, key.B, zero, zero, zero], ...over };
  return [a.game, a.token, a.op, a.mig, a.min, a.max, ...a.j];
};
// Run a circuit against the pot; on success the pot's state moves on. Returns the error message or null.
async function call(pot, circuit, args, time = T0) {
  try {
    const ctx = createCircuitContext({ circuitId: circuit, contractAddress: pot.address, coinPublicKeyOrZswapState: pot.zswap,
      contractState: pot.state, privateState: pot.ps, time }); // seconds
    const r = await pot.c.circuits[circuit](ctx, ...args);
    // One query context per contract in the call tree, keyed by address.
    pot.state = r.context.queryContexts[pot.address].state;
    pot.zswap = r.context.zswapLocalStates[pot.address] ?? pot.zswap;
    pot.ps = r.context.callContext?.currentPrivateState ?? pot.ps;
    return null;
  } catch (e) { return String(e?.message ?? e); }
}
const L = (pot) => ledger(pot.state.data ?? pot.state); // after deploy a ContractState, after a call its data
const ok = (name, err) => check(name, err === null, err ?? '');
const fails = (name, err, want) => check(name, err !== null && err.includes(want), err ?? 'went through');
const outcome = (race, kind, hasWinner = false, winner = zero, successor = zero, result = 'r') => ({ race, result: sha(result), kind: BigInt(kind), hasWinner, winner, successor });

// ---- constructor -------------------------------------------------------------------------------
const ctorFails = async (name, over, want) => { try { await deploy(ctorArgs(over)); check(name, false, 'went through'); } catch (e) { check(name, String(e.message).includes(want), e.message); } };
await ctorFails('ctor: empty operator', { op: zero }, "operator address can't be empty");
await ctorFails('ctor: empty migration address', { mig: zero }, "migration address can't be empty");
await ctorFails('ctor: fee min 0', { min: 0n }, 'fee bounds');
await ctorFails('ctor: fee min > max', { min: 10n, max: 5n }, 'fee bounds');
await ctorFails('ctor: one judge', { j: [key.A, zero, zero, zero, zero] }, 'at least two judges');
await ctorFails('ctor: the same judge twice', { j: [key.A, key.A, zero, zero, zero] }, 'judges must differ');
await ctorFails('ctor: slot 3 repeats slot 0', { j: [key.A, key.B, key.C, key.A, zero] }, 'judges must differ');
await ctorFails('ctor: slot 4 repeats slot 2', { j: [key.A, key.B, key.C, key.D, key.C] }, 'judges must differ');
await ctorFails('ctor: fee max too large', { max: 10n ** 18n }, 'fee max too large');

let pot = await deploy(ctorArgs());
check('deploy: two judges, open', L(pot).open && L(pot).judges.size() === 2n);

// ---- runs --------------------------------------------------------------------------------------
const run1 = sha('2026-11-20T2200-official'), start1 = BigInt(T0 + 3600);
const fee = 21_350_000n, cut = 2_135_000n;
fails('openRun: not a judge', await call(pot, 'openRun', [...J('C'), run1, start1, fee, cut]), 'not a judge');
fails('openRun: fee below the bound', await call(pot, 'openRun', [...J('A'), run1, start1, 500_000n, 50_000n]), 'fee out of bounds');
fails('openRun: cut a unit too high', await call(pot, 'openRun', [...J('A'), run1, start1, fee, cut + 1n]), 'a tenth of the fee');
fails('openRun: a huge cut', await call(pot, 'openRun', [...J('A'), run1, start1, fee, 2n ** 127n]), 'a tenth of the fee');
fails('openRun: cut a unit too low', await call(pot, 'openRun', [...J('A'), run1, start1, fee, cut - 1n]), 'a tenth of the fee');
fails('openRun: already started', await call(pot, 'openRun', [...J('A'), run1, start1, fee, cut], T0 + 3600), 'already started');
ok('openRun: judge A opens run 1 (21.35 tNIGHT, cut 2.135)', await call(pot, 'openRun', [...J('A'), run1, start1, fee, cut]));
fails('openRun: twice', await call(pot, 'openRun', [...J('B'), run1, start1, fee, cut]), 'already open');
ok('openRun: a fee with an odd last digit (cut rounds down)', await call(pot, 'openRun', [...J('B'), sha('odd'), start1, 21_350_009n, 2_135_000n]));

// ---- entries, sponsors -------------------------------------------------------------------------
fails('enter: no such run', await call(pot, 'enter', [sha('nope'), user(wallet.w1)]), 'no such run');
fails('enter: the operator address', await call(pot, 'enter', [run1, user(wallet.op)]), "organizer's agent");
ok('enter: w1', await call(pot, 'enter', [run1, user(wallet.w1)]));
ok('enter: w2', await call(pot, 'enter', [run1, user(wallet.w2)]));
fails('enter: w1 again', await call(pot, 'enter', [run1, user(wallet.w1)]), 'already entered');
fails('enter: after the start', await call(pot, 'enter', [run1, user(wallet.w3)], T0 + 3600), 'entries are closed');
check('enter: two entrants, fees and cuts held', L(pot).entrants.lookup(run1) === 2n && L(pot).fees.lookup(run1) === 2n * fee && L(pot).cuts.lookup(run1) === 2n * cut);
fails('sponsor: nothing', await call(pot, 'sponsor', [run1, user(wallet.w3), 0n]), 'nothing to sponsor');
ok('sponsor: w3 sponsors 5 tNIGHT', await call(pot, 'sponsor', [run1, user(wallet.w3), 5_000_000n]));
check('sponsor: all of it in the pot', L(pot).pot === 5_000_000n);
// The entrants and sponsors of a run can be listed from the contract alone.
const listed = (m, race) => [...m].filter(([k, w]) => hex(k) === hex(pureCircuits.pairKey(race, w))).map(([, w]) => hex(w)).sort();
check('entrants listed', JSON.stringify(listed(L(pot).entryWallets, run1)) === JSON.stringify([hex(wallet.w1), hex(wallet.w2)].sort()));
check('sponsors listed', JSON.stringify(listed(L(pot).sponsorWallets, run1)) === JSON.stringify([hex(wallet.w3)]));

// ---- judging -----------------------------------------------------------------------------------
const win1 = outcome(run1, 0, true, wallet.w2);
fails('attest: not a judge', await call(pot, 'attest', [...J('C'), win1]), 'not a judge');
fails('attest: unknown kind', await call(pot, 'attest', [...J('A'), outcome(run1, 3)]), 'unknown kind');
fails('attest: no such run', await call(pot, 'attest', [...J('A'), outcome(sha('nope'), 0)]), 'no such run');
ok('attest: A', await call(pot, 'attest', [...J('A'), win1]));
fails('attest: A twice', await call(pot, 'attest', [...J('A'), win1]), 'already attested');
fails('settle: one judge is not agreement', await call(pot, 'settle', [win1, user(wallet.w2)]), 'not an agreed outcome');
ok('attest: B, the same', await call(pot, 'attest', [...J('B'), win1]));
check('attest: agreed', L(pot).agreed.member(pureCircuits.runKey(run1)));
fails('sponsor: after the judges agreed', await call(pot, 'sponsor', [run1, user(wallet.w3), 1n]), 'judged');

// ---- settle a won run --------------------------------------------------------------------------
fails('settle: to someone else', await call(pot, 'settle', [win1, user(wallet.w1)]), "pot winner's address");
const potBefore = L(pot).pot;
ok('settle: pays the pot winner', await call(pot, 'settle', [win1, user(wallet.w2)]));
check('settle: operator due = both cuts', L(pot).operatorDue === 2n * cut, `${L(pot).operatorDue}`);
check('settle: pot paid out, now empty', L(pot).pot === 0n && L(pot).payouts === 1n, `pot before ${potBefore}`);
fails('settle: twice', await call(pot, 'settle', [win1, user(wallet.w2)]), 'already settled');
fails('sponsor: a settled run', await call(pot, 'sponsor', [run1, user(wallet.w3), 1n]), 'judged');

// A winner who didn't enter can't be paid.
const run2 = sha('run2');
ok('openRun: run 2', await call(pot, 'openRun', [...J('A'), run2, start1, fee, cut]));
ok('enter: w1 in run 2', await call(pot, 'enter', [run2, user(wallet.w1)]));
const notEntrant = outcome(run2, 0, true, wallet.w3);
ok('attest: A names a non-entrant', await call(pot, 'attest', [...J('A'), notEntrant]));
ok('attest: B the same', await call(pot, 'attest', [...J('B'), notEntrant]));
fails('settle: the pot winner must have entered', await call(pot, 'settle', [notEntrant, user(wallet.w3)]), "didn't enter");

// Disagreement never settles.
const run3 = sha('run3');
ok('openRun: run 3', await call(pot, 'openRun', [...J('A'), run3, start1, fee, cut]));
ok('attest: A says w1', await call(pot, 'attest', [...J('A'), outcome(run3, 0, true, wallet.w1)]));
ok('attest: B says no winner', await call(pot, 'attest', [...J('B'), outcome(run3, 0, false)]));
check('disagreement: not agreed', !L(pot).agreed.member(pureCircuits.runKey(run3)));

// ---- rollover ----------------------------------------------------------------------------------
const run4 = sha('run4');
ok('openRun: run 4', await call(pot, 'openRun', [...J('A'), run4, start1, fee, cut]));
ok('enter: w1 in run 4', await call(pot, 'enter', [run4, user(wallet.w1)]));
const none4 = outcome(run4, 0, false);
ok('attest: A no winner', await call(pot, 'attest', [...J('A'), none4]));
ok('attest: B no winner', await call(pot, 'attest', [...J('B'), none4]));
const due4 = L(pot).operatorDue;
ok('settle: rollover', await call(pot, 'settle', [none4, user(zero)]));
check('rollover: fee split, pot kept', L(pot).pot === fee - cut && L(pot).operatorDue === due4 + cut && L(pot).rollovers === 1n);

// ---- void: refunds -----------------------------------------------------------------------------
const run5 = sha('run5');
ok('openRun: run 5', await call(pot, 'openRun', [...J('A'), run5, start1, fee, cut]));
ok('enter: w1 in run 5', await call(pot, 'enter', [run5, user(wallet.w1)]));
ok('enter: w2 in run 5', await call(pot, 'enter', [run5, user(wallet.w2)]));
fails('refund: before the run is void', await call(pot, 'refund', [run5, user(wallet.w1)]), 'not a void run');
const void5 = outcome(run5, 1);
ok('attest: A void', await call(pot, 'attest', [...J('A'), void5]));
ok('attest: B void', await call(pot, 'attest', [...J('B'), void5]));
const potBeforeVoid = L(pot).pot, dueBeforeVoid = L(pot).operatorDue;
ok('settle: void', await call(pot, 'settle', [void5, user(zero)]));
check('void: nothing split, pot unchanged', L(pot).pot === potBeforeVoid && L(pot).operatorDue === dueBeforeVoid && L(pot).voids === 1n);
ok('refund: w1 gets the fee back', await call(pot, 'refund', [run5, user(wallet.w1)]));
fails('refund: w1 twice', await call(pot, 'refund', [run5, user(wallet.w1)]), 'nothing to refund');
fails('refund: w3 never entered', await call(pot, 'refund', [run5, user(wallet.w3)]), 'nothing to refund');
ok('refund: w2', await call(pot, 'refund', [run5, user(wallet.w2)]));
check('void: all fees returned', L(pot).fees.lookup(run5) === 0n);

// ---- the operator's share ----------------------------------------------------------------------
ok('sweep: the operator share goes out', await call(pot, 'sweep', []));
check('sweep: nothing due after', L(pot).operatorDue === 0n);
fails('sweep: nothing due', await call(pot, 'sweep', []), 'nothing due');

// ---- judges: rotation --------------------------------------------------------------------------
const addC = { slot: 2n, key: key.C, nonce: b32() };
fails('rotate: not a judge', await call(pot, 'rotate', [...J('C'), addC]), 'not a judge');
ok('rotate: A backs adding C', await call(pot, 'rotate', [...J('A'), addC]));
check('rotate: one judge alone changes nothing', !L(pot).judges.member(2n));
fails('rotate: A backs it twice', await call(pot, 'rotate', [...J('A'), addC]), 'already backed');
ok('rotate: B backs it too', await call(pot, 'rotate', [...J('B'), addC]));
check('rotate: C is judge 2', L(pot).judges.member(2n) && hex(L(pot).judges.lookup(2n)) === hex(key.C));
fails('rotate: the same rotation again', await call(pot, 'rotate', [...J('C'), addC]), 'already carried out');
fails('rotate: C is already a judge', await call(pot, 'rotate', [...J('A'), { slot: 3n, key: key.C, nonce: b32() }]), 'already a judge');
fails('rotate: slot 5', await call(pot, 'rotate', [...J('A'), { slot: 5n, key: key.D, nonce: b32() }]), 'slots are 0..4');

// Two of three: A and C agree, B didn't attest.
const run6 = sha('run6');
ok('openRun: run 6 (by C)', await call(pot, 'openRun', [...J('C'), run6, start1, fee, cut]));
const none6 = outcome(run6, 0, false);
ok('attest: C', await call(pot, 'attest', [...J('C'), none6]));
ok('attest: A', await call(pot, 'attest', [...J('A'), none6]));
check('two of three agree', L(pot).agreed.member(pureCircuits.runKey(run6)));

// Replace B with D (A and C), then remove D (A and C): three judges, then two; two can't be cut to one.
const swap = { slot: 1n, key: key.D, nonce: b32() };
ok('rotate: A backs B -> D', await call(pot, 'rotate', [...J('A'), swap]));
ok('rotate: C backs B -> D', await call(pot, 'rotate', [...J('C'), swap]));
check('rotate: slot 1 is D', hex(L(pot).judges.lookup(1n)) === hex(key.D));
fails('rotate: B is no longer a judge', await call(pot, 'rotate', [...J('B'), { slot: 3n, key: b32(), nonce: b32() }]), 'not a judge');
const drop = { slot: 1n, key: zero, nonce: b32() };
ok('rotate: A backs emptying slot 1', await call(pot, 'rotate', [...J('A'), drop]));
ok('rotate: C backs emptying slot 1', await call(pot, 'rotate', [...J('C'), drop]));
check('rotate: two judges left', L(pot).judges.size() === 2n);
const drop2 = { slot: 2n, key: zero, nonce: b32() };
ok('rotate: A backs emptying slot 2', await call(pot, 'rotate', [...J('A'), drop2]));
fails('rotate: never fewer than two judges', await call(pot, 'rotate', [...J('C'), drop2]), 'at least two judges');

// ---- moving the pot to a successor -------------------------------------------------------------
fails('move: with a run\'s id', await call(pot, 'attest', [...J('A'), outcome(run6, 2, false, zero, b32(), 'move')]), "can't use a run's id");
const move = outcome(sha('move-1'), 2, false, zero, b32(), 'move');
ok('attest: A moves', await call(pot, 'attest', [...J('A'), move]));
ok('attest: C moves', await call(pot, 'attest', [...J('C'), move]));
check('move: its own keyspace', L(pot).agreed.member(pureCircuits.moveKey(move.race)) && !L(pot).agreed.member(pureCircuits.runKey(move.race)));
ok('settle: the move', await call(pot, 'settle', [move, user(zero)]));
check('move: pot empty, closed', !L(pot).open && L(pot).pot === 0n);
fails('enter: after the move', await call(pot, 'enter', [run1, user(wallet.w3)]), 'moved');
fails('openRun: after the move', await call(pot, 'openRun', [...J('A'), sha('late'), start1, fee, cut]), 'moved');

const failed = results.filter((r) => !r[0]);
console.log(`\n${results.length - failed.length} of ${results.length} as expected`);
process.exit(failed.length ? 1 : 0);
