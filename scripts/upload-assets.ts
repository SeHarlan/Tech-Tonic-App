/**
 * Upload thumbnail images + Metaplex-standard metadata JSON to Irys L1, then
 * emit a `config-lines.json` file (name + metadata URI pairs) that
 * `create-candy-machine.ts` consumes as its config lines input.
 *
 * Reads `metadata.json` produced by `generate-thumbnails.ts`, uploads each
 * PNG, builds the NFT JSON (name, symbol, description, image, attributes),
 * uploads that too, and records the resulting URI. Aborts on any upload
 * failure to avoid shipping broken metadata on-chain.
 *
 * Requires a funded Solana keypair (Irys L1 bills via SOL — devnet testnet
 * uses devnet SOL, mainnet uses mainnet-beta SOL).
 *
 * Usage:
 *   bun run upload-assets
 *   bun run scripts/upload-assets.ts [--input DIR] [--output FILE]
 *     [--keypair PATH] [--cluster devnet|mainnet-beta]
 *
 * Defaults: input=./generated/thumbnails, output=./generated/config-lines.json,
 * keypair=~/.config/solana/id.json, cluster derived from VITE_DEMO.
 *
 * Pipeline: generate-thumbnails -> upload-assets -> create-candy-machine.
 */

import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { CLUSTER, IRYS_FUNDING_RPC } from '../config/env';
import { createIrys, uploadBytes, uploadJson } from './lib/irys-uploader';

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

const COLLECTION_NAME = 'TechTonic';
const COLLECTION_SYMBOL = 'TONIC';
const COLLECTION_DESCRIPTION =
  'A generative art piece from the TechTonic Series 1 collection.';
const DEFAULT_INPUT = './generated/thumbnails';
const DEFAULT_OUTPUT = './generated/config-lines.json';
const DEFAULT_KEYPAIR = join(homedir(), '.config/solana/id.json');

interface Args {
  input: string;
  output: string;
  keypair: string;
  cluster: 'devnet' | 'mainnet-beta';
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    keypair: DEFAULT_KEYPAIR,
    cluster: CLUSTER,
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
    }
  }

  return args;
}

async function main() {
  const args = parseArgs();

  console.log('\n=== Asset Uploader ===');
  console.log(`  Input:         ${args.input}`);
  console.log(`  Output:        ${args.output}`);
  console.log(`  Solana:        ${args.cluster}`);
  console.log(`  Irys:          L1 mainnet (always)\n`);

  console.log('Loading keypair...');
  const keypairData = JSON.parse(
    await readFile(resolve(args.keypair), 'utf-8'),
  );

  const irys = await createIrys(keypairData, IRYS_FUNDING_RPC);
  console.log(`  Identity: ${irys.address}\n`);

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

    const imageBuffer = await readFile(join(args.input, entry.filename));
    const imageUri = await uploadBytes(irys, imageBuffer, entry.filename, 'image/png');
    console.log(`  Image:    ${imageUri}`);

    const nftMetadata = {
      name: nftName,
      symbol: COLLECTION_SYMBOL,
      description: COLLECTION_DESCRIPTION,
      image: imageUri,
      attributes: entry.attributes,
      properties: {
        files: [{ uri: imageUri, type: 'image/png' }],
        category: 'image',
        original_image: imageUri,
      },
    };

    const metadataUri = await uploadJson(irys, nftMetadata);
    console.log(`  Metadata: ${metadataUri}\n`);

    configLines.push({ name: nftName, uri: metadataUri });
  }

  await writeFile(args.output, JSON.stringify(configLines, null, 2));
  console.log(`Config lines written to ${args.output}`);
  console.log(`Uploaded ${configLines.length}/${metadata.thumbnails.length} items`);
  console.log('Done!\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
