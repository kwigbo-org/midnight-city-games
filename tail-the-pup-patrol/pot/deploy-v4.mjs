// Deploy a v4 pot (contract/tail-pot-v4.compact: v3 with the tie split). Same arguments as deploy-v3.mjs. No owner key: nobody holds power over it afterwards.
//   node deploy-v4.mjs <SEAL.sha256> <operator mn_addr_preview1…> <migration mn_addr_preview1…> <reserve min atomic> <reserve max atomic> <judge key hex>,<judge key hex>[,…up to 5] <organizer agent id>
// The organizer agent id (kwigbo's, in the city) goes only into deployment-v3.json on the judges'
// machines, never into the repo: the judges pass over that agent for the pot, whatever its wallets.
// The operator address receives a tenth of each winning bid (hosting) and is never a pot winner. The
// migration address receives the pot if two judges agree to move it, to fund the successor. Judge
// keys are public keys (judge-key.mjs prints them), in slot order A, B, C, D, E.
import { readFileSync } from 'node:fs';
process.env.TAIL_POT_CONTRACT = 'tail-pot-v4';
process.env.TAIL_POT_DEPLOYMENT ??= new URL('./deployment-v4.json', import.meta.url).pathname;
const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
const { walletUp, PRIVATE_STATE_ID } = await import('./pot.mjs');
const v3 = await import('./pot-v3.mjs');
const { NIGHT_HEX } = await import('./lib/midnight.mjs');

const [sealFile, operator, migration, min, max, keyList, organizerAgentId] = process.argv.slice(2);
const keys = (keyList ?? '').split(',').filter(Boolean);
if (!sealFile || !/^mn_addr_preview1[0-9a-z]+$/.test(operator ?? '') || !/^mn_addr_preview1[0-9a-z]+$/.test(migration ?? '') || !/^[1-9][0-9]*$/.test(min ?? '') || !/^[1-9][0-9]*$/.test(max ?? '')
  || keys.length < 2 || keys.length > 5 || !keys.every((k) => /^[0-9a-f]{64}$/.test(k)) || (!organizerAgentId && process.env.TAIL_POT_NO_ORGANIZER !== '1')) {
  console.log('usage: node deploy-v4.mjs <SEAL.sha256> <operator mn_addr> <migration mn_addr> <reserve min> <reserve max> <key>,<key>[,…up to 5] <organizer agent id>  (a test pot: TAIL_POT_NO_ORGANIZER=1)');
  process.exit(1);
}
if (v3.deploymentV3()) { console.log('already deployed:', v3.deploymentV3().address); process.exit(0); }
const judges = [...keys.map(v3.bytes), ...Array(5 - keys.length).fill(v3.ZERO)];
const { compiled } = await v3.loadContract();
const gameHash = v3.sha(readFileSync(sealFile, 'utf8'));
const { w, p } = await walletUp();
try {
  console.log('Deploying the v4 pot (proving takes a minute)...');
  const d = await deployContract(p, { compiledContract: compiled, privateStateId: PRIVATE_STATE_ID, initialPrivateState: {},
    args: [gameHash, v3.bytes(NIGHT_HEX), v3.addressBytes(operator), v3.addressBytes(migration), BigInt(min), BigInt(max), ...judges] });
  const address = d.deployTxData.public.contractAddress;
  v3.saveDeploymentV3({ address, version: 4, operator, migration, organizerAgentId: organizerAgentId ?? null, reserveMin: min, reserveMax: max, judges: keys, gameHash: v3.hex(gameHash), tx: d.deployTxData.public.txHash, at: new Date().toISOString() });
  console.log('deployed v4 pot at', address, 'tx', d.deployTxData.public.txHash);
} finally { await w.wallet.stop().catch(() => {}); }
process.exit(0);
