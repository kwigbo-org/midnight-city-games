// Season 4: the drand beacon behind the back glance (rules.glance.beacon), checked, not trusted. A round
// counts only if its BLS signature verifies against the beacon's public key (the scheme drand quicknet
// uses: bls-unchained-g1-rfc9380, the message sha256 of the round as 8 bytes, big-endian) and its
// randomness is sha256 of that signature. So no endpoint, and no one between, can choose a glance.
//
//   node beacon.mjs <run file>    checks every round a run file used; exits 1 if any fails
import { createHash } from 'node:crypto';
import { bls12_381 } from './vendor/bls12-381.bundle.mjs';

const DST = 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_';
const S = bls12_381.shortSignatures;
const keys = new Map();

export function verifyRound(B, round, randomness, signature) {
  if (B.scheme !== 'bls-unchained-g1-rfc9380') throw new Error(`unknown beacon scheme ${B.scheme}`);
  if (!Number.isInteger(round) || round < 1 || !/^[0-9a-f]{64}$/.test(randomness ?? '') || !/^[0-9a-f]{96}$/.test(signature ?? '')) return false;
  const sig = Buffer.from(signature, 'hex');
  if (createHash('sha256').update(sig).digest('hex') !== randomness) return false;
  if (!keys.has(B.publicKey)) keys.set(B.publicKey, Buffer.from(B.publicKey, 'hex'));
  const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(round));
  try { return S.verify(sig, S.hash(createHash('sha256').update(m).digest(), DST), keys.get(B.publicKey)); } catch { return false; }
}

// The earliest and latest reading times (ms), as the recorders save and fill the run's rounds.
export function timeSpan(readings) {
  const ts = readings.map((r) => Date.parse(r?.t)).filter(Number.isFinite);
  return [Math.min(...ts), Math.max(...ts)];
}

// The rounds a run needs: every round from its first reading to its last (as the recorders keep them).
const roundAtMs = (B, ms) => Math.floor((ms / 1000 - B.genesis) / B.period) + 1;
export function neededRounds(B, run) {
  const rd = run.readings ?? [];
  if (!rd.length) return [];
  // Every reading's time must parse: a file with bad times can't vouch for its rounds. The range runs from
  // the earliest to the latest (a recorder can log a reading out of order after a reconnect).
  const ts = rd.map((r) => Date.parse(r?.t));
  if (ts.some((t) => !Number.isFinite(t))) throw new Error('a reading with a bad time: refused');
  const a = roundAtMs(B, Math.min(...ts)), b = roundAtMs(B, Math.max(...ts));
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
// The rounds a run file lacks or holds unverified: [] means its glances can be trusted. Judges check
// this before attesting (call-v3.mjs), so a missing or forged round can't pass as "no glance".
export function beaconGaps(B, run) {
  return neededRounds(B, run).filter((r) => !verifyRound(B, r, run.beacon?.[r], run.beaconSignatures?.[r]));
}
// The beacon a judge trusts: from its own sealed rules.json only, never from the run file. A run file
// that embeds rules (watch.mjs does) must carry the very same beacon, or it's refused.
export function trustedBeacon(sealedRules, run) {
  const B = sealedRules?.glance?.beacon ?? null;
  if (run?.rules && JSON.stringify(run.rules.glance?.beacon ?? null) !== JSON.stringify(B)) {
    throw new Error("the run file's rules name a different beacon (or none) than the sealed rules.json: refused");
  }
  return B;
}

// Fetch (and verify) the given rounds from the beacon's history. Returns { round: { randomness, signature } }.
export async function fetchRounds(B, rounds) {
  const got = {};
  for (let i = 0; i < rounds.length; i += 10) {
    await Promise.all(rounds.slice(i, i + 10).map(async (r) => {
      for (const u of B.urls) {
        try {
          const res = await fetch(`${u}/${B.chain}/public/${r}`, { signal: AbortSignal.timeout(8000) });
          if (!res.ok) continue;
          const j = await res.json();
          if (j.round === r && verifyRound(B, r, j.randomness, j.signature)) { got[r] = { randomness: j.randomness, signature: j.signature }; return; }
        } catch { /* the next endpoint */ }
      }
    }));
  }
  return got;
}

//   node beacon.mjs <run file>          check: exits 1 if any round is missing or doesn't verify
//   node beacon.mjs <run file> --fill   fetch those rounds from the beacon's history, judge the run again
//                                       (judge.mjs, central-grid.json beside this file) and rewrite it
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const fs = await import('node:fs');
  const file = process.argv[2], fill = process.argv.includes('--fill');
  if (!file) { console.error('usage: node beacon.mjs <run file> [--fill]'); process.exit(2); }
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rules = JSON.parse(fs.readFileSync(new URL('./rules.json', import.meta.url), 'utf8')); // the sealed rules beside this file
  const B = trustedBeacon(rules, run);
  if (!B) { console.log('no beacon in these rules'); process.exit(0); }
  let gaps = beaconGaps(B, run);
  console.log(`${neededRounds(B, run).length} rounds needed, ${gaps.length} missing or unverified`);
  if (gaps.length && fill) {
    const got = await fetchRounds(B, gaps);
    run.beacon = { ...(run.beacon ?? {}) }; run.beaconSignatures = { ...(run.beaconSignatures ?? {}) };
    for (const [r, v] of Object.entries(got)) { run.beacon[r] = v.randomness; run.beaconSignatures[r] = v.signature; }
    gaps = beaconGaps(B, run);
    if (gaps.length) { console.log(`still ${gaps.length} missing: try again later`); process.exit(1); }
    const { judge } = await import('./judge.mjs');
    const grid = JSON.parse(fs.readFileSync(new URL('./central-grid.json', import.meta.url), 'utf8'));
    const before = run.result?.status;
    run.result = judge(rules, run, { grid });
    fs.copyFileSync(file, `${file}.before-fill`);
    fs.writeFileSync(file, JSON.stringify(run) + '\n');
    console.log(`filled and judged again: ${before} -> ${run.result.status} (the old file: ${file}.before-fill)`);
  }
  process.exit(gaps.length ? 1 : 0);
}
