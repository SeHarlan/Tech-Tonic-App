import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import {
  mplCandyMachine,
  fetchCandyMachine,
  fetchCandyGuard,
  mintV1,
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

async function main() {
  if (!CM_ADDRESS) {
    // Try to read from generated output
    try {
      const output = JSON.parse(
        await readFile(resolve('./generated/candy-machine.json'), 'utf-8'),
      );
      if (!output.candyMachine) throw new Error('No candyMachine in output');
      return run(output.candyMachine, output.collection);
    } catch {
      console.error('Error: Set CM_ADDRESS or run create-candy-machine first');
      process.exit(1);
    }
  }
  return run(CM_ADDRESS);
}

async function run(cmAddress: string, collectionAddress?: string) {
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

  // Get solPayment destination
  const solPaymentGuard = candyGuard.guards.solPayment;
  const solPaymentDest =
    solPaymentGuard.__option === 'Some'
      ? solPaymentGuard.value.destination
      : undefined;

  console.log('solPayment destination:', solPaymentDest);

  // Resolve collection from CM account or CLI arg
  const collection = collectionAddress
    ? publicKey(collectionAddress)
    : candyMachine.collectionMint;

  const asset = generateSigner(umi);
  console.log('Asset:', asset.publicKey);

  console.log('\nAttempting mint...');
  try {
    const tx = transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: 800_000 }))
      .add(
        mintV1(umi, {
          candyMachine: cmPk,
          asset,
          collection,
          mintArgs: {
            solPayment: solPaymentDest
              ? some({ destination: solPaymentDest })
              : undefined,
            mintLimit: some({ id: 1 }),
          },
        }),
      );

    const result = await tx.sendAndConfirm(umi);
    console.log('Mint succeeded!');
    console.log('Signature:', result.signature);
  } catch (err: any) {
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
