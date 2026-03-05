import { RPC_ENDPOINT } from '../config/env';

export interface NftAttribute {
  trait_type: string;
  value: string;
}

export interface NftItem {
  id: string;
  name: string;
  seed: number;
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

  // Image URL priority (per Helius DAS docs):
  //  1. cdn_uri from the first image file — Helius CDN proxy, most reliable
  //  2. content.links.image — canonical image from metadata JSON
  //  3. files[].uri from the first image file — raw gateway URL (Irys/Arweave/etc.)
  const imageFile = asset.content.files?.find((f) => f.mime.startsWith('image/'));
  const imageUrl =
    imageFile?.cdn_uri ?? asset.content.links?.image ?? imageFile?.uri ?? '';

  return {
    id: asset.id,
    name: asset.content.metadata.name,
    seed,
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

/** Fetch assets owned by a wallet, filtered to a specific collection */
export async function fetchOwnedCollectionAssets(
  ownerAddress: string,
  collectionAddress: string,
): Promise<NftItem[]> {
  const result = await dasRpc<{ items: DasAsset[] }>('getAssetsByOwner', {
    ownerAddress,
    page: 1,
    limit: 1000,
  });
  return result.items
    .filter((a) =>
      a.grouping?.some(
        (g) => g.group_key === 'collection' && g.group_value === collectionAddress,
      ),
    )
    .map(assetToNftItem);
}
