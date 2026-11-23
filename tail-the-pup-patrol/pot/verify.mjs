// Verify a deployed pot against this source: compile tail-pot.compact yourself (./compile.sh), then
//   node verify.mjs <pot contract address>
// For every circuit, the verifier key the contract holds on chain must equal the one your compiler
// produced from ../contract/tail-pot.compact. Equal keys mean the deployed contract runs exactly this
// source's circuits. It also prints the pot's sealed settings: the game hash, the judges' and owner's
// public keys, the token and the window.
import { existsSync, readFileSync } from 'node:fs';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { loadContract, publicData, zkConfigPath } from './lib/midnight.mjs';

const address = process.argv[2];
if (!/^[0-9a-f]{64}$/.test(address ?? '')) { console.log('usage: node verify.mjs <pot contract address, 64 hex>'); process.exit(1); }
const { ledger } = await loadContract();
const read = await publicData().queryContractState(address);
if (!read) { console.log(`no contract at ${address} on Preview`); process.exit(1); }
const state = read.contractState.deserialize({ v9: ContractState });
const hex = (b) => Buffer.from(b).toString('hex');

let ok = true;
// The circuits that run on chain: the ones with a verifier key (pure helpers like judgeKey have none).
const circuits = JSON.parse(readFileSync(`${zkConfigPath}/compiler/contract-info.json`, 'utf8')).circuits.map((c) => c.name)
  .filter((n) => existsSync(`${zkConfigPath}/keys/${n}.verifier`));
for (const name of circuits) {
  const local = readFileSync(`${zkConfigPath}/keys/${name}.verifier`);
  const op = state.operation(name);
  const chain = op?.verifierKey;
  const same = !!chain && Buffer.compare(Buffer.from(chain), local) === 0;
  ok &&= same;
  console.log(`${same ? 'MATCH ' : 'DIFFER'} ${name}`);
}
const extra = state.operations().filter((n) => !circuits.includes(typeof n === 'string' ? n : String(n)));
if (extra.length) { ok = false; console.log('on chain but not in this source:', extra.join(', ')); }

const l = ledger(state.data);
console.log(`\ngame hash  ${hex(l.gameHash)}`);
if (l.judges !== undefined) { for (const [slot, k] of l.judges) console.log(`judge ${'ABCDE'[Number(slot)]}    ${hex(k)}`); } // v2: slots
else { console.log(`judge A    ${hex(l.judgeA)}`); console.log(`judge B    ${hex(l.judgeB)}`); } // v1
if (l.owner !== undefined) console.log(`owner      ${hex(l.owner)}`); // v1 pots
console.log(`token      ${hex(l.color)}`);
if (l.window !== undefined) console.log(`window     ${l.window} s`);
if (l.operator !== undefined) console.log(`operator   ${hex(l.operator)}\nmigration  ${hex(l.migration)}\n${l.reserveMin !== undefined ? `reserve bounds ${l.reserveMin} to ${l.reserveMax}` : `fee bounds ${l.feeMin} to ${l.feeMax}`} atomic`); // v3: the auction's reserve
console.log(`\n${ok ? 'VERIFIED: this contract runs the circuits compiled from this source.' : 'NOT VERIFIED: see above.'}`);
process.exit(ok ? 0 : 2);
