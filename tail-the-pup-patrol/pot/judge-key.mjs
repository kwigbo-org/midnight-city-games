// A judge's key, made on the judge's own machine.
//   node judge-key.mjs <keys file> <A|B|C|D|E>
// Creates <keys file> (mode 600) with a new random secret for that judge if it has none, and prints
// only the PUBLIC key: the hash a pot contract is deployed with. Send the operator that, never the
// file. The secret never leaves this machine; it proves your attestations.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadContract } from './lib/midnight.mjs';

const [file, who] = process.argv.slice(2);
if (!file || !['A', 'B', 'C', 'D', 'E'].includes(who)) { console.log('usage: node judge-key.mjs <keys file> <A|B|C|D|E>'); process.exit(1); }
const field = `judge${who}`;
let keys = {};
if (existsSync(file)) {
  try { keys = JSON.parse(readFileSync(file, 'utf8')); } catch { console.log(`${file} isn't valid JSON: restore it from your backup (it holds your secret); not touching it`); process.exit(1); }
}
if (!/^[0-9a-f]{64}$/.test(keys[field] ?? '')) {
  keys[field] = randomBytes(32).toString('hex');
  writeFileSync(file, JSON.stringify(keys), { mode: 0o600 });
  chmodSync(file, 0o600);
  console.log(`made a new judge ${who} secret in ${file} (keep it private, back it up)`);
}
const { pureCircuits } = await loadContract();
const pub = Buffer.from(pureCircuits.judgeKey(Uint8Array.from(Buffer.from(keys[field], 'hex')))).toString('hex');
console.log(`judge ${who} public key: ${pub}`);
process.exit(0);
