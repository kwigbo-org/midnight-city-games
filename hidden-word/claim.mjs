// Claim a hunt's prize with your answer. Midnight Preview (testnet) only.
//
//   node claim.mjs <contract-address> "<answer>"
//
// The prize goes to your own wallet, which must be signed up (see the README's "Sign
// up"). The answer is checked against the chain first, so a wrong answer costs
// nothing. The answer and your player secret stay on your machine: the proof shows
// you know them without revealing them.
//
// Needs: the wallet secret in MIDNIGHT_SEED or MIDNIGHT_MNEMONIC, DUST in that
// wallet for the fee (see wallet.mjs), and a proof server on localhost:6300.
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { encodeUserAddress } from '@midnight-ntwrk/compact-runtime';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { answerDigest, normalizeAnswer } from './lib/answer.mjs';
import {
  CONFIG, NETWORK, PRIVATE_STATE_ID, buildWallet, chainTime, hex, loadContract, nightOf, playerSecret, proofServerIsLocal,
  providers, readHunt, startAndSync, walletSecret,
} from './lib/midnight.mjs';

const USAGE = 'Usage: node claim.mjs <contract-address> "<answer>"';

// A message for the player, not a crash: printed without a stack trace.
class Stop extends Error {}
const stop = (msg) => {
  throw new Stop(msg);
};

function parseArgs(argv) {
  const opt = argv.find((a) => a.startsWith('--'));
  if (opt) stop(opt === '--to' || opt.startsWith('--to=')
    ? `--to is gone: a claim pays your own signed-up wallet.\n${USAGE}`
    : `Unknown option ${opt}.\n${USAGE}`);
  if (argv.length !== 2) stop(USAGE);
  return { address: argv[0], answer: argv[1] };
}

async function main() {
  const { address, answer } = parseArgs(process.argv.slice(2));
  if (normalizeAnswer(answer) === '') stop('The answer is empty.');

  // 1. Check everything that can be checked without a wallet.
  const { compiled, pureCircuits } = await loadContract();
  const hunt = await readHunt(address);
  const digest = answerDigest(answer);
  if (hunt.claimed) stop('This hunt has already been claimed.');
  if (new Date(Number(hunt.deadline) * 1000) <= (await chainTime())) stop('This hunt is over.');
  if (hex(pureCircuits.phraseHash(digest)) !== hex(hunt.answer)) stop('Wrong answer. Nothing was sent.');
  console.log('Your answer is correct. Preparing the claim...');

  const wallet = walletSecret();
  if (!proofServerIsLocal()) {
    console.log(`WARNING: the proof server ${CONFIG.proofServer} is not on this machine. It sees your`);
    console.log('answer while it proves, so only use one you run yourself.');
  }
  const proofServer = await fetch(`${CONFIG.proofServer}/version`).catch(() => null);
  if (!proofServer?.ok) stop(`No proof server at ${CONFIG.proofServer}. See the README to start one.`);

  const w = await buildWallet(wallet);
  try {
    // 2. Everything that can fail fast goes before the long sync. This hunt keeps
    //    no private state, so the local store only needs an empty entry for it.
    const p = providers(w);
    p.privateStateProvider.setContractAddress(address);
    await p.privateStateProvider.set(PRIVATE_STATE_ID, {});

    // The prize goes to this wallet, which must be signed up with this wallet's own
    // player secret. The address is decoded the same way sign-ups are.
    const toAddress = w.keystore.getBech32Address().asString();
    const to = { bytes: encodeUserAddress(MidnightBech32m.parse(toAddress).decode(UnshieldedAddress, NETWORK).hexString) };
    const secret = playerSecret(w.keystore);
    if (!hunt.players.member(to)) {
      stop(`${toAddress} is not signed up for this hunt, so the contract can't pay it.\nSign up first: see the README.`);
    }
    if (hex(hunt.players.lookup(to)) !== hex(pureCircuits.playerKey(secret))) {
      stop(`${toAddress} is signed up, but with a different player key than this kit derives.\n` +
        'Reply on your sign-up issue so kwigbo can look into it.');
    }
    console.log(`The prize goes to: ${toAddress} (signed up)`);

    // 3. Sync the wallet and make sure it can pay the fee.
    const state = await startAndSync(w);
    if (state.dust.balance(new Date()) === 0n) {
      stop(nightOf(state) > 0n
        ? 'Your wallet has no DUST for the fee yet. Run: node wallet.mjs register, then wait a few minutes.'
        : `Your wallet has no tNIGHT. Fund ${toAddress} at ${CONFIG.faucet}, then run: node wallet.mjs register`);
    }

    // 4. Prove and submit.
    console.log('Proving the claim (about half a minute)...');
    const res = await submitCallTx(p, {
      compiledContract: compiled,
      contractAddress: address,
      privateStateId: PRIVATE_STATE_ID,
      circuitId: 'claim',
      args: [digest, to, secret],
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
