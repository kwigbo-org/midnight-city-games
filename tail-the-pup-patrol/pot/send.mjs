// Send tNIGHT from this kit's wallet to another Preview address (testnet only).
//   node send.mjs <mn_addr_preview1…> <atomic amount>
import { walletUp } from './pot.mjs';
import { MidnightBech32m, UnshieldedAddress } from '@midnight-ntwrk/wallet-sdk-address-format';
import { NETWORK, NIGHT_HEX } from './lib/midnight.mjs';

const [to, amount] = process.argv.slice(2);
if (!/^mn_addr_preview1[0-9a-z]+$/.test(to ?? '') || !/^[1-9][0-9]*$/.test(amount ?? '')) {
  console.log('usage: node send.mjs <mn_addr_preview1…> <atomic amount>');
  process.exit(1);
}
const { w } = await walletUp();
try {
  const recipe = await w.wallet.transferTransaction(
    [{ type: 'unshielded', outputs: [{ amount: BigInt(amount), receiverAddress: MidnightBech32m.parse(to).decode(UnshieldedAddress, NETWORK), type: NIGHT_HEX }] }],
    { ttl: new Date(Date.now() + 30 * 60 * 1000) },
  );
  const signed = await w.wallet.signRecipe(recipe, (payload) => w.keystore.signDataAsync(payload));
  const tx = await w.wallet.finalizeRecipe(signed);
  console.log('sent: tx', await w.wallet.submitTransaction(tx));
} catch (e) {
  console.log('send failed:', String(e?.message ?? e).slice(0, 300));
  process.exitCode = 1;
} finally {
  await w.wallet.stop().catch(() => {});
}
process.exit(process.exitCode ?? 0);
