// Check an answer against a hunt, without a wallet and without sending anything.
//
//   node check.mjs <contract-address> "<answer>"
//
// Also shows whether the hunt is still open, the prize, and the deadline.
// Exit code: 0 correct, 1 wrong, 2 the check itself failed.
import { answerDigest, normalizeAnswer } from './lib/answer.mjs';
import { chainTime, loadContract, readHunt, hex, NIGHT_HEX } from './lib/midnight.mjs';

async function main() {
  const [address, answer] = process.argv.slice(2);
  if (!address || answer === undefined || process.argv.length !== 4) {
    console.error('Usage: node check.mjs <contract-address> "<answer>"');
    return 2;
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
