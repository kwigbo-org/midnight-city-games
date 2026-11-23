// Balance of a test wallet from a key file: node balance.mjs <file> <field>. Prints only balances.
import { readFileSync } from 'node:fs';
import { buildWallet, startAndSync, nightOf } from './lib/midnight.mjs';
const [file, field] = process.argv.slice(2);
const seed = JSON.parse(readFileSync(file, 'utf8'))[field];
const w = await buildWallet({ kind: /^[0-9a-f]{64}$/i.test(seed) ? 'seed' : 'mnemonic', value: seed });
const s = await startAndSync(w, () => {});
console.log(field, w.keystore.getBech32Address().asString().slice(0, 22) + '…', 'tNIGHT', nightOf(s).toString(), 'DUST', s.dust.balance(new Date()).toString());
await w.wallet.stop().catch(() => {});
process.exit(0);
