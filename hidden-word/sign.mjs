// Sign a message with your wallet's unshielded key, to prove you control its address.
// Free: nothing is sent and the wallet doesn't sync.
//
//   node sign.mjs "<message>"
//
// Prints your address, your public key and the signature. Anyone can check them with
// verify.mjs. The secret comes from MIDNIGHT_SEED or MIDNIGHT_MNEMONIC in the environment.
import { buildWallet, walletSecret } from './lib/midnight.mjs';

// Quote one argument for a POSIX shell, so the printed command is safe to paste
// whatever the message contains.
const shellQuote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === '') {
  console.error('Usage: node sign.mjs "<message>"');
  process.exit(2);
}
const [message] = args;

try {
  const w = await buildWallet(walletSecret());
  // The ledger's key, address and signature types are all hex strings.
  const address = w.keystore.getBech32Address().asString();
  const key = w.keystore.getPublicKey();
  const signature = w.keystore.signData(new TextEncoder().encode(message));
  if (typeof key !== 'string' || typeof signature !== 'string') throw new Error('unexpected key or signature type');

  console.log(`Address:   ${address}`);
  console.log(`Message:   ${message}`);
  console.log(`Key:       ${key}`);
  console.log(`Signature: ${signature}`);
  console.log('');
  console.log('Anyone can check it with:');
  console.log(`  node verify.mjs ${[address, message, key, signature].map(shellQuote).join(' ')}`);
} catch (e) {
  console.error(`Signing failed: ${e?.message ?? e}`);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
