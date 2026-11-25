// Wallet status for the pot test: synced balances of the carol test wallet.
// With "fund": asks the Preview faucet if the wallet has no tNIGHT, and registers NIGHT for DUST.
import { readFileSync } from 'node:fs';
import { waitForFunds } from '@midnight-ntwrk/testkit-js';
import { buildWallet, startAndSync, nightOf, CONFIG } from './lib/midnight.mjs';
const seed = JSON.parse(readFileSync(process.env.TAIL_POT_WALLET ?? process.env.HOME + '/midnight/keys/carol-preview.json', 'utf8')).seed;
const w = await buildWallet({ kind: /^[0-9a-f]{64}$/i.test(seed) ? 'seed' : 'mnemonic', value: seed });
let s = await startAndSync(w, console.log);
console.log('address', w.keystore.getBech32Address().asString()); // your own fee wallet: the whole address, to fund it
console.log('tNIGHT atomic', nightOf(s).toString(), '| DUST', s.dust.balance(new Date()).toString());
if (process.argv[2] === 'fund') {
  const env = { ...CONFIG, walletNetworkId: CONFIG.networkId };
  console.log('night after waitForFunds', (await waitForFunds(w.wallet, env, true, w.keystore)).toString());
  s = await startAndSync(w, () => {});
  console.log('tNIGHT atomic', nightOf(s).toString(), '| DUST', s.dust.balance(new Date()).toString());
}
await w.wallet.stop().catch(() => {});
process.exit(0);
