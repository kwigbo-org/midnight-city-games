// Which pot contract the tools load: the deployment file's own "version" (3, 4 or 5), so a judge or the
// publisher moves to a new pot just by being pointed at its deployment (TAIL_POT_DEPLOYMENT). Imported
// first (static), before anything loads the contract.
import { readFileSync } from 'node:fs';
const file = process.env.TAIL_POT_DEPLOYMENT ?? new URL('./deployment-v3.json', import.meta.url);
let version = 3;
try { version = Number(JSON.parse(readFileSync(file, 'utf8')).version) || 3; } catch { /* none yet: v3 */ }
if (![3, 4, 5].includes(version)) throw new Error(`unknown pot version ${version} in ${file}`);
process.env.TAIL_POT_CONTRACT = version === 3 ? 'tail-pot-v3' : `tail-pot-v${version}`;
export const POT_VERSION = version;
