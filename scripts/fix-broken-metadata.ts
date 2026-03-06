/**
 * Fix broken NFT metadata on devnet.
 *
 * Scans the collection for assets with missing image data, re-uploads
 * the thumbnail + metadata JSON to Irys, then updates the on-chain
 * asset URI via Metaplex Core's updateV1.
 *
 * Usage:
 *   bun run scripts/fix-broken-metadata.ts [--keypair <path>] [--dry-run]
 */

import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import {
  createGenericFile,
  keypairIdentity,
  publicKey,
  some,
} from '@metaplex-foundation/umi';
import { mplCore, updateV1 } from '@metaplex-foundation/mpl-core';
import { readFile } from 'fs/promises';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { RPC_ENDPOINT, COLLECTION_ADDRESS } from '../config/env';

// --- Config ---

const DEFAULT_KEYPAIR = join(homedir(), '.config/solana/id.json');
const THUMBNAILS_DIR = './generated/thumbnails';
const COLLECTION_SYMBOL = 'TONIC';
const COLLECTION_DESCRIPTION =
  'A generative art piece from the TechTonic Series 1 collection.';

// --- Types ---

interface DasAsset {
  id: string;
  content: {
    json_uri: string;
    metadata: {
      name: string;
      attributes?: Array<{ trait_type: string; value: string }>;
    };
    links?: { image?: string };
    files?: Array<{ uri?: string; cdn_uri?: string; mime: string }>;
  };
  authorities?: Array<{ address: string; scopes: string[] }>;
}

interface ThumbnailEntry {
  filename: string;
  seed: number;
  totalFrameCount: number;
  attributes: { trait_type: string; value: string }[];
}

interface ThumbnailMetadata {
  thumbnails: ThumbnailEntry[];
}

// --- Helpers ---

async function dasRpc<T>(rpc: string, method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

function isBroken(asset: DasAsset): boolean {
  const hasLinkImage = !!asset.content.links?.image;
  const hasFileUri = (asset.content.files ?? []).some((f) => !!f.uri);
  return !hasLinkImage && !hasFileUri;
}

/** Extract the numeric index from a name like "TechTonic #07" */
function indexFromName(name: string): number | null {
  const match = name.match(/#(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

// --- Main ---

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const keypairIdx = argv.indexOf('--keypair');
  const keypairPath = keypairIdx >= 0 ? argv[keypairIdx + 1] : DEFAULT_KEYPAIR;

  if (!COLLECTION_ADDRESS) {
    console.error('Error: COLLECTION_ADDRESS is not set in env.');
    process.exit(1);
  }

  const rpcUrl = RPC_ENDPOINT;
  console.log('\n=== Fix Broken Metadata ===');
  console.log(`  Collection: ${COLLECTION_ADDRESS}`);
  console.log(`  RPC:        ${rpcUrl}`);
  console.log(`  Keypair:    ${keypairPath}`);
  console.log(`  Dry run:    ${dryRun}\n`);

  // Set up Umi
  const keypairData = JSON.parse(await readFile(resolve(keypairPath), 'utf-8'));
  const umi = createUmi(rpcUrl);
  const keypair = umi.eddsa.createKeypairFromSecretKey(new Uint8Array(keypairData));
  umi.use(keypairIdentity(keypair));
  umi.use(irysUploader());
  umi.use(mplCore());
  console.log(`  Authority:  ${keypair.publicKey}\n`);

  // Load thumbnail metadata so we can match broken assets to image files
  const thumbMeta: ThumbnailMetadata = JSON.parse(
    await readFile(join(THUMBNAILS_DIR, 'metadata.json'), 'utf-8'),
  );

  // Fetch all collection assets
  console.log('Fetching collection assets...');
  const result = await dasRpc<{ items: DasAsset[] }>(rpcUrl, 'getAssetsByGroup', {
    groupKey: 'collection',
    groupValue: COLLECTION_ADDRESS,
    page: 1,
    limit: 1000,
  });

  const broken = result.items.filter(isBroken);
  console.log(`Found ${result.items.length} total assets, ${broken.length} broken.\n`);

  if (broken.length === 0) {
    console.log('Nothing to fix!');
    return;
  }

  for (const asset of broken) {
    const name = asset.content.metadata.name;
    const idx = indexFromName(name);
    console.log(`--- Fixing: ${name} (${asset.id}) ---`);

    if (idx === null || idx >= thumbMeta.thumbnails.length) {
      console.warn(`  Could not match "${name}" to a thumbnail entry, skipping.`);
      continue;
    }

    const thumbEntry = thumbMeta.thumbnails[idx];
    const imagePath = join(THUMBNAILS_DIR, thumbEntry.filename);

    if (dryRun) {
      console.log(`  [DRY RUN] Would upload ${thumbEntry.filename} and update URI`);
      console.log(`  [DRY RUN] Asset: ${asset.id}`);
      console.log(`  [DRY RUN] Current URI: ${asset.content.json_uri}\n`);
      continue;
    }

    // 1. Upload thumbnail image
    console.log(`  Uploading image: ${thumbEntry.filename}`);
    const imageBuffer = await readFile(imagePath);
    const imageFile = createGenericFile(imageBuffer, thumbEntry.filename, {
      contentType: 'image/png',
    });

    let imageUri: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const [uri] = await umi.uploader.upload([imageFile]);
      if (uri) { imageUri = uri; break; }
      console.warn(`  Image upload empty (attempt ${attempt + 1}/2), retrying...`);
    }
    if (!imageUri) {
      console.error(`  FAILED to upload image for ${name}, skipping.`);
      continue;
    }
    console.log(`  Image URI: ${imageUri}`);

    // 2. Build and upload corrected metadata JSON
    const attributes = asset.content.metadata.attributes ?? thumbEntry.attributes;
    const nftMetadata = {
      name,
      symbol: COLLECTION_SYMBOL,
      description: COLLECTION_DESCRIPTION,
      image: imageUri,
      attributes,
      properties: {
        files: [{ uri: imageUri, type: 'image/png' }],
        category: 'image',
      },
    };

    const metadataUri = await umi.uploader.uploadJson(nftMetadata);
    if (!metadataUri) {
      console.error(`  FAILED to upload metadata for ${name}, skipping.`);
      continue;
    }
    console.log(`  Metadata URI: ${metadataUri}`);

    // 3. Update on-chain asset URI
    console.log(`  Updating on-chain asset...`);
    await updateV1(umi, {
      asset: publicKey(asset.id),
      collection: publicKey(COLLECTION_ADDRESS),
      newUri: some(metadataUri),
    }).sendAndConfirm(umi, { confirm: { commitment: 'confirmed' } });

    console.log(`  Done!\n`);
  }

  console.log('=== All fixes applied ===\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
