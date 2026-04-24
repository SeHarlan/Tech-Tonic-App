interface Attribute {
  trait_type: string;
  value: string;
}

interface NftMetadata {
  name: string;
  symbol: string;
  description: string;
  image: string;
  attributes: Attribute[];
  properties: {
    files: Array<{ uri: string; type: string }>;
    category: string;
    original_image?: string;
    last_update_at_ms?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export const UPDATE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const ALLOWED_METADATA_HOSTS = [
  'https://arweave.net/',
  'https://gateway.irys.xyz/',
  // Legacy hosts from the deprecated Arweave-bundler devnet path. Retained
  // only for reading older pre-migration NFTs; new URIs are all gateway.irys.xyz.
  'https://devnet.irys.xyz/',
];

/**
 * Fetch existing metadata JSON from the asset's json_uri.
 * Validates the URL against known Arweave/Irys gateways to prevent SSRF.
 */
export async function fetchExistingMetadata(
  jsonUri: string,
): Promise<NftMetadata> {
  if (!ALLOWED_METADATA_HOSTS.some((host) => jsonUri.startsWith(host))) {
    throw new Error('Metadata URI is not from a known Arweave/Irys gateway');
  }

  const res = await fetch(jsonUri);
  if (!res.ok) {
    throw new Error(`Failed to fetch existing metadata: ${res.status}`);
  }
  return (await res.json()) as NftMetadata;
}

/**
 * Returns the number of ms still remaining in the 7-day cooldown, or 0 if
 * the asset is allowed to update now. Treats missing or invalid fields as
 * "never updated" — first update is always free.
 */
export function cooldownRemaining(existing: NftMetadata): number {
  const last = existing.properties.last_update_at_ms;
  if (typeof last !== 'number' || !Number.isFinite(last)) return 0;
  const elapsed = Date.now() - last;
  if (elapsed < 0 || elapsed >= UPDATE_COOLDOWN_MS) return 0;
  return UPDATE_COOLDOWN_MS - elapsed;
}

export interface UpdateInputs {
  imageUri: string;
  movementUri: string;
  paintUri: string;
  walletAddress: string;
}

/**
 * Build updated metadata JSON with new image and buffer URIs.
 * Increments the Iteration attribute by 1.
 * Stamps properties.last_update_at_ms with the current server time — read
 * back on the next update request to enforce the 7-day cooldown on-chain.
 */
export function buildUpdatedMetadata(
  existing: NftMetadata,
  { imageUri, movementUri, paintUri, walletAddress }: UpdateInputs,
): NftMetadata {
  // Increment Iteration attribute
  let foundIteration = false;
  const attributes = existing.attributes.map((attr) => {
    if (attr.trait_type === 'Iteration') {
      foundIteration = true;
      const current = parseInt(attr.value, 10);
      if (isNaN(current)) {
        throw new Error(`Iteration attribute is not a number: "${attr.value}"`);
      }
      return { ...attr, value: String(current + 1) };
    }
    return attr;
  });
  if (!foundIteration) {
    attributes.push({ trait_type: 'Iteration', value: '1' });
  }

  // Track unique editor wallet addresses
  const editorsIdx = attributes.findIndex((a) => a.trait_type === 'Editors');
  const editorsAttr = editorsIdx === -1 ? undefined : attributes[editorsIdx];
  if (!editorsAttr) {
    attributes.push({ trait_type: 'Editors', value: walletAddress });
  } else {
    const editors = editorsAttr.value.split(',');
    if (!editors.includes(walletAddress)) {
      attributes[editorsIdx] = {
        ...editorsAttr,
        value: editorsAttr.value + ',' + walletAddress,
      };
    }
  }

  return {
    ...existing,
    image: imageUri,
    attributes,
    properties: {
      ...existing.properties,
      files: [
        { uri: imageUri, type: 'image/png' },
        { uri: movementUri, type: 'image/techtonic-movement' },
        { uri: paintUri, type: 'image/techtonic-paint' },
      ],
      category: 'image',
      last_update_at_ms: Date.now(),
    },
  };
}
