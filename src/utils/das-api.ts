import { RPC_ENDPOINT, DEMO_MODE } from '../../config/env';

export interface NftAttribute {
  trait_type: string;
  value: string;
}

export interface NftItem {
  id: string;
  name: string;
  seed: number;
  frameCount: number;
  defaultWaterfallMode: boolean;
  manualMode: boolean;
  iterations: number;
  thumbnailUrl: string;
  attributes: NftAttribute[];
}

interface DasAsset {
  id: string;
  content: {
    metadata: {
      name: string;
      attributes?: Array<{ trait_type: string; value: string }>;
    };
    links?: { image?: string };
    files?: Array<{ uri: string; cdn_uri?: string; mime: string }>;
  };
  grouping?: Array<{ group_key: string; group_value: string }>;
}

function assetToNftItem(asset: DasAsset): NftItem {
  const attrs = asset.content.metadata.attributes ?? [];
  const seedAttr = attrs.find((a) => a.trait_type === 'Seed');
  const seed = seedAttr ? Number(seedAttr.value) : 0;
  const frameCountAttr = attrs.find((a) => a.trait_type === 'Frame Count');
  const frameCount = frameCountAttr ? Number(frameCountAttr.value) : 33 * 60;
  const waterfallAttr = attrs.find((a) => a.trait_type === 'Waterfall');
  const defaultWaterfallMode = waterfallAttr ? waterfallAttr.value === 'On' : false;
  const manualModeAttr = attrs.find((a) => a.trait_type === 'Manual Mode');
  const manualMode = manualModeAttr ? manualModeAttr.value === 'On' : false;
  const iterationsAttr = attrs.find((a) => a.trait_type === 'Iterations');
  const iterations = iterationsAttr ? Number(iterationsAttr.value) : 0;

  // Image URL priority — prefer raw gateway URLs for CORS compatibility (needed by
  // WebGL texImage2D with crossOrigin='anonymous'). The Helius CDN proxy does not
  // serve Access-Control-Allow-Origin headers.
  //  1. content.links.image — canonical image URL from metadata JSON (Arweave/Irys gateway)
  //  2. files[].uri — raw gateway URL
  //  3. files[].cdn_uri — Helius CDN proxy (fallback; won't work for WebGL cross-origin)
  const imageFile = asset.content.files?.find((f) => f.mime.startsWith('image/'));

  //TODO create a better fallback system, with cdn tried first and fallback to links/image if cdn url fails
  let imageUrl =
    asset.content.links?.image ?? imageFile?.uri ?? imageFile?.cdn_uri ?? '';

  // Devnet assets are uploaded to the devnet Irys node but metadata references
  // the mainnet gateway. Rewrite to the devnet gateway in demo mode.
  if (DEMO_MODE && imageUrl.includes('gateway.irys.xyz')) {
    imageUrl = imageUrl.replace('gateway.irys.xyz', 'devnet.irys.xyz');
  }

  return {
    id: asset.id,
    name: asset.content.metadata.name,
    seed,
    frameCount,
    defaultWaterfallMode,
    manualMode,
    iterations,
    thumbnailUrl: imageUrl,
    attributes: attrs,
  };
}

async function dasRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(RPC_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

/** Fetch all minted assets in a collection via DAS */
export async function fetchCollectionAssets(collectionAddress: string): Promise<NftItem[]> {
  const result = await dasRpc<{ items: DasAsset[] }>('getAssetsByGroup', {
    groupKey: 'collection',
    groupValue: collectionAddress,
    page: 1,
    limit: 1000,
  });
  return result.items.map(assetToNftItem);
}

/** Estimate an optimal priority fee via Helius getPriorityFeeEstimate */
export async function fetchPriorityFee(
  accountKeys: string[],
  level: 'min' | 'low' | 'medium' | 'high' | 'veryHigh' | 'unsafeMax' = 'high',
): Promise<number> {
  try {
    const result = await dasRpc<{ priorityFeeEstimate: number }>(
      'getPriorityFeeEstimate',
      {
        accountKeys,
        options: { priorityLevel: level },
      },
    );
    return Math.round(result.priorityFeeEstimate);
  } catch {
    // Fallback: 50k microlamports if the estimate call fails
    return 50_000;
  }
}

/** Fetch assets owned by a wallet, filtered to a specific collection */
export async function fetchOwnedCollectionAssets(
  ownerAddress: string,
  collectionAddress: string,
): Promise<NftItem[]> {
  // Try searchAssets with grouping filter first (server-side filtering).
  // Fall back to getAssetsByOwner with client-side filtering if unsupported.
  try {
    const result = await dasRpc<{ items: DasAsset[] }>('searchAssets', {
      ownerAddress,
      grouping: ['collection', collectionAddress],
      page: 1,
      limit: 1000,
    });
    console.log(`[DAS] searchAssets returned ${result.items.length} items`);
    return result.items.map(assetToNftItem);
  } catch (err) {
    console.warn('[DAS] searchAssets failed, falling back to getAssetsByOwner:', err);
    const result = await dasRpc<{ items: DasAsset[] }>('getAssetsByOwner', {
      ownerAddress,
      page: 1,
      limit: 1000,
    });
    const filtered = result.items.filter((a) =>
      a.grouping?.some(
        (g) => g.group_key === 'collection' && g.group_value === collectionAddress,
      ),
    );
    console.log(`[DAS] getAssetsByOwner returned ${result.items.length} total, ${filtered.length} in collection`);
    return filtered.map(assetToNftItem);
  }
}
