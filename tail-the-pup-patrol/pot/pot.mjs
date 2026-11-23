// Shared helpers for the Tail pot rehearsal on Midnight Preview. Keys stay in ~/midnight/keys.
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { encodeUserAddress } from '@midnight-ntwrk/compact-runtime';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { NETWORK, NIGHT_HEX, buildWallet, startAndSync, saveWalletState, providers, loadContract, publicData } from './lib/midnight.mjs';
import { renameSync, rmSync, chmodSync } from 'node:fs';

const H = process.env.HOME;
// Key and wallet files: the lab's defaults, or TAIL_POT_KEYS / TAIL_POT_WALLET (a judge on its own machine).
export const KEYS = () => JSON.parse(readFileSync(process.env.TAIL_POT_KEYS ?? `${H}/midnight/keys/tail-pot-test.json`, 'utf8'));
export const bytes = (hex) => Uint8Array.from(Buffer.from(hex, 'hex'));
export const sha = (s) => new Uint8Array(createHash('sha256').update(s).digest());
export const NIGHT = bytes(NIGHT_HEX);
// The pot contract: deployment.json, or TAIL_POT_DEPLOYMENT for another one (a winner's reserved pot).
export const DEPLOYMENT = process.env.TAIL_POT_DEPLOYMENT ?? fileURLToPath(new URL('./deployment.json', import.meta.url));
export const deployment = () => (existsSync(DEPLOYMENT) ? JSON.parse(readFileSync(DEPLOYMENT, 'utf8')) : null);
export const saveDeployment = (d) => writeFileSync(DEPLOYMENT, JSON.stringify(d, null, 1));
export const PRIVATE_STATE_ID = 'TailPotState';

// The operator's address (the organizer's agent, kwigbo, is paid here): never a pot winner.
export const OPERATOR_ADDRESS = 'mn_addr_preview1s8gdut80rlj03m7h6xctg8sk8ca32msevhzy8zrx0v4dnptmry5s7l454e';

export function addressBytes(mnAddr) {
  return encodeUserAddress(MidnightBech32m.parse(mnAddr).decode(UnshieldedAddress, NETWORK).hexString);
}

// The wallet, synced. Its state is saved after each sync next to its key file (<wallet>.sync.json,
// owner-only: coins and sync position, no seed), so the next start only catches up on the blocks since
// (seconds, not minutes). A saved state that won't restore or catch up within 3 minutes is dropped,
// and the wallet syncs from scratch. TAIL_POT_NO_SAVED_SYNC=1: always from scratch.
export async function walletUp() {
  const walletFile = process.env.TAIL_POT_WALLET ?? `${H}/midnight/keys/carol-preview.json`;
  const seed = JSON.parse(readFileSync(walletFile, 'utf8')).seed;
  const secret = { kind: /^[0-9a-f]{64}$/i.test(seed) ? 'seed' : 'mnemonic', value: seed };
  const stateFile = `${walletFile}.sync.json`;
  let w = null, state = null;
  if (process.env.TAIL_POT_NO_SAVED_SYNC !== '1' && existsSync(stateFile)) {
    try {
      const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (saved?.v !== 1 || saved.network !== NETWORK) throw new Error('saved for another version or network');
      w = await buildWallet(secret, saved);
      state = await startAndSync(w, () => {}, 180_000);
    } catch (e) {
      console.log(`saved wallet state not used (${String(e?.message ?? e).slice(0, 120)}): syncing from scratch`);
      if (w) await w.wallet.stop().catch(() => {});
      w = null;
      rmSync(stateFile, { force: true });
    }
  }
  if (!w) {
    w = await buildWallet(secret);
    state = await startAndSync(w, () => {});
  }
  // Saved before anything is sent: a later start replays whatever this run spends.
  try {
    // A fresh owner-only file each time (a leftover from an interrupted save is cleared first).
    rmSync(`${stateFile}.tmp`, { force: true });
    writeFileSync(`${stateFile}.tmp`, JSON.stringify(await saveWalletState(w)), { mode: 0o600, flag: 'wx' });
    chmodSync(`${stateFile}.tmp`, 0o600);
    renameSync(`${stateFile}.tmp`, stateFile);
  } catch (e) { console.log(`wallet state not saved: ${String(e?.message ?? e).slice(0, 120)}`); }
  const p = providers(w);
  return { w, state, p };
}

// The outcome a judge attests, built from that judge's own race file.
//   race id: e.g. 2026-11-09T2200-practice. result: [[agent id, status], ...] best first.
export async function outcomeOf(raceId, run) {
  const v = run.result;
  const ranked = (v.players ?? []).map((p) => [p.id, p.status]);
  const won = v.status === 'finished' && v.players?.[0]?.status === 'tailed to the end';
  let winner = new Uint8Array(32), winnerAddress = null, winnerId = null, walletKind = null, organizer = false;
  if (won) {
    winnerId = v.players[0].id;
    const list = (await (await fetch('https://midnight.city/observer/api/wallets', { signal: AbortSignal.timeout(30000) })).json()).wallets;
    // The pot pays only a wallet the agent published itself (external_display). A city-held one
    // (managed_custody) may belong to a self-hosted agent that can't use it: never paid.
    const mine = list.filter((x) => x.agentId === winnerId && x.network === 'midnight-preview' && x.unshieldedAddress);
    // Sorted, so two judges reading the same list pick the same one even if it lists several.
    const w = mine.filter((x) => x.walletKind === 'external_display').sort((x, y) => (x.unshieldedAddress < y.unshieldedAddress ? -1 : 1))[0];
    walletKind = w ? w.walletKind : (mine.find((x) => x.walletKind === 'managed_custody') ? 'managed_custody' : null);
    // The organizer's agent races but never takes the pot (operator's decision, 2026-11-13): a winner
    // paid to the operator's own address is no winner, and the pot rolls over.
    if (w && w.unshieldedAddress.toLowerCase() === OPERATOR_ADDRESS) { organizer = true; }
    else if (w) { winnerAddress = w.unshieldedAddress; winner = addressBytes(winnerAddress); }
  }
  const end = BigInt(Math.floor(Date.parse(run.scheduled) / 1000) + 1800);
  const o = { race: sha(raceId), result: sha(JSON.stringify(ranked)), hasWinner: !!winnerAddress, winner, end };
  return { o, winnerId, winnerAddress, walletKind, won, organizer, ranked };
}

import { ContractState } from '@midnight-ntwrk/compact-runtime';
export async function ledgerNow(address) {
  const { ledger } = await loadContract();
  const read = await publicData().queryContractState(address);
  return read ? ledger(read.contractState.deserialize({ v9: ContractState }).data) : null;
}
export { loadContract };

// The pot's tNIGHT balance (atomic units), from the Preview indexer. Throws if it can't tell.
export async function potNight(address) {
  if (!/^[0-9a-f]{64}$/.test(address ?? '')) throw new Error('pot contract address must be 64 hex characters');
  const res = await fetch('https://indexer.preview.midnight.network/api/v4/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ query: `{ contractAction(address: "${address}") { ... on ContractCall { unshieldedBalances { tokenType amount } } ... on ContractDeploy { unshieldedBalances { tokenType amount } } ... on ContractUpdate { unshieldedBalances { tokenType amount } } } }` }),
  });
  if (!res.ok) throw new Error(`indexer ${res.status}`);
  const action = (await res.json())?.data?.contractAction;
  if (!action) throw new Error('pot contract not found');
  return BigInt(action.unshieldedBalances?.find((b) => b.tokenType === NIGHT_HEX)?.amount ?? 0);
}

// The outcome a judge attested, saved on its machine, so a settle uses exactly what was agreed even
// if the city's wallet list has changed since. outcomes/<contract>/<run id>.json (all hex).
const OUTCOMES = fileURLToPath(new URL('./outcomes/', import.meta.url));
export function saveOutcome(contract, raceId, o, reason = null) {
  const dir = `${OUTCOMES}${contract}`;
  mkdirSync(dir, { recursive: true });
  const h = (b) => Buffer.from(b).toString('hex');
  writeFileSync(`${dir}/${raceId}.json`, JSON.stringify({ race: h(o.race), result: h(o.result), hasWinner: o.hasWinner, winner: h(o.winner), end: String(o.end), ...(reason ? { reason } : {}) }));
}
// Why a judge attested no winner for a run someone won ('organizer' or 'no-wallet'), as it saw it then.
export function savedReason(contract, raceId) {
  const f = `${OUTCOMES}${contract}/${raceId}.json`;
  try { return JSON.parse(readFileSync(f, 'utf8')).reason ?? null; } catch { return null; }
}
export function savedOutcome(contract, raceId) {
  const f = `${OUTCOMES}${contract}/${raceId}.json`;
  if (!existsSync(f)) return null;
  const s = JSON.parse(readFileSync(f, 'utf8'));
  return { race: bytes(s.race), result: bytes(s.result), hasWinner: s.hasWinner, winner: bytes(s.winner), end: BigInt(s.end) };
}

// Tonight's race id from the sealed schedule: practice daily at 22:00 UTC, official on Fridays.
export function raceIdFor(date = new Date()) {
  const d = date.toISOString().slice(0, 10);
  return `${d}T2200-${date.getUTCDay() === 5 ? 'official' : 'practice'}`;
}
