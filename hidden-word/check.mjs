// Check an answer against a hunt, without a wallet and without sending anything.
//
//   node check.mjs <contract-address> "<answer>" [--player <mn_addr_preview1...>]
//
// Also shows whether the hunt is still open, the prize, the deadline, and how many
// players have signed up. With --player, whether that address is signed up.
// Exit code: 0 correct, 1 wrong, 2 the check itself failed.
import { answerDigest, normalizeAnswer } from './lib/answer.mjs';
import { encodeUserAddress } from '@midnight-ntwrk/compact-runtime';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { NETWORK, chainTime, loadContract, readHunt, hex, NIGHT_HEX } from './lib/midnight.mjs';

const USAGE = 'Usage: node check.mjs <contract-address> "<answer>" [--player <mn_addr_preview1...>]';

async function main() {
  const args = process.argv.slice(2);
  let player;
  const playerAt = args.findIndex((a) => a === '--player' || a.startsWith('--player='));
  if (playerAt >= 0) {
    const a = args[playerAt];
    player = a === '--player' ? args[playerAt + 1] : a.slice('--player='.length);
    args.splice(playerAt, a === '--player' ? 2 : 1);
    if (!player) {
      console.error(USAGE);
      return 2;
    }
  }
  const [address, answer] = args;
  if (!address || answer === undefined || args.length !== 2 || args.some((a) => a.startsWith('--'))) {
    console.error(USAGE);
    return 2;
  }
  let playerKey;
  if (player) {
    try {
      playerKey = { bytes: encodeUserAddress(MidnightBech32m.parse(player).decode(UnshieldedAddress, NETWORK).hexString) };
    } catch {
      console.error(`--player must be a Midnight Preview address (mn_addr_preview1...). Got: ${player}`);
      return 2;
    }
  }
  if (normalizeAnswer(answer) === '') {
    console.error('The answer is empty.');
    return 2;
  }

  const { pureCircuits } = await loadContract();
  const hunt = await readHunt(address);
  const deadline = new Date(Number(hunt.deadline) * 1000);
  const prize = hex(hunt.color) === NIGHT_HEX ? `${Number(hunt.prize) / 1e6} tNIGHT` : `${hunt.prize} units`;

  console.log(`Hunt:     ${address}`);
  console.log(`Prize:    ${prize}`);
  console.log(`Deadline: ${deadline.toISOString()}`);
  console.log(`Status:   ${hunt.claimed ? 'already claimed' : deadline <= (await chainTime()) ? 'over' : 'open'}`);
  console.log(`Players:  ${hunt.players.size()} signed up`);
  if (playerKey) console.log(`Player:   ${hunt.players.member(playerKey) ? 'signed up' : 'NOT signed up'} (${player})`);
  console.log(`Checking: "${normalizeAnswer(answer)}"`);

  const ok = hex(pureCircuits.phraseHash(answerDigest(answer))) === hex(hunt.answer);
  console.log(ok ? 'Answer:   CORRECT' : 'Answer:   wrong');
  return ok ? 0 : 1;
}

let code;
try {
  code = await main();
} catch (e) {
  console.error(`The check failed: ${e?.message ?? e}`);
  code = 2;
}
process.exit(code);
