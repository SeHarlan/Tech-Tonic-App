import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCandyMachine, fetchCandyMachine, fetchCandyGuard } from '@metaplex-foundation/mpl-candy-machine';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey } from '@metaplex-foundation/umi';

const CM_ADDRESS = '4hjXXPoxo41aFBf3gsgE4NwAC4jpHzN5kMg9HniRBBnt';
const RPC = 'https://devnet.helius-rpc.com/?api-key=1d9d2afb-b8c1-40b1-ba66-063071d49ea3';

async function main() {
  const umi = createUmi(RPC);
  umi.use(mplCandyMachine());
  umi.use(mplTokenMetadata());

  const cmPk = publicKey(CM_ADDRESS);

  // Fetch raw account data
  const rawAccount = await umi.rpc.getAccount(cmPk);
  if (rawAccount.exists) {
    const data = rawAccount.data;
    console.log('Raw account data length:', data.length);
    console.log('First 40 bytes (hex):', Buffer.from(data.slice(0, 40)).toString('hex'));
    console.log('Discriminator (first 8 bytes):', Buffer.from(data.slice(0, 8)).toString('hex'));
    console.log('Byte at offset 8:', data[8]);
    console.log('Byte at offset 9:', data[9]);
    console.log('Owner:', rawAccount.owner);
  }

  // Try SDK deserialization
  try {
    const cm = await fetchCandyMachine(umi, cmPk);
    console.log('\nfetchCandyMachine succeeded:');
    console.log('  version:', JSON.stringify((cm as any).version));
    console.log('  tokenStandard:', cm.tokenStandard);
    console.log('  authority:', cm.authority);
    console.log('  collectionMint:', cm.collectionMint);
    console.log('  itemsRedeemed:', cm.itemsRedeemed);
    console.log('  items available:', cm.data.itemsAvailable);
    console.log('  mintAuthority:', cm.mintAuthority);

    // Fetch guard
    const guard = await fetchCandyGuard(umi, cm.mintAuthority);
    console.log('\nGuard data:');
    const guards = guard.guards;
    console.log('  solPayment:', JSON.stringify(guards.solPayment));
    console.log('  mintLimit:', JSON.stringify(guards.mintLimit));
    console.log('  botTax:', JSON.stringify(guards.botTax));
  } catch (err) {
    console.error('fetchCandyMachine failed:', err);
  }
}

main().catch(console.error);
