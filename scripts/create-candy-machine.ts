import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import {
  createGenericFile,
  generateSigner,
  keypairIdentity,
  publicKey,
  some,
  sol,
  dateTime,
} from '@metaplex-foundation/umi';
import {
  mplCandyMachine,
  create,
  addConfigLines,
  getMerkleRoot,
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
const ROYALTY_BPS = 1000; // 10% royalty
const DEFAULT_PRICE_SOL = MINT_PRICE_SOL;
const MINT_LIMIT = 3;
const ROYALTY_WALLET = 'EZAdWMUWCKSPH6r6yNysspQsZULwT9zZPqQzRhrUNwDX';
const BOT_TAX_SOL = 0.001;

// SKR token payment (Seeker coin — mainnet only, won't exist on devnet)
const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const SKR_DECIMALS = 6;
const SKR_PRICE = MINT_PRICE_SKR; // ~2/3 SOL-equivalent at current rates, adjust as needed

// Admin wallets for free preminting (allowList guard group)
const ADMIN_WALLETS = [
  'EZAdWMUWCKSPH6r6yNysspQsZULwT9zZPqQzRhrUNwDX',
  'HsnsEpjV2nqUukLmyRTkurgXf37u7fi8pRbDuLJmdcN1',
];

// Mint phase timing — keep in sync with VITE_MINT_START_TIME / src/config/env.ts
// This is when the Seeker Only phase begins; admin premint starts 24h before.
const MINT_START_TIME = process.env.MINT_START_TIME || '2026-04-01T00:00:00Z';
const PHASE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

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
  demoVersion: number | null;
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
    demoVersion: null,
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
      case '--demo-version':
        args.demoVersion = parseInt(argv[++i], 10);
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

  // On devnet, prepend "DEMO v{N}" to the collection name.
  // Auto-increments from the last candy-machine.json if --demo-version is not set.
  const isMainnet = args.cluster === 'mainnet-beta';
  let demoVersion = args.demoVersion;
  if (!isMainnet && demoVersion === null) {
    try {
      const prev = JSON.parse(
        await readFile(resolve('./generated/candy-machine.json'), 'utf-8'),
      );
      demoVersion = (prev.demoVersion ?? 0) + 1;
    } catch {
      demoVersion = 1;
    }
  }
  const collectionName = isMainnet
    ? COLLECTION_NAME
    : `DEMO v${demoVersion} — ${COLLECTION_NAME}`;

  console.log('\n=== Core Candy Machine Creator ===');
  console.log(`  Config:     ${args.configLines}`);
  console.log(`  Collection: ${collectionName}`);
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
    name: collectionName,
    description: COLLECTION_DESCRIPTION,
    image: collectionImageUri,
  });
  console.log(`  Collection metadata: ${collectionMetadataUri}`);

  const collectionSigner = generateSigner(umi);
  await createCollection(umi, {
    collection: collectionSigner,
    name: collectionName,
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

  // Build admin allowList merkle root
  const adminMerkleRoot = getMerkleRoot(ADMIN_WALLETS);

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
    // Default guards shared by all groups
    guards: {
      botTax: some({ lamports: sol(BOT_TAX_SOL), lastInstruction: true }),
    },
    // Guard groups differ by cluster:
    // Devnet/demo: admin + public only, no timing guards, no SKR (token doesn't exist)
    // Mainnet:     admin + public + skr, with startDate/endDate phase timing
    groups: (() => {
      const isMainnet = args.cluster === 'mainnet-beta';

      const adminGroup = {
        label: 'admin',
        guards: {
          allowList: some({ merkleRoot: adminMerkleRoot }),
        },
      };

      const publicGroup = isMainnet
        ? (() => {
            const mintStartMs = new Date(MINT_START_TIME).getTime();
            const publicStartSec = Math.floor(
              (mintStartMs + PHASE_DURATION_MS) / 1000,
            );
            return {
              label: 'public',
              guards: {
                solPayment: some({
                  lamports: sol(args.price),
                  destination: publicKey(ROYALTY_WALLET),
                }),
                mintLimit: some({ id: 1, limit: MINT_LIMIT }),
                startDate: some({ date: dateTime(publicStartSec) }),
              },
            };
          })()
        : {
            label: 'public',
            guards: {
              solPayment: some({
                lamports: sol(args.price),
                destination: publicKey(ROYALTY_WALLET),
              }),
              mintLimit: some({ id: 1, limit: MINT_LIMIT }),
            },
          };

      if (!isMainnet) return [adminGroup, publicGroup];

      const mintStartMs = new Date(MINT_START_TIME).getTime();
      const skrStartSec = Math.floor(mintStartMs / 1000);
      const skrEndSec = Math.floor((mintStartMs + PHASE_DURATION_MS) / 1000);

      const skrGroup = {
        label: 'skr',
        guards: {
          tokenPayment: some({
            amount: BigInt(SKR_PRICE) * BigInt(10 ** SKR_DECIMALS),
            mint: publicKey(SKR_MINT),
            destinationAta: publicKey(ROYALTY_WALLET),
          }),
          mintLimit: some({ id: 3, limit: MINT_LIMIT }),
          startDate: some({ date: dateTime(skrStartSec) }),
          endDate: some({ date: dateTime(skrEndSec) }),
        },
      };

      return [adminGroup, skrGroup, publicGroup];
    })(),
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
  const output: Record<string, unknown> = {
    candyMachine: candyMachine.publicKey.toString(),
    collection: collectionSigner.publicKey.toString(),
    collectionName,
    itemsAvailable: configLines.length,
    price: args.price,
    cluster: args.cluster,
    standard: 'core',
    createdAt: new Date().toISOString(),
  };
  if (demoVersion !== null) output.demoVersion = demoVersion;

  const outputPath = './generated/candy-machine.json';
  await writeFile(outputPath, JSON.stringify(output, null, 2));

  console.log(`\n=== Done ===`);
  console.log(`  Candy Machine: ${candyMachine.publicKey}`);
  console.log(`  Collection:    ${collectionSigner.publicKey}`);
  console.log(`  Items:         ${configLines.length}`);
  console.log(`  Price:         ${args.price} SOL`);
  console.log(`  Royalties:     ${ROYALTY_BPS / 100}% (enforced via Core plugin)`);
  console.log(`  Guards:        botTax (default), solPayment + mintLimit(${MINT_LIMIT}) (public), allowList (admin)${args.cluster === 'mainnet-beta' ? `, tokenPayment + mintLimit(${MINT_LIMIT}) (skr)` : ''}`);
  console.log(`  Output:        ${outputPath}`);
  console.log(
    `\nAdd to your .env:` +
    `\n  VITE_CANDY_MACHINE_ADDRESS=${candyMachine.publicKey}` +
    `\n  VITE_COLLECTION_ADDRESS=${collectionSigner.publicKey}` +
    `\n\nFor Season One (live), set:` +
    `\n  VITE_SEASON_ONE_CANDY_MACHINE_ADDRESS=${candyMachine.publicKey}` +
    `\n  VITE_SEASON_ONE_COLLECTION_ADDRESS=${collectionSigner.publicKey}\n`,
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
