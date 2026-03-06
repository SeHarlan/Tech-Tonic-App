import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { createGenericFile, keypairIdentity } from '@metaplex-foundation/umi';
import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { RPC_ENDPOINT } from '../config/env';

// --- Types ---

interface ThumbnailEntry {
  filename: string;
  seed: number;
  totalFrameCount: number;
  attributes: { trait_type: string; value: string }[];
}

interface ThumbnailMetadata {
  generatedAt: string;
  count: number;
  durationSeconds: number;
  thumbnails: ThumbnailEntry[];
}

interface ConfigLine {
  name: string;
  uri: string;
}

// --- Constants ---

const COLLECTION_NAME = 'TechTonic';
const COLLECTION_SYMBOL = 'TONIC';
const COLLECTION_DESCRIPTION =
  'A generative art piece from the TechTonic Series 1 collection.';
const DEFAULT_INPUT = './generated/thumbnails';
const DEFAULT_OUTPUT = './generated/config-lines.json';
const DEFAULT_KEYPAIR = join(homedir(), '.config/solana/id.json');
const DEFAULT_CLUSTER = 'devnet';
const DEFAULT_RPC = RPC_ENDPOINT;

// --- Arg parsing ---

interface Args {
  input: string;
  output: string;
  keypair: string;
  cluster: 'devnet' | 'mainnet-beta';
  rpc: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    keypair: DEFAULT_KEYPAIR,
    cluster: DEFAULT_CLUSTER,
    rpc: DEFAULT_RPC,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--input':
        args.input = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--keypair':
        args.keypair = argv[++i];
        break;
      case '--cluster':
        args.cluster = argv[++i] as Args['cluster'];
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

  console.log('\n=== Asset Uploader ===');
  console.log(`  Input:   ${args.input}`);
  console.log(`  Output:  ${args.output}`);
  console.log(`  Cluster: ${args.cluster}`);
  console.log(`  RPC:     ${rpcUrl}\n`);

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

  console.log(`  Identity: ${keypair.publicKey}\n`);

  // Read thumbnail metadata
  const metadataPath = join(args.input, 'metadata.json');
  const metadata: ThumbnailMetadata = JSON.parse(
    await readFile(metadataPath, 'utf-8'),
  );
  console.log(`Found ${metadata.thumbnails.length} thumbnails\n`);

  const configLines: ConfigLine[] = [];

  for (let i = 0; i < metadata.thumbnails.length; i++) {
    const entry = metadata.thumbnails[i];
    const paddedIndex = String(i).padStart(
      String(metadata.thumbnails.length).length,
      '0',
    );
    const nftName = `${COLLECTION_NAME} #${paddedIndex}`;

    console.log(
      `[${i + 1}/${metadata.thumbnails.length}] Uploading ${entry.filename}...`,
    );

    // Upload image to Arweave via Irys (retry once on failure)
    const imageBuffer = await readFile(join(args.input, entry.filename));
    const imageFile = createGenericFile(imageBuffer, entry.filename, {
      contentType: 'image/png',
    });

    let imageUri: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const [uri] = await umi.uploader.upload([imageFile]);
      if (uri) { imageUri = uri; break; }
      console.warn(`  Image upload returned empty (attempt ${attempt + 1}/2), retrying...`);
    }
    if (!imageUri) {
      throw new Error(`Image upload failed for ${entry.filename} — aborting to prevent broken metadata.`);
    }
    console.log(`  Image:    ${imageUri}`);

    // Create and upload Metaplex-standard metadata JSON
    const nftMetadata = {
      name: nftName,
      symbol: COLLECTION_SYMBOL,
      description: COLLECTION_DESCRIPTION,
      image: imageUri,
      attributes: entry.attributes,
      properties: {
        files: [{ uri: imageUri, type: 'image/png' }],
        category: 'image',
      },
    };

    const metadataUri = await umi.uploader.uploadJson(nftMetadata);
    if (!metadataUri) {
      throw new Error(`Metadata upload failed for ${nftName} — aborting.`);
    }
    console.log(`  Metadata: ${metadataUri}\n`);

    configLines.push({ name: nftName, uri: metadataUri });
  }

  // Write config lines for Candy Machine creation script
  await writeFile(args.output, JSON.stringify(configLines, null, 2));
  console.log(`Config lines written to ${args.output}`);
  console.log(`Uploaded ${configLines.length}/${metadata.thumbnails.length} items`);
  console.log('Done!\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
