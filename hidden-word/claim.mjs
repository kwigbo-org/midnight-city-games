// Claim a hunt's prize with your answer. Midnight Preview (testnet) only.
//
//   node claim.mjs <contract-address> "<answer>" [--to <mn_addr_preview1...>]
//
// The prize goes to your own wallet's address unless you give --to. The answer
// is checked against the chain first, so a wrong answer costs nothing. The answer
// stays on your machine: the proof shows you know it without revealing it.
//
// Needs: the wallet secret in MIDNIGHT_SEED or MIDNIGHT_MNEMONIC, DUST in that
// wallet for the fee (see wallet.mjs), and a proof server on localhost:6300.
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { encodeUserAddress } from '@midnight-ntwrk/compact-runtime';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { answerDigest } from './lib/answer.mjs';
import {
  CONFIG, NETWORK, PRIVATE_STATE_ID, buildWallet, hex, loadContract, nightOf, providers, readHunt,
  startAndSync, walletSecret,
} from './lib/midnight.mjs';

const args = process.argv.slice(2);
const toAt = args.indexOf('--to');
const toArg = toAt >= 0 ? args.splice(toAt, 2)[1] : undefined;
const [address, answer] = args;
if (!address || answer === undefined || (toAt >= 0 && !toArg)) {
  console.error('Usage: node claim.mjs <contract-address> "<answer>" [--to <mn_addr_preview1...>]');
  process.exit(2);
}

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// 1. Check everything that can be checked without a wallet.
const { compiled, pureCircuits } = await loadContract();
const hunt = await readHunt(address);
const digest = answerDigest(answer);
if (hunt.claimed) fail('This hunt has already been claimed.');
if (new Date(Number(hunt.deadline) * 1000) < new Date()) fail('This hunt is over.');
if (hex(pureCircuits.phraseHash(digest)) !== hex(hunt.answer)) fail('Wrong answer. Nothing was sent.');
console.log('Your answer is correct. Preparing the claim...');

const secret = walletSecret();
const proofServer = await fetch(`${CONFIG.proofServer}/version`).catch(() => null);
if (!proofServer?.ok) fail(`No proof server at ${CONFIG.proofServer}. See the README to start one.`);

const w = await buildWallet(secret);
try {
  // 2. Set up the providers before the long sync, so a setup problem shows at once.
  //    This hunt keeps no private state, so the local store only needs an empty
  //    entry for it.
  const p = providers(w);
  p.privateStateProvider.setContractAddress(address);
  await p.privateStateProvider.set(PRIVATE_STATE_ID, {});

  let toHex = w.keystore.getAddress();
  if (toArg) {
    try {
      toHex = MidnightBech32m.parse(toArg).decode(UnshieldedAddress, NETWORK).hexString;
    } catch {
      fail(`--to must be a Midnight Preview address (mn_addr_preview1...). Got: ${toArg}`);
    }
  }
  const to = { bytes: encodeUserAddress(toHex) };
  console.log(`The prize goes to: ${toArg ?? w.keystore.getBech32Address()}`);

  // 3. Sync the wallet and make sure it can pay the fee.
  const state = await startAndSync(w);
  if (state.dust.balance(new Date()) === 0n) {
    fail(nightOf(state) > 0n
      ? 'Your wallet has no DUST for the fee yet. Run: node wallet.mjs register, then wait a few minutes.'
      : `Your wallet has no tNIGHT. Fund ${w.keystore.getBech32Address()} at ${CONFIG.faucet}, then run: node wallet.mjs register`);
  }

  // 4. Prove and submit.
  console.log('Proving the claim (about half a minute)...');
  const res = await submitCallTx(p, {
    compiledContract: compiled,
    contractAddress: address,
    privateStateId: PRIVATE_STATE_ID,
    circuitId: 'claim',
    args: [digest, to],
  });
  console.log(`Claimed! Transaction ${res.public.txHash} in block ${res.public.blockHeight}.`);
} catch (e) {
  fail(`The claim failed: ${e?.message ?? e}`);
} finally {
  await w.wallet.stop().catch(() => undefined);
}
process.exit(0);
