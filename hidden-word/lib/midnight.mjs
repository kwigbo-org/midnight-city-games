// Network config, the compiled contract, and wallet plumbing shared by the scripts.
// Midnight Preview (testnet) only.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { DustSecretKey, LedgerParameters, ZswapSecretKeys } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { ttlOneHour } from '@midnight-ntwrk/midnight-js-utils';
import { FluentWalletBuilder } from '@midnight-ntwrk/testkit-js';
import {
  DustWallet, InMemoryTransactionHistoryStorage, ShieldedWallet, UnshieldedWallet, WalletEntrySchema, WalletFacade,
  mergeWalletEntries,
} from '@midnight-ntwrk/wallet-sdk';

// The indexer client needs a global WebSocket.
globalThis.WebSocket = WebSocket;

export const NETWORK = 'preview';
export const CONFIG = {
  networkId: NETWORK,
  indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
  node: 'https://rpc.preview.midnight.network',
  nodeWS: 'wss://rpc.preview.midnight.network',
  proofServer: process.env.MIDNIGHT_PROOF_SERVER ?? 'http://127.0.0.1:6300',
  faucet: 'https://midnight-tmnight-preview.nethermind.dev/',
};
setNetworkId(NETWORK);

// The proof server sees the answer while it proves, so it should run on this
// machine. Say so plainly if MIDNIGHT_PROOF_SERVER points anywhere else.
export function proofServerIsLocal() {
  const host = new URL(CONFIG.proofServer).hostname;
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);
}

// The chain's own time (the latest block's), so a wrong local clock can't make a
// running hunt look over, or the reverse. Falls back to the local clock.
export async function chainTime() {
  try {
    const res = await fetch(CONFIG.indexer, {
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
export const zkConfigPath = path.resolve(here, '..', 'contract', 'managed', 'hidden-word');
export const PRIVATE_STATE_ID = 'HiddenWordState';

export async function loadContract() {
  const mod = await import(path.join(zkConfigPath, 'contract', 'index.js')).catch(() => {
    throw new Error('The contract is not compiled yet. Run: npm run compile');
  });
  const compiled = CompiledContract.make('HiddenWordContract', mod.Contract).pipe(
    CompiledContract.withVacantWitnesses,
    CompiledContract.withCompiledFileAssets(zkConfigPath),
  );
  return { ...mod, compiled };
}

export const NIGHT_HEX = '0'.repeat(64);

export function publicData() {
  return indexerPublicDataProvider(CONFIG.indexer, CONFIG.indexerWS);
}

export async function readHunt(address) {
  const { ledger } = await loadContract();
  const state = await publicData().queryContractState(address);
  if (!state) throw new Error(`No contract found at ${address} on ${NETWORK}.`);
  return ledger(state.data);
}

// The wallet secret comes from the environment, never from the command line,
// so it stays out of shell history.
export function walletSecret() {
  const seed = process.env.MIDNIGHT_SEED?.trim();
  const mnemonic = process.env.MIDNIGHT_MNEMONIC?.trim();
  if (seed && mnemonic) throw new Error('Set MIDNIGHT_SEED or MIDNIGHT_MNEMONIC, not both.');
  if (seed) {
    if (!/^[0-9a-f]{64}$/i.test(seed)) throw new Error('MIDNIGHT_SEED must be 64 hex characters.');
    return { kind: 'seed', value: seed };
  }
  if (mnemonic) return { kind: 'mnemonic', value: mnemonic };
  throw new Error('Set MIDNIGHT_SEED (64 hex characters) or MIDNIGHT_MNEMONIC (your recovery words).');
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

const DUST_OPTIONS = {
  ledgerParams: LedgerParameters.initialParameters(),
  additionalFeeOverhead: 1_000n,
  feeBlocksMargin: 5,
};

// The same wallet configuration the builder derives from `env`, for restoring.
function walletConfig() {
  return {
    indexerClientConnection: { indexerHttpUrl: CONFIG.indexer, indexerWsUrl: CONFIG.indexerWS },
    provingServerUrl: new URL(CONFIG.proofServer),
    networkId: NETWORK,
    relayURL: new URL(CONFIG.nodeWS),
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    costParameters: { feeBlocksMargin: 5 },
  };
}

// A wallet's synced state is saved here after each sync, so the next run only
// catches up from where it left off. It holds the wallet's keys and coins: keep it
// private like the seed. Deleting it is always safe; the next run syncs in full.
const stateDir = path.resolve(here, '..', 'wallet-state');
const stateFile = (keystore) =>
  path.join(stateDir, `${createHash('sha256').update(keystore.getBech32Address().asString()).digest('hex').slice(0, 16)}.json`);

function readSavedState(file) {
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    return saved?.version === 1 && saved.network === NETWORK ? saved : null;
  } catch {
    return null;
  }
}

function restoredWallet(saved) {
  const config = walletConfig();
  const shielded = ShieldedWallet(config).restore(saved.shielded);
  const unshielded = UnshieldedWallet(config).restore(saved.unshielded);
  const dust = DustWallet({ ...config, costParameters: DUST_OPTIONS }).restore(saved.dust);
  return WalletFacade.init({ configuration: config, shielded: () => shielded, unshielded: () => unshielded, dust: () => dust });
}

// Build an un-started wallet from the secret, restoring its saved state if there is any.
export async function buildWallet(secret) {
  const base = FluentWalletBuilder.forEnvironment(env).withDustOptions(DUST_OPTIONS);
  const builder = secret.kind === 'mnemonic' ? base.withMnemonic(secret.value) : base.withSeed(secret.value);
  const { wallet: fresh, seeds, keystore } = await builder.buildWithoutStarting();
  const file = stateFile(keystore);
  const saved = readSavedState(file);
  let wallet = fresh;
  if (saved) {
    try {
      wallet = await restoredWallet(saved);
    } catch (e) {
      console.log(`Saved wallet state not usable (${e?.message ?? e}); syncing in full.`);
    }
  }
  return {
    wallet,
    keystore,
    stateFile: file,
    restored: wallet !== fresh,
    zswapSecretKeys: ZswapSecretKeys.fromSeed(seeds.shielded),
    dustSecretKey: DustSecretKey.fromSeed(seeds.dust),
  };
}

// Save the wallet's synced state for the next run. A failure only costs speed.
export async function saveWalletState(w) {
  try {
    const saved = {
      version: 1,
      network: NETWORK,
      shielded: await w.wallet.shielded.serializeState(),
      unshielded: await w.wallet.unshielded.serializeState(),
      dust: await w.wallet.dust.serializeState(),
    };
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const tmp = `${w.stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(saved), { mode: 0o600 });
    renameSync(tmp, w.stateFile);
  } catch (e) {
    console.log(`Could not save the wallet state (${e?.message ?? e}); the next run syncs in full.`);
  }
}

function complete(progress) {
  return typeof progress?.isStrictlyComplete === 'function' && progress.isStrictlyComplete();
}

// Start the wallet and wait until it has caught up with the chain. A wallet's
// first sync on Preview can take half an hour or more. After that, its saved state
// means a run only catches up on new blocks.
export async function startAndSync(w, log = console.log) {
  await w.wallet.start(w.zswapSecretKeys, w.dustSecretKey);
  log(w.restored
    ? 'Catching your wallet up with Midnight Preview from its saved state...'
    : 'Syncing your wallet with Midnight Preview. The first sync can take a long time...');
  const started = Date.now();
  let last = 0;
  const state = await Rx.firstValueFrom(
    w.wallet.state().pipe(
      Rx.tap(() => {
        const mins = Math.floor((Date.now() - started) / 60_000);
        if (mins > last) {
          last = mins;
          log(`  still syncing (${mins} min)...`);
        }
      }),
      Rx.filter((s) => complete(s.shielded.state.progress) && complete(s.unshielded.progress) && complete(s.dust.state.progress)),
    ),
  );
  log(`Wallet synced in ${Math.round((Date.now() - started) / 1000)}s.`);
  await saveWalletState(w);
  return state;
}

export function nightOf(state) {
  return BigInt(state.unshielded.balances[NIGHT_HEX] ?? 0n);
}

// The wallet and midnight providers midnight-js needs, backed by this wallet.
// Balancing signs any unshielded inputs it adds; without that the node rejects
// the transaction (Custom error 192).
export function walletProvider(w) {
  return {
    getCoinPublicKey: () => w.zswapSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => w.zswapSecretKeys.encryptionPublicKey,
    async balanceTx(tx, ttl = ttlOneHour()) {
      const recipe = await w.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: w.zswapSecretKeys, dustSecretKey: w.dustSecretKey },
        { ttl },
      );
      const signed = await w.wallet.signRecipe(recipe, (payload) => w.keystore.signData(payload));
      return w.wallet.finalizeRecipe(signed);
    },
    submitTx: (tx) => w.wallet.submitTransaction(tx),
  };
}

export function providers(w) {
  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const wp = walletProvider(w);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'hidden-word-kit',
      // The store holds nothing secret (the hunt keeps no private state), but the SDK
      // requires a password with at least 3 kinds of character.
      privateStoragePasswordProvider: () => 'Hidden-Word-Kit-1',
      accountId: w.zswapSecretKeys.coinPublicKey,
    }),
    publicDataProvider: publicData(),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(CONFIG.proofServer, zkConfigProvider),
    walletProvider: wp,
    midnightProvider: wp,
  };
}

export const hex = (b) => Buffer.from(b).toString('hex');
