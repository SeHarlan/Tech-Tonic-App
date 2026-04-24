import { Hono } from 'hono';
import { verifySignature } from '../middleware/verify-signature.ts';
import { acquireMutex, releaseMutex } from '../middleware/rate-limit.ts';
import { uploadFileWithRetry, uploadMetadataJson } from '../services/irys-upload.ts';
import {
  fetchExistingMetadata,
  buildUpdatedMetadata,
  cooldownRemaining,
} from '../services/metadata.ts';
import { updateAssetUri } from '../services/on-chain-update.ts';
import { rpcCall } from '../lib/rpc.ts';
import { COLLECTION_ADDRESS } from '../config.ts';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file (max 1080x1920 RGBA PNG is ~8.5 MB)

// Ownership/collection verification error codes
const ERR_NOT_OWNER = 'ERR_NOT_OWNER' as const;
const ERR_NOT_IN_COLLECTION = 'ERR_NOT_IN_COLLECTION' as const;

interface DasGrouping {
  group_key: string;
  group_value: string;
}

interface DasAssetResult {
  ownership: { owner: string };
  content: {
    json_uri: string;
    metadata: { name: string };
  };
  grouping: DasGrouping[];
}

interface VerifiedAsset {
  jsonUri: string;
  name: string;
}

/**
 * Verify on-chain ownership and collection membership via DAS getAsset.
 * Returns the json_uri and NFT name if the wallet owns the asset and it belongs to our collection.
 */
async function verifyOwnershipAndCollection(
  assetId: string,
  walletAddress: string,
): Promise<VerifiedAsset> {
  const result = await rpcCall<DasAssetResult>('getAsset', { id: assetId });

  if (result.ownership.owner !== walletAddress) {
    throw new Error(ERR_NOT_OWNER);
  }

  const inCollection = result.grouping.some(
    (g) => g.group_key === 'collection' && g.group_value === COLLECTION_ADDRESS,
  );
  if (!inCollection) {
    throw new Error(ERR_NOT_IN_COLLECTION);
  }

  return {
    jsonUri: result.content.json_uri,
    name: result.content.metadata.name,
  };
}

/**
 * Build the expected signed message format for a given NFT name and asset ID.
 */
function expectedMessage(nftName: string, assetId: string): string {
  return `Confirm permanent update of ${nftName} (asset: ${assetId})`;
}

const route = new Hono();

route.post('/api/update-nft', async (c) => {
  // 1. Parse multipart form data
  const formData = await c.req.formData();
  const imageFile = formData.get('image') as File | null;
  const movementFile = formData.get('movement') as File | null;
  const paintFile = formData.get('paint') as File | null;
  const assetId = formData.get('assetId') as string | null;
  const walletAddress = formData.get('walletAddress') as string | null;
  const signature = formData.get('signature') as string | null;
  const message = formData.get('message') as string | null;

  // Validate required fields
  if (!imageFile || !movementFile || !paintFile) {
    return c.json({ error: 'Missing required file(s): image, movement, paint' }, 400);
  }
  if (!assetId || !walletAddress || !signature || !message) {
    return c.json(
      { error: 'Missing required field(s): assetId, walletAddress, signature, message' },
      400,
    );
  }

  // Validate file sizes
  for (const [name, file] of [['image', imageFile], ['movement', movementFile], ['paint', paintFile]] as const) {
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ error: `File "${name}" exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit` }, 400);
    }
  }

  if (!acquireMutex(assetId)) {
    return c.json({ error: 'Another update for this asset is already in progress' }, 429);
  }

  try {
    // 3. Verify ed25519 signature
    const sigValid = await verifySignature(walletAddress, signature, message);
    if (!sigValid) {
      return c.json({ error: 'Signature verification failed' }, 401);
    }

    // 4. Verify on-chain ownership + collection membership (also gives us the NFT name)
    let jsonUri: string;
    let nftName: string;
    try {
      const verified = await verifyOwnershipAndCollection(assetId, walletAddress);
      jsonUri = verified.jsonUri;
      nftName = verified.name;
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === ERR_NOT_OWNER) {
          return c.json({ error: 'Wallet does not own this asset' }, 403);
        }
        if (err.message === ERR_NOT_IN_COLLECTION) {
          return c.json({ error: 'Asset is not part of this collection' }, 403);
        }
      }
      console.error('[update-nft] Ownership check failed:', err);
      return c.json({ error: 'Ownership verification failed' }, 500);
    }

    // 5. Verify signed message matches the exact expected format (using on-chain name)
    if (message !== expectedMessage(nftName, assetId)) {
      return c.json({ error: 'Signed message does not match expected format' }, 401);
    }

    // 6. Kick off the multipart byte reads now so they run in parallel with
    // the existing-metadata fetch. If the cooldown check fails, the buffers
    // are just memory and get discarded.
    const bytesPromise = Promise.all([
      imageFile.arrayBuffer().then((b) => new Uint8Array(b)),
      movementFile.arrayBuffer().then((b) => new Uint8Array(b)),
      paintFile.arrayBuffer().then((b) => new Uint8Array(b)),
    ]);
    // Swallow rejections here so an early return doesn't leave an unhandled promise.
    bytesPromise.catch(() => {});

    let existing;
    try {
      existing = await fetchExistingMetadata(jsonUri);
    } catch (err) {
      console.error('[update-nft] Fetch existing metadata failed:', err);
      return c.json({ error: 'Failed to fetch existing metadata' }, 500);
    }

    const remaining = cooldownRemaining(existing);
    if (remaining > 0) {
      const dayMs = 24 * 60 * 60 * 1000;
      const humanReadable =
        remaining >= dayMs
          ? `${Math.ceil(remaining / dayMs)} day(s)`
          : `${Math.ceil(remaining / (60 * 60 * 1000))} hour(s)`;
      return c.json(
        { error: `Update cooldown: try again in ${humanReadable}`, retryAfterMs: remaining },
        429,
      );
    }

    let imageUri: string, movementUri: string, paintUri: string;
    let newMetadataUri: string;
    try {
      const [imageBytes, movementBytes, paintBytes] = await bytesPromise;

      const [imgUri, mvUri, ptUri] = await Promise.all([
        uploadFileWithRetry(imageBytes, 'image.png', 'image/png'),
        uploadFileWithRetry(movementBytes, 'movement.png', 'image/techtonic-movement'),
        uploadFileWithRetry(paintBytes, 'paint.png', 'image/techtonic-paint'),
      ]);
      imageUri = imgUri;
      movementUri = mvUri;
      paintUri = ptUri;

      const newMetadata = buildUpdatedMetadata(existing, {
        imageUri,
        movementUri,
        paintUri,
        walletAddress,
      });
      newMetadataUri = await uploadMetadataJson(
        newMetadata as unknown as Record<string, unknown>,
      );
    } catch (err) {
      console.error('[update-nft] Upload/metadata failed:', err);
      return c.json({ error: 'Failed to upload files or build metadata' }, 500);
    }

    // 9. Update on-chain
    let txSignature: string;
    try {
      txSignature = await updateAssetUri(assetId, newMetadataUri);
    } catch (err) {
      console.error('[update-nft] On-chain update failed:', err);
      return c.json({ error: 'On-chain update failed' }, 500);
    }

    console.log(`[update-nft] Success: asset=${assetId} tx=${txSignature}`);
    return c.json({ signature: txSignature, newMetadataUri });
  } finally {
    releaseMutex(assetId);
  }
});

export { route };
