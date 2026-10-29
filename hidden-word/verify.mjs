// Check a signature made with sign.mjs: does whoever controls this address say this message?
// Offline: no wallet, no chain.
//
//   node verify.mjs <mn_addr_preview1...> "<message>" <key> <signature>
//
// Exit code: 0 valid, 1 invalid, 2 the check itself failed.
import { addressFromKey, verifySignature } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { NETWORK } from './lib/midnight.mjs';

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4) {
    console.error('Usage: node verify.mjs <mn_addr_preview1...> "<message>" <key> <signature>');
    return 2;
  }
  const [address, message, key, signature] = args;

  let addressHex;
  try {
    addressHex = MidnightBech32m.parse(address).decode(UnshieldedAddress, NETWORK).hexString;
  } catch {
    console.error(`Not a Midnight Preview address: ${address}`);
    return 2;
  }

  // The address is derived from the key, so a key that doesn't give this address
  // belongs to someone else, however good its signature is. A malformed key or
  // signature is not valid; the reason goes to stderr.
  let keyMatches = false;
  let signatureOk = false;
  try {
    keyMatches = addressFromKey(key).toLowerCase() === addressHex.toLowerCase();
  } catch (e) {
    console.error(`Key not readable: ${e?.message ?? e}`);
  }
  try {
    signatureOk = verifySignature(key, new TextEncoder().encode(message), signature);
  } catch (e) {
    console.error(`Signature not readable: ${e?.message ?? e}`);
  }

  console.log(`Address:   ${address}`);
  console.log(`Message:   ${message}`);
  console.log(`Key:       ${keyMatches ? 'belongs to this address' : 'NOT this address\'s key'}`);
  console.log(`Signature: ${signatureOk ? 'valid for this message' : 'NOT valid for this message'}`);
  const ok = keyMatches && signatureOk;
  console.log(ok ? 'VERIFIED: whoever controls this address signed this message.' : 'NOT VERIFIED');
  return ok ? 0 : 1;
}

let code;
try {
  code = main();
} catch (e) {
  console.error(`The check failed: ${e?.message ?? e}`);
  code = 2;
}
process.exit(code);
