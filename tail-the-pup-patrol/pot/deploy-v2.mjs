// Deploy a v2 pot (contract/tail-pot-v2.compact). No owner key: nobody holds power over it afterwards.
//   node deploy-v2.mjs <SEAL.sha256> <operator mn_addr_preview1…> <migration mn_addr_preview1…> <fee min atomic> <fee max atomic> <judge key hex>,<judge key hex>[,…up to 5]
// The migration address receives the pot if two judges agree to move it, to fund the successor pot.
// Judge keys are public keys (judge-key.mjs prints them), in slot order A, B, C, D, E.
import { readFileSync } from 'node:fs';
process.env.TAIL_POT_CONTRACT = 'tail-pot-v2';
const { deployContract } = await import('@midnight-ntwrk/midnight-js-contracts');
const { walletUp, PRIVATE_STATE_ID } = await import('./pot.mjs');
const v2 = await import('./pot-v2.mjs');
const { NIGHT_HEX } = await import('./lib/midnight.mjs');

const [sealFile, operator, migration, min, max, keyList] = process.argv.slice(2);
const keys = (keyList ?? '').split(',').filter(Boolean);
if (!sealFile || !/^mn_addr_preview1[0-9a-z]+$/.test(operator ?? '') || !/^mn_addr_preview1[0-9a-z]+$/.test(migration ?? '') || !/^[1-9][0-9]*$/.test(min ?? '') || !/^[1-9][0-9]*$/.test(max ?? '')
  || keys.length < 2 || keys.length > 5 || !keys.every((k) => /^[0-9a-f]{64}$/.test(k))) {
  console.log('usage: node deploy-v2.mjs <SEAL.sha256> <operator mn_addr> <migration mn_addr> <fee min> <fee max> <key>,<key>[,…up to 5]');
  process.exit(1);
}
if (v2.deploymentV2()) { console.log('already deployed:', v2.deploymentV2().address); process.exit(0); }
const judges = [...keys.map(v2.bytes), ...Array(5 - keys.length).fill(v2.ZERO)];
const { compiled } = await v2.loadContract();
const gameHash = v2.sha(readFileSync(sealFile, 'utf8'));
const { w, p } = await walletUp();
try {
  console.log('Deploying the v2 pot (proving takes a minute)...');
  const d = await deployContract(p, { compiledContract: compiled, privateStateId: PRIVATE_STATE_ID, initialPrivateState: {},
    args: [gameHash, v2.bytes(NIGHT_HEX), v2.addressBytes(operator), v2.addressBytes(migration), BigInt(min), BigInt(max), ...judges] });
  const address = d.deployTxData.public.contractAddress;
  v2.saveDeploymentV2({ address, version: 2, operator, migration, feeMin: min, feeMax: max, judges: keys, gameHash: v2.hex(gameHash), tx: d.deployTxData.public.txHash, at: new Date().toISOString() });
  console.log('deployed v2 pot at', address, 'tx', d.deployTxData.public.txHash);
} finally { await w.wallet.stop().catch(() => {}); }
process.exit(0);
