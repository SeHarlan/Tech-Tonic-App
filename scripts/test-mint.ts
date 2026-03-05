import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine,
  fetchCandyMachine,
  fetchCandyGuard,
  mintV1,
  getMerkleProof,
  route,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { mplCore } from '@metaplex-foundation/mpl-core';
import {
  generateSigner,
  keypairIdentity,
  publicKey,
  some,
  transactionBuilder,
} from '@metaplex-foundation/umi';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { homedir } from 'os';

const CM_ADDRESS = ''; // Set after running create-candy-machine
const RPC = 'https://devnet.helius-rpc.com/?api-key=1d9d2afb-b8c1-40b1-ba66-063071d49ea3';
const DEFAULT_KEYPAIR = join(homedir(), '.config/solana/id.json');

// Must match create-candy-machine.ts
const ADMIN_WALLETS = [
  'EZAdWMUWCKSPH6r6yNysspQsZULwT9zZPqQzRhrUNwDX',
  'HsnsEpjV2nqUukLmyRTkurgXf37u7fi8pRbDuLJmdcN1',
];

async function main() {
  const group = process.argv.includes('--admin') ? 'admin' : 'public';
  console.log(`Minting with group: ${group}\n`);

  let cmAddress = CM_ADDRESS;
  let collectionAddress: string | undefined;

  if (!cmAddress) {
    try {
      const output = JSON.parse(
        await readFile(resolve('./generated/candy-machine.json'), 'utf-8'),
      );
      if (!output.candyMachine) throw new Error('No candyMachine in output');
      cmAddress = output.candyMachine;
      collectionAddress = output.collection;
    } catch {
      console.error('Error: Set CM_ADDRESS or run create-candy-machine first');
      process.exit(1);
    }
  }

  // Load keypair
  const keypairData = JSON.parse(
    await readFile(resolve(DEFAULT_KEYPAIR), 'utf-8'),
  );

  const umi = createUmi(RPC);
  const keypair = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(keypairData),
  );
  umi.use(keypairIdentity(keypair));
  umi.use(mplCore());
  umi.use(mplCandyMachine());

  console.log(`Identity: ${keypair.publicKey}`);

  const cmPk = publicKey(cmAddress);
  const candyMachine = await fetchCandyMachine(umi, cmPk);
  const candyGuard = await fetchCandyGuard(umi, candyMachine.mintAuthority);

  console.log('Items redeemed:', candyMachine.itemsRedeemed);
  console.log('Items available:', candyMachine.data.itemsAvailable);

  const collection = collectionAddress
    ? publicKey(collectionAddress)
    : candyMachine.collectionMint;

  // For admin group, validate the allowList first
  if (group === 'admin') {
    console.log('\nValidating allowList proof...');
    await route(umi, {
      candyMachine: cmPk,
      candyGuard: candyMachine.mintAuthority,
      group: some('admin'),
      guard: 'allowList',
      routeArgs: {
        path: 'proof',
        merkleRoot: getMerkleProof(ADMIN_WALLETS, keypair.publicKey.toString()).root,
        merkleProof: getMerkleProof(ADMIN_WALLETS, keypair.publicKey.toString()).proof,
      },
    }).sendAndConfirm(umi);
    console.log('  AllowList proof validated');
  }

  const asset = generateSigner(umi);
  console.log('Asset:', asset.publicKey);

  console.log('\nAttempting mint...');
  try {
    // Build mint args based on group
    const mintArgs: Record<string, any> = {};
    if (group === 'public') {
      // Find solPayment destination from the public group
      const groups = candyGuard.groups;
      const publicGroup = groups.find((g) => g.label === 'public');
      const solPayment = publicGroup?.guards.solPayment;
      if (solPayment?.__option === 'Some') {
        mintArgs.solPayment = some({ destination: solPayment.value.destination });
      }
      mintArgs.mintLimit = some({ id: 1 });
    } else {
      mintArgs.allowList = some({ merkleRoot: getMerkleProof(ADMIN_WALLETS, keypair.publicKey.toString()).root });
      mintArgs.mintLimit = some({ id: 2 });
    }

    const tx = transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: 800_000 }))
      .add(
        mintV1(umi, {
          candyMachine: cmPk,
          asset,
          collection,
          group: some(group),
          mintArgs,
        }),
      );

    const result = await tx.sendAndConfirm(umi);
    console.log('Mint succeeded!');
    console.log('Signature:', result.signature);
  } catch (err) {
    console.error('Mint failed:', err.message || err);
    if (err.logs) {
      console.error('\nTransaction logs:');
      err.logs.forEach((log: string) => console.error('  ', log));
    }
    if (err.cause) {
      console.error('\nCause:', err.cause);
    }
  }
}

main().catch(console.error);
