import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCandyMachine, fetchCandyMachine } from '@metaplex-foundation/mpl-candy-machine';
import { mplTokenMetadata, findMetadataPda, fetchMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey } from '@metaplex-foundation/umi';

const CM_ADDRESS = '4hjXXPoxo41aFBf3gsgE4NwAC4jpHzN5kMg9HniRBBnt';
const RPC = 'https://devnet.helius-rpc.com/?api-key=1d9d2afb-b8c1-40b1-ba66-063071d49ea3';

async function main() {
  const umi = createUmi(RPC);
  umi.use(mplCandyMachine());
  umi.use(mplTokenMetadata());

  const cm = await fetchCandyMachine(umi, publicKey(CM_ADDRESS));
  console.log('Collection mint:', cm.collectionMint);

  // Get metadata PDA
  const metadataPda = findMetadataPda(umi, { mint: cm.collectionMint });
  console.log('Metadata PDA:', metadataPda);

  // Fetch raw account
  const rawAccount = await umi.rpc.getAccount(metadataPda);
  if (rawAccount.exists) {
    console.log('\nRaw metadata account:');
    console.log('  Data length:', rawAccount.data.length);
    console.log('  Owner:', rawAccount.owner);
    console.log('  First 40 bytes:', Buffer.from(rawAccount.data.slice(0, 40)).toString('hex'));
    // The Key enum is the first byte: 0=Uninitialized, 4=MetadataV1
    console.log('  Key byte (0):', rawAccount.data[0]);
  }

  // Try SDK deserialization
  try {
    const metadata = await fetchMetadata(umi, metadataPda);
    console.log('\nfetchMetadata succeeded:');
    console.log('  name:', metadata.name);
    console.log('  symbol:', metadata.symbol);
    console.log('  tokenStandard:', JSON.stringify(metadata.tokenStandard));
    console.log('  collection:', JSON.stringify(metadata.collection));
    console.log('  collectionDetails:', JSON.stringify(metadata.collectionDetails));
    console.log('  programmableConfig:', JSON.stringify(metadata.programmableConfig));
  } catch (err) {
    console.error('fetchMetadata failed:', err);
  }
}

main().catch(console.error);
