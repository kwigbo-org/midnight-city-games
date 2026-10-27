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
import { answerDigest, normalizeAnswer } from './lib/answer.mjs';
import {
  CONFIG, NETWORK, PRIVATE_STATE_ID, buildWallet, chainTime, hex, loadContract, nightOf, proofServerIsLocal,
  providers, readHunt, startAndSync, walletSecret,
} from './lib/midnight.mjs';

const USAGE = 'Usage: node claim.mjs <contract-address> "<answer>" [--to <mn_addr_preview1...>]';

// A message for the player, not a crash: printed without a stack trace.
class Stop extends Error {}
const stop = (msg) => {
  throw new Stop(msg);
};

function parseArgs(argv) {
  const positional = [];
  let to;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') {
      to = argv[++i];
      if (!to) stop(USAGE);
    } else if (a.startsWith('--to=')) {
      to = a.slice('--to='.length);
      if (!to) stop(USAGE);
    } else if (a.startsWith('--')) {
      stop(`Unknown option ${a}.\n${USAGE}`);
    } else {
      positional.push(a);
    }
  }
  if (positional.length !== 2) stop(USAGE);
  return { address: positional[0], answer: positional[1], to };
}

async function main() {
  const { address, answer, to: toArg } = parseArgs(process.argv.slice(2));
  if (normalizeAnswer(answer) === '') stop('The answer is empty.');

  // 1. Check everything that can be checked without a wallet.
  const { compiled, pureCircuits } = await loadContract();
  const hunt = await readHunt(address);
  const digest = answerDigest(answer);
  if (hunt.claimed) stop('This hunt has already been claimed.');
  if (new Date(Number(hunt.deadline) * 1000) <= (await chainTime())) stop('This hunt is over.');
  if (hex(pureCircuits.phraseHash(digest)) !== hex(hunt.answer)) stop('Wrong answer. Nothing was sent.');
  console.log('Your answer is correct. Preparing the claim...');

  const secret = walletSecret();
  if (!proofServerIsLocal()) {
    console.log(`WARNING: the proof server ${CONFIG.proofServer} is not on this machine. It sees your`);
    console.log('answer while it proves, so only use one you run yourself.');
  }
  const proofServer = await fetch(`${CONFIG.proofServer}/version`).catch(() => null);
  if (!proofServer?.ok) stop(`No proof server at ${CONFIG.proofServer}. See the README to start one.`);

  const w = await buildWallet(secret);
  try {
    // 2. Everything that can fail fast goes before the long sync. This hunt keeps
    //    no private state, so the local store only needs an empty entry for it.
    const p = providers(w);
    p.privateStateProvider.setContractAddress(address);
    await p.privateStateProvider.set(PRIVATE_STATE_ID, {});

    // getAddress() is the wallet's own address as hex, the same form the --to
    // path decodes to.
    let toHex = w.keystore.getAddress();
    if (toArg) {
      try {
        toHex = MidnightBech32m.parse(toArg).decode(UnshieldedAddress, NETWORK).hexString;
      } catch {
        stop(`--to must be a Midnight Preview address (mn_addr_preview1...). Got: ${toArg}`);
      }
    }
    const to = { bytes: encodeUserAddress(toHex) };
    console.log(`The prize goes to: ${toArg ?? w.keystore.getBech32Address()}`);

    // 3. Sync the wallet and make sure it can pay the fee.
    const state = await startAndSync(w);
    if (state.dust.balance(new Date()) === 0n) {
      stop(nightOf(state) > 0n
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
  } finally {
    await w.wallet.stop().catch(() => undefined);
  }
}

try {
  await main();
} catch (e) {
  console.error(e instanceof Stop ? e.message : `The claim failed: ${e?.message ?? e}`);
  process.exitCode = 1;
}
// Open network connections would keep Node alive, so exit once cleanup is done.
process.exit(process.exitCode ?? 0);
