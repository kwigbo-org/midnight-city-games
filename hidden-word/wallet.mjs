// Wallet helpers for the hunt. Midnight Preview (testnet) only.
//
//   node wallet.mjs new        make a new seed (prints it once; keep it safe)
//   node wallet.mjs address    print your Preview address, to fund at the faucet
//   node wallet.mjs status     sync and show your tNIGHT and DUST
//   node wallet.mjs register   register your tNIGHT to generate DUST (for fees)
//
// The secret comes from MIDNIGHT_SEED or MIDNIGHT_MNEMONIC in the environment.
import { randomBytes } from 'node:crypto';
import { unshieldedToken } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { CONFIG, buildWallet, nightOf, startAndSync, walletSecret } from './lib/midnight.mjs';

const cmd = process.argv[2];

if (cmd === 'new') {
  console.log('A new Midnight Preview seed. Anyone with it controls the wallet. Store it');
  console.log('privately, then use it with:  export MIDNIGHT_SEED=<seed>');
  console.log('');
  console.log(randomBytes(32).toString('hex'));
  process.exit(0);
}

if (!['address', 'status', 'register'].includes(cmd)) {
  console.error('Usage: node wallet.mjs new | address | status | register');
  process.exit(2);
}

const w = await buildWallet(walletSecret());
if (cmd === 'address') {
  console.log(`Your Preview address: ${w.keystore.getBech32Address().asString()}`);
  console.log(`Get tNIGHT for it at: ${CONFIG.faucet}`);
  process.exit(0);
}

try {
  const state = await startAndSync(w);
  const dust = state.dust.balance(new Date());
  console.log(`tNIGHT: ${Number(nightOf(state)) / 1e6}`);
  console.log(`DUST:   ${dust > 0n ? 'yes' : 'none'} (${dust} SPECK)`);

  if (cmd === 'register') {
    const unregistered = state.unshielded.availableCoins.filter(
      (c) => c.utxo.type === unshieldedToken().raw && !c.meta.registeredForDustGeneration,
    );
    if (unregistered.length === 0) {
      console.log(nightOf(state) > 0n
        ? 'All your tNIGHT is already registered. DUST builds up over a few minutes.'
        : `No tNIGHT yet. Fund ${w.keystore.getBech32Address().asString()} at ${CONFIG.faucet} first.`);
    } else {
      const recipe = await w.wallet.registerNightUtxosForDustGeneration(
        unregistered,
        w.keystore.getPublicKey(),
        (payload) => w.keystore.signData(payload),
      );
      const tx = await w.wallet.submitTransaction(await w.wallet.finalizeRecipe(recipe));
      console.log(`Registered ${unregistered.length} tNIGHT coin(s) for DUST: tx ${tx}`);
      console.log('DUST builds up over the next few minutes. Check with: node wallet.mjs status');
    }
  }
} catch (e) {
  console.error(`wallet.mjs ${cmd} failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await w.wallet.stop().catch(() => undefined);
}
// Open network connections would keep Node alive, so exit once cleanup is done.
process.exit(process.exitCode ?? 0);
