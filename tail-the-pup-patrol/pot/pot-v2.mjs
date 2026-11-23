// Helpers for the v2 pot (contract/tail-pot-v2.compact): the outcome a judge attests, the entry fee
// from NIGHT's price, the slots, and the outcomes a judge saved. Load with TAIL_POT_CONTRACT=tail-pot-v2
// (call-v2.mjs and deploy-v2.mjs set it before loading the kit).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { encodeUserAddress } from '@midnight-ntwrk/compact-runtime';
import { NETWORK, loadContract } from './lib/midnight.mjs';

export const bytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));
export const hex = (b) => Buffer.from(b).toString('hex');
export const sha = (s) => new Uint8Array(createHash('sha256').update(s).digest());
export const ZERO = new Uint8Array(32);
export const NIGHT_UNIT = 1_000_000n;

export const addressBytes = (mnAddr) => encodeUserAddress(MidnightBech32m.parse(mnAddr).decode(UnshieldedAddress, NETWORK).hexString);

// Judge slots: A..E are slots 0..4; the keys file holds judgeA..judgeE.
export const SLOTS = ['A', 'B', 'C', 'D', 'E'];
export const slotOf = (letter) => {
  const i = SLOTS.indexOf(letter);
  if (i < 0) throw new Error('a judge slot is A, B, C, D or E');
  return BigInt(i);
};

// The v2 deployment: deployment-v2.json here, or TAIL_POT_DEPLOYMENT.
export const DEPLOYMENT_V2 = process.env.TAIL_POT_DEPLOYMENT ?? fileURLToPath(new URL('./deployment-v2.json', import.meta.url));
export const deploymentV2 = () => (existsSync(DEPLOYMENT_V2) ? JSON.parse(readFileSync(DEPLOYMENT_V2, 'utf8')) : null);
// Atomic: the contract is already on chain when this is written; a torn file would hide its address.
export const saveDeploymentV2 = (d) => { writeFileSync(`${DEPLOYMENT_V2}.tmp`, JSON.stringify(d, null, 1)); renameSync(`${DEPLOYMENT_V2}.tmp`, DEPLOYMENT_V2); };

// The entry fee for a USD amount, at NIGHT's price now: atomic tNIGHT, and the operator's cut (a
// tenth, rounded down). The price comes from CoinGecko's public API; `override` is for tests.
export async function feeFor(usd = 1, override = null) {
  let price = override, source = 'given', at = new Date().toISOString();
  if (price == null) {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=midnight-3&vs_currencies=usd&include_last_updated_at=true',
      { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`price: CoinGecko ${res.status}`);
    const d = (await res.json())?.['midnight-3'];
    price = d?.usd;
    source = 'CoinGecko (midnight-3)';
    if (d?.last_updated_at) at = new Date(d.last_updated_at * 1000).toISOString();
  }
  if (!(typeof price === 'number' && price > 0)) throw new Error('price: no usable NIGHT price');
  const fee = BigInt(Math.round((usd / price) * Number(NIGHT_UNIT)));
  return { fee, cut: fee / 10n, priceUsd: price, usd, source, at };
}

// The city's public wallet list, or TAIL_POT_WALLETS (a saved copy) for rehearsals.
export async function walletList() {
  if (process.env.TAIL_POT_WALLETS) return JSON.parse(readFileSync(process.env.TAIL_POT_WALLETS, 'utf8')).wallets;
  const res = await fetch('https://midnight.city/observer/api/wallets', { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`wallets: the city answered ${res.status}`);
  const list = (await res.json())?.wallets;
  if (!Array.isArray(list)) throw new Error('wallets: no list in the answer');
  return list;
}

// The v2 outcome a judge attests for a run, from its own recording and the pot's entries:
// kind 0 a valid run, 1 cancelled or void; the pot winner is the highest-ranked agent who tailed to
// the end and entered this run from a wallet they published themselves (external_display).
export async function outcomeV2(raceId, run, potLedger, pureCircuits) {
  const v = run.result;
  const kind = v.status === 'finished' ? 0n : (v.status === 'cancelled' || v.status === 'void') ? 1n : null;
  if (kind === null) throw new Error(`run ${raceId} is ${v.status}: not judged yet`);
  const ranked = (v.players ?? []).map((p) => [p.id, p.status]);
  const race = sha(raceId);
  let winner = ZERO, winnerId = null, winnerAddress = null;
  if (kind === 0n) {
    const list = await walletList();
    for (const p of v.players ?? []) {
      if (p.status !== 'tailed to the end') continue;
      const own = list.filter((w) => w.agentId === p.id && w.network === 'midnight-preview' && w.walletKind === 'external_display' && w.unshieldedAddress)
        .map((w) => w.unshieldedAddress.toLowerCase()).sort();
      // An address the city lists that doesn't decode is skipped, not fatal to the whole outcome.
      const decoded = (a) => { try { return addressBytes(a); } catch { return null; } };
      const entered = own.find((a) => { const b = decoded(a); return b !== null && potLedger.entries.member(pureCircuits.pairKey(race, b)); });
      if (entered) { winnerId = p.id; winnerAddress = entered; winner = addressBytes(entered); break; }
    }
  }
  const o = { race, result: sha(JSON.stringify(ranked)), kind, hasWinner: !!winnerAddress, winner, successor: ZERO };
  return { o, ranked, winnerId, winnerAddress, kind };
}

// The outcome a judge attested, saved on its machine (outcomes-v2/<contract>/<run>.json), so a settle
// uses exactly what was agreed. The pot winner's agent id is kept beside it for the site's record
// (the wallet list may change after the judges read it).
const OUT = fileURLToPath(new URL('./outcomes-v2/', import.meta.url));
export function saveOutcomeV2(contract, raceId, o, extra = {}) {
  mkdirSync(`${OUT}${contract}`, { recursive: true });
  const f = `${OUT}${contract}/${raceId}.json`;
  writeFileSync(`${f}.tmp`, JSON.stringify({ race: hex(o.race), result: hex(o.result), kind: String(o.kind), hasWinner: o.hasWinner, winner: hex(o.winner), successor: hex(o.successor), ...extra }));
  renameSync(`${f}.tmp`, f);
}
// The pot winner's agent id as the judge saved it, or null.
export function savedWinnerIdV2(contract, raceId) {
  try { return JSON.parse(readFileSync(`${OUT}${contract}/${raceId}.json`, 'utf8')).winnerId ?? null; } catch { return null; }
}
export function savedOutcomeV2(contract, raceId) {
  const f = `${OUT}${contract}/${raceId}.json`;
  if (!existsSync(f)) return null;
  const s = JSON.parse(readFileSync(f, 'utf8'));
  return { race: bytes(s.race), result: bytes(s.result), kind: BigInt(s.kind), hasWinner: s.hasWinner, winner: bytes(s.winner), successor: bytes(s.successor) };
}

// The runs this machine's judge opened: fee, start, and the price it came from (public record for
// the site). outcomes-v2/<contract>/opened.json
export function openedRuns(contract) {
  try { return JSON.parse(readFileSync(`${OUT}${contract}/opened.json`, 'utf8')); } catch { return {}; }
}
export function saveOpenedRun(contract, raceId, info) {
  mkdirSync(`${OUT}${contract}`, { recursive: true });
  const all = { ...openedRuns(contract), [raceId]: info };
  const f = `${OUT}${contract}/opened.json`;
  writeFileSync(`${f}.tmp`, JSON.stringify(all, null, 1));
  renameSync(`${f}.tmp`, f);
}

// The scheduled runs of a UTC day, from the sealed rules.json this machine runs (TAIL_RULES: the
// site's published copy on the games server, the recorder's on the lab). The same ids as the
// recorder (watch.mjs): <day>T<hhmm>-<kind>; official replaces practice at the same time.
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
export function runsOn(day, rules = JSON.parse(readFileSync(process.env.TAIL_RULES ?? fileURLToPath(new URL('../rules.json', import.meta.url)), 'utf8'))) {
  const date = new Date(`${day}T00:00:00Z`);
  const byAt = new Map();
  for (const r of rules.schedule.runs) {
    if (r.days !== 'daily' && !r.days.split(',').some((x) => DOW[x.trim()] === date.getUTCDay())) continue;
    const at = `${day}T${r.at}:00.000Z`;
    if (!byAt.has(at) || r.kind === 'official') byAt.set(at, { kind: r.kind, at });
  }
  return [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at)).map((r) => ({ id: `${r.at.slice(0, 16).replace(/:/g, '')}-${r.kind}`, start: r.at }));
}

export { loadContract };
