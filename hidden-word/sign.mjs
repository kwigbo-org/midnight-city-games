// Sign a message with your wallet's unshielded key, to prove you control its address.
// Free: nothing is sent and the wallet doesn't sync.
//
//   node sign.mjs "<message>"
//
// Prints your address, your public key and the signature. Anyone can check them with
// verify.mjs. The secret comes from MIDNIGHT_SEED or MIDNIGHT_MNEMONIC in the environment.
import { buildWallet, walletSecret } from './lib/midnight.mjs';

const [message] = process.argv.slice(2);
if (!message || process.argv.length !== 3) {
  console.error('Usage: node sign.mjs "<message>"');
  process.exit(2);
}

try {
  const w = await buildWallet(walletSecret());
  const signature = w.keystore.signData(new TextEncoder().encode(message));
  console.log(`Address:   ${w.keystore.getBech32Address().asString()}`);
  console.log(`Message:   ${message}`);
  console.log(`Key:       ${w.keystore.getPublicKey()}`);
  console.log(`Signature: ${signature}`);
  console.log('');
  console.log('Anyone can check it with:');
  console.log(`  node verify.mjs ${w.keystore.getBech32Address().asString()} ${JSON.stringify(message)} ${w.keystore.getPublicKey()} ${signature}`);
} catch (e) {
  console.error(`Signing failed: ${e?.message ?? e}`);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
