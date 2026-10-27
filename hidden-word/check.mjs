// Check an answer against a hunt, without a wallet and without sending anything.
//
//   node check.mjs <contract-address> "<answer>"
//
// Also shows whether the hunt is still open, the prize, and the deadline.
import { answerDigest, normalizeAnswer } from './lib/answer.mjs';
import { loadContract, readHunt, hex, NIGHT_HEX } from './lib/midnight.mjs';

const [address, answer] = process.argv.slice(2);
if (!address || answer === undefined) {
  console.error('Usage: node check.mjs <contract-address> "<answer>"');
  process.exit(2);
}

const { pureCircuits } = await loadContract();
const hunt = await readHunt(address);
const deadline = new Date(Number(hunt.deadline) * 1000);
const prize = hex(hunt.color) === NIGHT_HEX ? `${Number(hunt.prize) / 1e6} tNIGHT` : `${hunt.prize} units`;

console.log(`Hunt:     ${address}`);
console.log(`Prize:    ${prize}`);
console.log(`Deadline: ${deadline.toISOString()}`);
console.log(`Status:   ${hunt.claimed ? 'already claimed' : deadline < new Date() ? 'over' : 'open'}`);
console.log(`Checking: "${normalizeAnswer(answer)}"`);

const ok = hex(pureCircuits.phraseHash(answerDigest(answer))) === hex(hunt.answer);
console.log(ok ? 'Answer:   CORRECT' : 'Answer:   wrong');
process.exit(ok ? 0 : 1);
