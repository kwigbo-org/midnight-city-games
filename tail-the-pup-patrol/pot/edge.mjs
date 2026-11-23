// Edge cases for the deployed Tail pot on Preview, in one wallet session:
// rollover, veto, judges disagreeing, the challenge window, close. Synthetic races
// pay carol (the test wallet), so test payouts come back to it.
//   node edge.mjs
import { randomBytes } from 'node:crypto';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { chainTime } from './lib/midnight.mjs';
import { KEYS, bytes, sha, deployment, walletUp, loadContract, ledgerNow, addressBytes, PRIVATE_STATE_ID } from './pot.mjs';

const dep = deployment();
const k = KEYS();
const A = bytes(k.judgeA), B = bytes(k.judgeB), O = bytes(k.owner);
const { compiled } = await loadContract();
const { w, p } = await walletUp();
await p.privateStateProvider.forContract(dep.address).set(PRIVATE_STATE_ID, {});
const carolAddr = w.keystore.getBech32Address().asString();
const carol = { bytes: addressBytes(carolAddr) };
const zero = new Uint8Array(32);
const now = async () => BigInt(Math.floor((await chainTime()).getTime() / 1000));
const results = [];

async function tx(label, circuitId, args, expectFail) {
  try {
    const r = await submitCallTx(p, { compiledContract: compiled, contractAddress: dep.address, privateStateId: PRIVATE_STATE_ID, circuitId, args });
    const ok = !expectFail;
    results.push([ok ? 'PASS' : 'FAIL', label, `went through (tx ${r.public.txHash}, block ${r.public.blockHeight})`]);
    console.log(ok ? 'PASS' : 'FAIL', label, 'tx', r.public.txHash);
    return r;
  } catch (e) {
    const msg = String(e?.message ?? e);
    const ok = expectFail && msg.includes(expectFail);
    results.push([ok ? 'PASS' : 'FAIL', label, `rejected: ${msg.slice(0, 160)}`]);
    console.log(ok ? 'PASS' : 'FAIL', label, 'rejected:', msg.slice(0, 160));
    return null;
  }
}
const outcome = (id, end, hasWinner, result = id) => ({ race: sha(id), result: sha(`result:${result}`), hasWinner, winner: hasWinner ? carol.bytes : zero, end });
const counters = async (label) => {
  const l = await ledgerNow(dep.address);
  console.log(`  [${label}] open=${l.open} payouts=${l.payouts} rollovers=${l.rollovers} agreedUnsettled=${l.agreedUnsettled}`);
};

try {
  const tag = Date.now().toString(36);
  const t0 = await now();
  console.log('chain time', t0.toString(), 'tag', tag);
  await counters('start');

  // Guards on the race already settled yesterday, and a stranger's key.
  const done = sha('2026-11-09T2200-practice');
  await tx('veto a settled race', 'veto', [O, done], 'race already closed');
  await tx('a non-judge key attests', 'attest', [new Uint8Array(randomBytes(32)), outcome(`stranger-${tag}`, t0, false)], 'not a registered judge');

  // 1. Rollover: nobody won.
  const r1 = outcome(`rollover-${tag}`, t0 - 600n, false);
  await tx('rollover: A attests', 'attest', [A, r1]);
  await tx('rollover: A attests twice', 'attest', [A, r1], 'judge A already attested');
  await tx('rollover: B attests', 'attest', [B, r1]);
  await tx('rollover: settle (no payment)', 'settle', [r1, { bytes: zero }]);
  await tx('rollover: settle twice', 'settle', [r1, { bytes: zero }], 'race already settled');
  await counters('after rollover');

  await tx('fund 10 tNIGHT', 'fund', [10_000_000n]);

  // 2. Veto inside the window, and close blocked while a race is agreed.
  const r2 = outcome(`veto-${tag}`, (await now()) + 900n, true);
  await tx('veto: A attests', 'attest', [A, r2]);
  await tx('veto: B attests', 'attest', [B, r2]);
  await tx('close while a race is agreed', 'close', [O, carol], 'a race is waiting to be settled');
  await tx('veto by a non-owner key', 'veto', [A, r2.race], 'not the owner');
  await tx('veto: owner vetoes inside the window', 'veto', [O, r2.race]);
  await tx('veto: settle a vetoed race', 'settle', [r2, carol], 'race vetoed');
  await tx('veto: attest a vetoed race', 'attest', [A, outcome(`veto-${tag}`, r2.end, true)], 'race already closed');
  await counters('after veto');

  // 3. The judges disagree.
  const r3a = outcome(`disagree-${tag}`, t0 - 600n, true, 'a');
  await tx('disagree: A attests', 'attest', [A, r3a]);
  await tx('disagree: B attests a different end', 'attest', [B, { ...r3a, end: r3a.end + 1n }], "end differs from the other judge's");
  await tx('disagree: B attests a different result', 'attest', [B, outcome(`disagree-${tag}`, r3a.end, true, 'b')]);
  await tx("disagree: settle with A's outcome", 'settle', [r3a, carol], 'the judges disagree');
  await counters('after disagree');

  // 4. The window: no settle before it ends, no veto after.
  const r4 = outcome(`window-${tag}`, (await now()) + 90n, true);
  await tx('window: A attests', 'attest', [A, r4]);
  await tx('window: B attests', 'attest', [B, r4]);
  await tx('window: settle too early', 'settle', [r4, carol], 'challenge window still open');
  const opensAt = r4.end + BigInt(dep.window) + 30n;
  while ((await now()) < opensAt) await new Promise((r) => setTimeout(r, 10_000));
  await tx('window: veto after the window', 'veto', [O, r4.race], 'the challenge window has passed');
  await tx("window: settle to someone else's address", 'settle', [r4, { bytes: new Uint8Array(randomBytes(32)) }], "not the winner's address");
  await tx('window: settle pays the winner', 'settle', [r4, carol]);
  await counters('after window');

  // 5. Close the season.
  await tx('fund 5 tNIGHT', 'fund', [5_000_000n]);
  await tx('close by a non-owner key', 'close', [B, carol], 'not the owner');
  await tx('close: owner takes back the pot', 'close', [O, carol]);
  await tx('fund after close', 'fund', [1n], 'season over');
  await tx('attest after close', 'attest', [A, outcome(`late-${tag}`, t0, false)], 'season over');
  await counters('end');
} finally {
  console.log('\nSUMMARY');
  for (const [s, l, d] of results) console.log(s, '|', l, '|', d);
  console.log(results.filter((r) => r[0] === 'PASS').length, 'of', results.length, 'as expected');
  await w.wallet.stop().catch(() => {});
}
process.exit(0);
