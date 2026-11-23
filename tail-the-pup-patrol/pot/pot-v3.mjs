// Helpers for the v3 pot (contract/tail-pot-v3.compact): a free contest whose pot is filled by a
// sponsor auction. The outcome a judge attests (the pot goes to the highest-ranked finisher with a
// wallet of its own), the auction's reserve and minimum raise from NIGHT's price, and the records a
// judge keeps. Load with TAIL_POT_CONTRACT=tail-pot-v3 (call-v3.mjs and deploy-v3.mjs set it).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addressBytes, bytes, feeFor, hex, sha, ZERO, walletList } from './pot-v2.mjs';
import { tieWinners } from './ties.mjs';

export { addressBytes, bytes, hex, sha, ZERO, walletList, NIGHT_UNIT, SLOTS, slotOf, runsOn } from './pot-v2.mjs';
export { loadContract } from './lib/midnight.mjs';

// The auction's dollar amounts (V3.md): a $5 reserve and a $1 minimum raise, both priced in tNIGHT
// at NIGHT's price when the run opens.
export const RESERVE_USD = 5;
export const STEP_USD = 1;
export const SHARE_DIVISOR = 10n; // the operator's share: a tenth of the winning bid

// The reserve and minimum raise at one price (CoinGecko now, or `override` for tests).
export async function auctionPrices(override = null) {
  const one = await feeFor(STEP_USD, override);
  const reserve = BigInt(Math.round((RESERVE_USD / one.priceUsd) * 1_000_000));
  return { reserve, step: one.fee, priceUsd: one.priceUsd, source: one.source, at: one.at, reserveUsd: RESERVE_USD, stepUsd: STEP_USD };
}

// The v3 deployment: deployment-v3.json here, or TAIL_POT_DEPLOYMENT.
export const DEPLOYMENT_V3 = process.env.TAIL_POT_DEPLOYMENT ?? fileURLToPath(new URL('./deployment-v3.json', import.meta.url));
export const deploymentV3 = () => (existsSync(DEPLOYMENT_V3) ? JSON.parse(readFileSync(DEPLOYMENT_V3, 'utf8')) : null);
// Atomic: the contract is already on chain when this is written; a torn file would hide its address.
export const saveDeploymentV3 = (d) => { writeFileSync(`${DEPLOYMENT_V3}.tmp`, JSON.stringify(d, null, 1)); renameSync(`${DEPLOYMENT_V3}.tmp`, DEPLOYMENT_V3); };

// The v3 outcome a judge attests for a run, from its own recording: kind 0 a valid run, 1 cancelled
// or void. The pot winner is the highest-ranked agent who tailed to the end with a wallet it published
// itself (external_display) in the city's list now; never the organizer's agent (by its agent id, from
// the deployment, and by the operator's address: it races but never takes the pot; the next such
// finisher does). With several, the first sorted,
// so two judges reading the same list pick the same one.
export async function outcomeV3(raceId, run, operatorAddress, organizerAgentId = null) {
  if (!/^mn_addr_preview1[0-9a-z]+$/.test(String(operatorAddress ?? ''))) throw new Error('outcome: no operator address in the deployment');
  // The organizer's agent id must be known (deployment-v3.json), so it's passed over whatever wallets it
  // lists; only a rehearsal on a test pot may go without (TAIL_POT_NO_ORGANIZER=1).
  if (!organizerAgentId && process.env.TAIL_POT_NO_ORGANIZER !== '1') throw new Error("outcome: no organizer agent id in the deployment (deploy-v3.mjs's last argument)");
  const v = run.result;
  const kind = v.status === 'finished' ? 0n : (v.status === 'cancelled' || v.status === 'void') ? 1n : null;
  if (kind === null) throw new Error(`run ${raceId} is ${v.status}: not judged yet`);
  const ranked = (v.players ?? []).map((p) => [p.id, p.status]);
  const race = sha(raceId);
  const op = String(operatorAddress ?? '').toLowerCase();
  let winner = ZERO, winnerId = null, winnerAddress = null;
  const skipped = [];
  // v4 (Season 3): every eligible finisher in a true tie with the best one shares the pot. A true tie is
  // the same mean tail and seconds seen (as the judge rounds them); agents sharing a wallet are one winner.
  const v4 = process.env.TAIL_POT_CONTRACT === 'tail-pot-v4';
  const group = []; // [{ id, wallets }] in the judge's order: every eligible tied finisher
  if (kind === 0n) {
    const list = await walletList();
    const decoded = (a) => { try { return addressBytes(a); } catch { return null; } };
    let best = null;
    for (const p of v.players ?? []) {
      if (p.status !== 'tailed to the end') continue;
      if (best && !(p.meanTail === best.meanTail && p.seenSeconds === best.seenSeconds)) break; // past the tie
      if (organizerAgentId && p.id === organizerAgentId) { skipped.push([p.id, 'organizer']); continue; }
      const own = list.filter((w) => w.agentId === p.id && w.network === 'midnight-preview' && w.walletKind === 'external_display' && w.unshieldedAddress)
        .map((w) => w.unshieldedAddress.toLowerCase()).filter((a) => decoded(a) !== null).sort();
      if (!own.length) { skipped.push([p.id, 'no-wallet']); continue; }
      if (own.includes(op)) { skipped.push([p.id, 'organizer']); continue; }
      if (!v4) { winnerId = p.id; winnerAddress = own[0]; winner = addressBytes(own[0]); break; }
      best ??= p;
      group.push({ id: p.id, wallets: own });
    }
  }
  if (v4) {
    // Agents sharing any wallet are one winner (ties.mjs).
    const ws = tieWinners(group);
    const o = { race, result: sha(JSON.stringify(ranked)), kind, winners: BigInt(ws.length),
      winner: [...ws.map((w) => addressBytes(w.address)), ...Array(5 - ws.length).fill(ZERO)], successor: ZERO };
    return { o, ranked, winnerId: ws[0]?.id ?? null, winnerAddress: ws[0]?.address ?? null, winners: ws, kind, skipped };
  }
  const o = { race, result: sha(JSON.stringify(ranked)), kind, hasWinner: !!winnerAddress, winner, successor: ZERO };
  return { o, ranked, winnerId, winnerAddress, kind, skipped };
}

// What a judge keeps on its machine, under outcomes-v3/<contract>/: the outcome it attested (so a
// settle uses exactly what was agreed, with the pot winner's agent id and who was passed over, for
// the site's record) and the runs it opened (start, reserve, raise and the price they came from).
const OUT = fileURLToPath(new URL('./outcomes-v3/', import.meta.url));
const write = (f, data) => { writeFileSync(`${f}.tmp`, JSON.stringify(data, null, 1)); renameSync(`${f}.tmp`, f); };
export function saveOutcomeV3(contract, raceId, o, extra = {}) {
  mkdirSync(`${OUT}${contract}`, { recursive: true });
  const w = 'winners' in o ? { winners: String(o.winners), winner: o.winner.map(hex) } : { hasWinner: o.hasWinner, winner: hex(o.winner) };
  write(`${OUT}${contract}/${raceId}.json`, { race: hex(o.race), result: hex(o.result), kind: String(o.kind), ...w, successor: hex(o.successor), ...extra });
}
export function savedOutcomeV3(contract, raceId) {
  const f = `${OUT}${contract}/${raceId}.json`;
  if (!existsSync(f)) return null;
  const s = JSON.parse(readFileSync(f, 'utf8'));
  const w = 'winners' in s ? { winners: BigInt(s.winners), winner: s.winner.map(bytes) } : { hasWinner: s.hasWinner, winner: bytes(s.winner) };
  return { race: bytes(s.race), result: bytes(s.result), kind: BigInt(s.kind), ...w, successor: bytes(s.successor) };
}
export function savedExtraV3(contract, raceId) {
  try { const s = JSON.parse(readFileSync(`${OUT}${contract}/${raceId}.json`, 'utf8')); return { winnerId: s.winnerId ?? null, winnerIds: s.winnerIds ?? (s.winnerId ? [s.winnerId] : []), skipped: s.skipped ?? [] }; } catch { return { winnerId: null, winnerIds: [], skipped: [] }; }
}
export function openedRunsV3(contract) {
  try { return JSON.parse(readFileSync(`${OUT}${contract}/opened.json`, 'utf8')); } catch { return {}; }
}
export function saveOpenedRunV3(contract, raceId, info) {
  mkdirSync(`${OUT}${contract}`, { recursive: true });
  write(`${OUT}${contract}/opened.json`, { ...openedRunsV3(contract), [raceId]: info });
}

// A banner link: an https URL, at most 96 bytes, zero-padded on chain.
export const LINK_BYTES = 96;
export function linkBytes(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:') throw new Error('the banner link must be https');
  if (u.username || u.password) throw new Error('the banner link must not carry credentials');
  if (u.port && u.port !== '443') throw new Error('the banner link must use the standard https port');
  const b = new TextEncoder().encode(u.href);
  if (b.length > LINK_BYTES) throw new Error(`the banner link is ${b.length} bytes: at most ${LINK_BYTES}`);
  const out = new Uint8Array(LINK_BYTES); out.set(b); return out;
}
export const linkText = (b) => new TextDecoder().decode(b).replace(/\0+$/, '');
