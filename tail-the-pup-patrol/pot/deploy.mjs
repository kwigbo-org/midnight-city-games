// Deploy the Tail pot on Preview: two judges, an owner, a 60-second window for the rehearsal.
import { readFileSync } from 'node:fs';
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { KEYS, bytes, sha, NIGHT, walletUp, loadContract, saveDeployment, deployment, PRIVATE_STATE_ID } from './pot.mjs';
if (deployment()) { console.log('already deployed:', deployment().address); process.exit(0); }
const { compiled, pureCircuits } = await loadContract();
const k = KEYS();
const seal = readFileSync(process.argv[2], 'utf8'); // the sealed SEAL.sha256 file
const gameHash = sha(seal);
const window = BigInt(process.argv[3] ?? 60);
const { w, p } = await walletUp();
try {
  console.log('Deploying (proving takes a minute)...');
  const d = await deployContract(p, { compiledContract: compiled, privateStateId: PRIVATE_STATE_ID, initialPrivateState: {},
    args: [gameHash, (process.env.JUDGE_A_PUB ? bytes(process.env.JUDGE_A_PUB) : pureCircuits.judgeKey(bytes(k.judgeA))), pureCircuits.judgeKey(bytes(k.judgeB)), pureCircuits.ownerKey(bytes(k.owner)), NIGHT, window] });
  const address = d.deployTxData.public.contractAddress;
  saveDeployment({ address, window: Number(window), gameHash: Buffer.from(gameHash).toString('hex'), tx: d.deployTxData.public.txHash, at: new Date().toISOString() });
  console.log('deployed at', address, 'tx', d.deployTxData.public.txHash);
} finally { await w.wallet.stop().catch(() => {}); }
process.exit(0);
