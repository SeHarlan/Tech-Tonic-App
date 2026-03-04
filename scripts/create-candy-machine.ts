import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import {
  createGenericFile,
  generateSigner,
  keypairIdentity,
  publicKey,
  some,
  sol,
} from '@metaplex-foundation/umi';
import {
  mplCandyMachine,
  create,
  addConfigLines,
} from '@metaplex-foundation/mpl-core-candy-machine';
import {
  mplCore,
  createCollection,
  ruleSet,
} from '@metaplex-foundation/mpl-core';
import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';

// --- Types ---

interface ConfigLine {
  name: string;
  uri: string;
}

// --- Constants ---

const COLLECTION_NAME = 'TechTonic Season One';
const COLLECTION_DESCRIPTION =
  'The first TechTonic generative art collection.';
const NAME_PREFIX = 'TechTonic #';
const CONFIG_LINES_BATCH_SIZE = 10;
const ROYALTY_BPS = 500; // 5% royalty
const DEFAULT_PRICE_SOL = 0.01;
const MINT_LIMIT = 3;
const ROYALTY_WALLET = 'EZAdWMUWCKSPH6r6yNysspQsZULwT9zZPqQzRhrUNwDX';
const BOT_TAX_SOL = 0.001;

const DEFAULT_CONFIG_LINES = './generated/config-lines.json';
const DEFAULT_KEYPAIR = join(homedir(), '.config/solana/id.json');
const DEFAULT_CLUSTER = 'devnet';
const DEFAULT_RPC = 'https://devnet.helius-rpc.com/?api-key=1d9d2afb-b8c1-40b1-ba66-063071d49ea3';

// --- Arg parsing ---

interface Args {
  configLines: string;
  collectionImage: string;
  keypair: string;
  cluster: 'devnet' | 'mainnet-beta';
  price: number;
  rpc: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    configLines: DEFAULT_CONFIG_LINES,
    collectionImage: '',
    keypair: DEFAULT_KEYPAIR,
    cluster: DEFAULT_CLUSTER,
    price: DEFAULT_PRICE_SOL,
    rpc: DEFAULT_RPC,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--config-lines':
        args.configLines = argv[++i];
        break;
      case '--collection-image':
        args.collectionImage = argv[++i];
        break;
      case '--keypair':
        args.keypair = argv[++i];
        break;
      case '--cluster':
        args.cluster = argv[++i] as Args['cluster'];
        break;
      case '--price':
        args.price = parseFloat(argv[++i]);
        break;
      case '--rpc':
        args.rpc = argv[++i];
        break;
    }
  }

  return args;
}

// --- Main ---

async function main() {
  const args = parseArgs();
  const rpcUrl =
    args.rpc ||
    (args.cluster === 'mainnet-beta'
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com');

  if (!args.collectionImage) {
    console.error('Error: --collection-image <path> is required');
    process.exit(1);
  }

  console.log('\n=== Core Candy Machine Creator ===');
  console.log(`  Config:     ${args.configLines}`);
  console.log(`  Collection: ${args.collectionImage}`);
  console.log(`  Cluster:    ${args.cluster}`);
  console.log(`  Price:      ${args.price} SOL`);
  console.log(`  RPC:        ${rpcUrl}\n`);

  // Load keypair
  console.log('Loading keypair...');
  const keypairData = JSON.parse(
    await readFile(resolve(args.keypair), 'utf-8'),
  );

  // Create Umi instance
  const umi = createUmi(rpcUrl);
  const keypair = umi.eddsa.createKeypairFromSecretKey(
    new Uint8Array(keypairData),
  );
  umi.use(keypairIdentity(keypair));
  umi.use(irysUploader());
  umi.use(mplCore());
  umi.use(mplCandyMachine());

  console.log(`  Identity: ${keypair.publicKey}\n`);

  // Read config lines
  const configLines: ConfigLine[] = JSON.parse(
    await readFile(resolve(args.configLines), 'utf-8'),
  );
  console.log(`Loaded ${configLines.length} config lines\n`);

  // --- 1. Create Core Collection ---
  console.log('Creating Core collection...');

  // Upload collection image
  const collectionImageBuffer = await readFile(
    resolve(args.collectionImage),
  );
  const ext = args.collectionImage.split('.').pop()?.toLowerCase() ?? 'png';
  const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
  const collectionImageFile = createGenericFile(
    collectionImageBuffer,
    args.collectionImage.split('/').pop()!,
    { contentType },
  );
  const [collectionImageUri] = await umi.uploader.upload([collectionImageFile]);
  console.log(`  Collection image: ${collectionImageUri}`);

  // Upload collection metadata
  const collectionMetadataUri = await umi.uploader.uploadJson({
    name: COLLECTION_NAME,
    description: COLLECTION_DESCRIPTION,
    image: collectionImageUri,
  });
  console.log(`  Collection metadata: ${collectionMetadataUri}`);

  const collectionSigner = generateSigner(umi);
  await createCollection(umi, {
    collection: collectionSigner,
    name: COLLECTION_NAME,
    uri: collectionMetadataUri,
    plugins: [
      {
        type: 'Royalties',
        basisPoints: ROYALTY_BPS,
        creators: [
          { address: publicKey(ROYALTY_WALLET), percentage: 100 },
        ],
        ruleSet: ruleSet('None'),
      },
    ],
  }).sendAndConfirm(umi, { confirm: { commitment: 'finalized' } });

  console.log(`  Collection: ${collectionSigner.publicKey}\n`);

  // --- 2. Create Core Candy Machine ---
  console.log('Creating Core Candy Machine...');

  // Derive URI prefix from actual data (e.g., https://gateway.irys.xyz/)
  const firstUri = configLines[0].uri;
  const uriPrefix = firstUri.slice(0, firstUri.lastIndexOf('/') + 1);

  // Compute max suffix lengths after stripping prefixes
  const maxNameSuffix = configLines.reduce((max, cl) => {
    const suffix = cl.name.replace(NAME_PREFIX, '');
    return Math.max(max, suffix.length);
  }, 0);

  const maxUriSuffix = configLines.reduce((max, cl) => {
    const suffix = cl.uri.replace(uriPrefix, '');
    return Math.max(max, suffix.length);
  }, 0);

  console.log(`  Name prefix: "${NAME_PREFIX}" + ${maxNameSuffix} chars`);
  console.log(`  URI prefix:  "${uriPrefix}" + ${maxUriSuffix} chars`);

  const candyMachine = generateSigner(umi);
  const createBuilder = await create(umi, {
    candyMachine,
    collection: collectionSigner.publicKey,
    collectionUpdateAuthority: umi.identity,
    itemsAvailable: configLines.length,
    isMutable: true,
    configLineSettings: some({
      prefixName: NAME_PREFIX,
      nameLength: maxNameSuffix,
      prefixUri: uriPrefix,
      uriLength: maxUriSuffix,
      isSequential: false,
    }),
    guards: {
      botTax: some({ lamports: sol(BOT_TAX_SOL), lastInstruction: true }),
      solPayment: some({
        lamports: sol(args.price),
        destination: publicKey(ROYALTY_WALLET),
      }),
      mintLimit: some({ id: 1, limit: MINT_LIMIT }),
    },
  });
  await createBuilder.sendAndConfirm(umi, { confirm: { commitment: 'finalized' } });

  console.log(`  Candy Machine: ${candyMachine.publicKey}\n`);

  // --- 3. Insert Config Lines ---
  console.log('Inserting config lines...');

  // Strip prefixes for on-chain storage
  const strippedLines = configLines.map((cl) => ({
    name: cl.name.replace(NAME_PREFIX, ''),
    uri: cl.uri.replace(uriPrefix, ''),
  }));

  for (let i = 0; i < strippedLines.length; i += CONFIG_LINES_BATCH_SIZE) {
    const batch = strippedLines.slice(i, i + CONFIG_LINES_BATCH_SIZE);
    await addConfigLines(umi, {
      candyMachine: candyMachine.publicKey,
      index: i,
      configLines: batch,
    }).sendAndConfirm(umi);

    console.log(
      `  Inserted ${Math.min(i + CONFIG_LINES_BATCH_SIZE, strippedLines.length)}/${strippedLines.length}`,
    );
  }

  // --- 4. Save output ---
  const output = {
    candyMachine: candyMachine.publicKey.toString(),
    collection: collectionSigner.publicKey.toString(),
    itemsAvailable: configLines.length,
    price: args.price,
    cluster: args.cluster,
    standard: 'core',
    createdAt: new Date().toISOString(),
  };

  const outputPath = './generated/candy-machine.json';
  await writeFile(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n=== Done ===`);
  console.log(`  Candy Machine: ${candyMachine.publicKey}`);
  console.log(`  Collection:    ${collectionSigner.publicKey}`);
  console.log(`  Items:         ${configLines.length}`);
  console.log(`  Price:         ${args.price} SOL`);
  console.log(`  Royalties:     ${ROYALTY_BPS / 100}% (enforced via Core plugin)`);
  console.log(`  Guards:        solPayment, mintLimit(${MINT_LIMIT}), botTax`);
  console.log(`  Output:        ${outputPath}`);
  console.log(
    `\nAdd to your .env:\n  VITE_CANDY_MACHINE_ADDRESS=${candyMachine.publicKey}\n`,
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
