// Sign up for the current hunt. Free and offline: nothing is sent and the wallet doesn't sync.
//
//   node signup.mjs "<your name>"
//
// Signs "<hunt> sign-up: <name> | player <commitment>" with your wallet's key. The
// commitment is the contract's playerKey of a secret derived from that same key, so only
// this wallet can ever claim for this sign-up. Paste the whole output into a sign-up
// issue (see the README). The secret comes from MIDNIGHT_SEED or MIDNIGHT_MNEMONIC.
import { SIGNUP, buildWallet, hex, loadContract, playerSecret, walletSecret } from './lib/midnight.mjs';

const shellQuote = (s) => `'${s.replaceAll("'", `'\\''`)}'`;

// The name a winner is listed under: plain, short, one line. The watcher checks the same.
const NAME = /^[\p{L}\p{N} _.'()-]{1,40}$/u;

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: node signup.mjs "<your name>"');
  process.exit(2);
}
const name = args[0].trim();
if (!NAME.test(name)) {
  console.error("The name must be 1 to 40 letters, numbers, spaces or . _ ' ( ) -");
  process.exit(2);
}

try {
  const { pureCircuits } = await loadContract();
  const w = await buildWallet(walletSecret());
  const address = w.keystore.getBech32Address().asString();
  const commitment = hex(pureCircuits.playerKey(playerSecret(w.keystore)));
  const message = `${SIGNUP}: ${name} | player ${commitment}`;
  const key = w.keystore.getPublicKey();
  const signature = w.keystore.signData(new TextEncoder().encode(message));
  if (typeof key !== 'string' || typeof signature !== 'string') throw new Error('unexpected key or signature type');

  console.log(`Address:   ${address}`);
  console.log(`Message:   ${message}`);
  console.log(`Key:       ${key}`);
  console.log(`Signature: ${signature}`);
  console.log('');
  console.log('Paste all four lines above into a sign-up issue. Anyone can check them with:');
  console.log(`  node verify.mjs ${[address, message, key, signature].map(shellQuote).join(' ')}`);
} catch (e) {
  console.error(`Signing up failed: ${e?.message ?? e}`);
  process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);
