// Network config, the compiled contract, and wallet plumbing shared by the scripts.
// Midnight Preview (testnet) only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { DustSecretKey, LedgerParameters, ZswapSecretKeys } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { FluentWalletBuilder, MidnightWalletProvider, WalletFactory } from '@midnight-ntwrk/testkit-js';
import { DustWallet, InMemoryTransactionHistoryStorage, ShieldedWallet, UnshieldedWallet, WalletEntrySchema, createKeystore, mergeWalletEntries } from '@midnightntwrk/wallet-sdk';

// The indexer client needs a global WebSocket.
globalThis.WebSocket = WebSocket;

export const NETWORK = 'preview';
export const CONFIG = {
  networkId: NETWORK,
  indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preview.midnight.network',
  nodeWS: 'wss://rpc.preview.midnight.network',
  proofServer: process.env.MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6301',
  faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
};

// The chain's own time (the latest block's), so a wrong local clock can't make a
// window look over, or the reverse. Falls back to the local clock.
export async function chainTime() {
  try {
    const res = await fetch(CONFIG.indexer, {
      signal: AbortSignal.timeout(15000),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: '{ block { timestamp } }' }),
    });
    // Preview's indexer gives milliseconds. Anything below 1e12 would be seconds.
    const t = (await res.json())?.data?.block?.timestamp;
    if (typeof t === 'number' && t > 0) return new Date(t < 1e12 ? t * 1000 : t);
  } catch {
    // fall through
  }
  return new Date();
}

const here = path.dirname(fileURLToPath(import.meta.url));
// Which pot contract: tail-pot (v1), tail-pot-v2 or tail-pot-v3. TAIL_POT_CONTRACT picks.
export const CONTRACT = process.env.TAIL_POT_CONTRACT ?? 'tail-pot';
if (!/^(tail-pot(-v[234])?|sponsor-slots)$/.test(CONTRACT)) throw new Error('TAIL_POT_CONTRACT must be tail-pot, tail-pot-v2, tail-pot-v3, tail-pot-v4 or sponsor-slots');
export const zkConfigPath = path.resolve(here, '..', 'contract', 'managed', CONTRACT);
export const PRIVATE_STATE_ID = 'TailPotState';

export async function loadContract() {
  const mod = await import(path.join(zkConfigPath, 'contract', 'index.js')).catch(() => {
    throw new Error('The contract is not compiled yet. Run: npm run compile');
  });
  const compiled = CompiledContract.make('TailPotContract', mod.Contract).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );
  return { ...mod, compiled };
}

export const NIGHT_HEX = '0'.repeat(64);

export function publicData() {
  return indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS);
}

const env = {
  walletNetworkId: CONFIG.networkId,
  networkId: CONFIG.networkId,
  indexer: CONFIG.indexer,
  indexerWS: CONFIG.indexerWS,
  node: CONFIG.node,
  nodeWS: CONFIG.nodeWS,
  faucet: CONFIG.faucet,
  proofServer: CONFIG.proofServer,
};

// DUST added to the wallet's own fee estimate, in specks (TAIL_POT_FEE_OVERHEAD). For contract calls
// that take tNIGHT (v2 enter and sponsor) the estimate can come out far too low, and the node then
// rejects the transaction as underpaid (Custom error 138): call-v2.mjs adds 0.5 DUST.
const DUST_OPTIONS = {
  ledgerParams: LedgerParameters.initialParameters(),
  additionalFeeOverhead: BigInt(process.env.TAIL_POT_FEE_OVERHEAD ?? 1_000),
  feeBlocksMargin: 5,
};

// Build an un-started wallet from the secret: fresh (a full sync, minutes on Preview), or from a state
// saved after an earlier sync (saveWalletState), which then only catches up on the blocks since. A
// restored wallet is put together exactly as the builder puts a fresh one together (its configuration,
// fork schedule and dust options), only from the saved state instead of the start.
export async function buildWallet(secret, saved = null) {
  const base = FluentWalletBuilder.forEnvironment(env).withDustOptions(DUST_OPTIONS);
  const builder = secret.kind === 'mnemonic' ? base.withMnemonic(secret.value) : base.withSeed(secret.value);
  let wallet, seeds, keystore;
  if (saved) {
    // The builder's own configuration, seeds and network (public fields of testkit-js 5's builder, which
    // build() itself uses). If a later version changes them, this throws and the caller syncs afresh.
    const { config, seeds: s, networkId } = builder;
    if (!config?.forks || !s?.shielded || !s?.unshielded || !s?.dust || !networkId) throw new Error("the wallet builder doesn't expose its configuration: can't restore");
    seeds = s;
    keystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, networkId);
    const shielded = ShieldedWallet(config).restore(saved.shielded);
    const unshielded = UnshieldedWallet({ ...config, txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries) }).restore(saved.unshielded);
    const dust = DustWallet({ ...config, costParameters: { ...DUST_OPTIONS } }).restore(saved.dust);
    wallet = await WalletFactory.createWalletFacade(config, shielded, unshielded, dust);
  } else {
    ({ wallet, seeds, keystore } = await builder.buildWithoutStarting());
  }
  // The test kit's provider balances and submits across ledger eras (v8/v9).
  // withWallet, unlike build, never logs the seed.
  const quiet = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return quiet; } };
  const provider = await MidnightWalletProvider.withWallet(quiet, env, wallet, seeds, keystore);
  return {
    wallet,
    keystore,
    seeds,
    provider,
    zswapSecretKeys: ZswapSecretKeys.fromSeed(seeds.shielded),
    dustSecretKey: DustSecretKey.fromSeed(seeds.dust),
  };
}

function complete(progress) {
  return typeof progress?.isStrictlyComplete === 'function' && progress.isStrictlyComplete();
}

// Start the wallet and wait until it has caught up with the chain (about 2 minutes on Preview from
// scratch). timeoutMs: give up (throws) after that long.
export async function startAndSync(w, log = console.log, timeoutMs = 0) {
  await w.wallet.start(w.seeds);
  log('Syncing your wallet with Midnight Preview...');
  const started = Date.now();
  let last = 0;
  const synced = w.wallet.state().pipe(
    Rx.tap(() => {
      const mins = Math.floor((Date.now() - started) / 60_000);
      if (mins > last) {
        last = mins;
        log(`  still syncing (${mins} min)...`);
      }
    }),
    Rx.filter((s) => complete(s.shielded.progress) && complete(s.unshielded.progress) && complete(s.dust.progress)),
  );
  const state = await Rx.firstValueFrom(timeoutMs ? synced.pipe(Rx.timeout({ first: timeoutMs })) : synced);
  log(`Wallet synced in ${Math.round((Date.now() - started) / 1000)}s.`);
  return state;
}

// The wallet's state as saved after a sync, for buildWallet(secret, saved) next time. It holds the
// wallets' coins, keys' public parts and sync position (no seed: the keys come from the secret at start).
export async function saveWalletState(w) {
  const [shielded, unshielded, dust] = await Promise.all([w.wallet.shielded.serializeState(), w.wallet.unshielded.serializeState(), w.wallet.dust.serializeState()]);
  return { v: 1, network: NETWORK, shielded, unshielded, dust };
}

export function nightOf(state) {
  return BigInt(state.unshielded.balances[NIGHT_HEX] ?? 0n);
}

// The wallet and midnight providers midnight-js needs, backed by this wallet.
// Balancing signs any unshielded inputs it adds; without that the node rejects
// the transaction (Custom error 192).
export function walletProvider(w) {
  return w.provider;
}

export function providers(w) {
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const wp = walletProvider(w);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'tail-pot-kit',
      // The store holds nothing secret (the pot keeps no private state), but the SDK
      // requires a password with at least 3 kinds of character.
      privateStoragePasswordProvider: () => 'Tail-Pot-Kit-Store-1',
      accountId: w.zswapSecretKeys.coinPublicKey,
    }),
    config: { networkId: NETWORK, ttlSeconds: 3600 },
    publicDataProvider: publicData(),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(CONFIG.proofServer, zkConfigProvider),
    walletProvider: wp,
    midnightProvider: wp,
  };
}

export const hex = (b) => Buffer.from(b).toString('hex');
