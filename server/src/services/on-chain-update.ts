import {
  publicKey,
  transactionBuilder,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import type { CollectionV1 } from '@metaplex-foundation/mpl-core';
import { update, fetchAsset, fetchCollection } from '@metaplex-foundation/mpl-core';
import {
  setComputeUnitLimit,
  setComputeUnitPrice,
} from '@metaplex-foundation/mpl-toolbox';
import { umi } from '../lib/umi.ts';
import { rpcCall } from '../lib/rpc.ts';
import { COLLECTION_ADDRESS } from '../config.ts';

const DEFAULT_PRIORITY_FEE = 50_000; // microlamports fallback

// Cache the collection account — it's stable and never changes between updates.
let collectionCache: CollectionV1 | null = null;

async function getCollection(): Promise<CollectionV1> {
  if (!collectionCache) {
    collectionCache = await fetchCollection(umi, publicKey(COLLECTION_ADDRESS));
  }
  return collectionCache;
}

/**
 * Fetch priority fee estimate from Helius DAS API.
 */
async function fetchPriorityFee(assetId: string): Promise<number> {
  try {
    const result = await rpcCall<{ priorityFeeEstimate?: number }>(
      'getPriorityFeeEstimate',
      [
        {
          accountKeys: [assetId, COLLECTION_ADDRESS],
          options: { priorityLevel: 'high' },
        },
      ],
    );
    return result.priorityFeeEstimate ?? DEFAULT_PRIORITY_FEE;
  } catch (err) {
    console.warn('[priority-fee] Failed to fetch, using default:', err);
    return DEFAULT_PRIORITY_FEE;
  }
}

/**
 * Update the on-chain asset URI using MPL Core's update().
 * Returns the base58-encoded transaction signature.
 */
export async function updateAssetUri(
  assetId: string,
  newMetadataUri: string,
): Promise<string> {
  // Parallelize independent RPC fetches
  const [priorityFee, asset, collection] = await Promise.all([
    fetchPriorityFee(assetId),
    fetchAsset(umi, publicKey(assetId)),
    getCollection(),
  ]);

  const sendAttempt = async () => {
    const tx = transactionBuilder()
      .add(setComputeUnitLimit(umi, { units: 400_000 }))
      .add(setComputeUnitPrice(umi, { microLamports: priorityFee }))
      .add(
        update(umi, {
          asset,
          collection,
          uri: newMetadataUri,
        }),
      );

    return await tx.sendAndConfirm(umi, {
      confirm: { commitment: 'confirmed' },
    });
  };

  // First attempt
  let result = await sendAttempt();

  // Retry once on failure
  if (result.result.value.err) {
    console.warn('[on-chain] First attempt failed, retrying...');
    result = await sendAttempt();
    if (result.result.value.err) {
      throw new Error(
        `On-chain update failed: ${JSON.stringify(result.result.value.err)}`,
      );
    }
  }

  const [sigStr] = base58.deserialize(result.signature);
  return sigStr;
}
