import { DEMO_MODE } from '../config.ts';

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
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const ALLOWED_METADATA_HOSTS = [
  'https://arweave.net/',
  'https://gateway.irys.xyz/',
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

  // Devnet assets store URIs pointing to gateway.irys.xyz (mainnet) but content
  // lives on devnet.irys.xyz. Rewrite the URL for fetching, same as the frontend.
  let fetchUrl = jsonUri;
  if (DEMO_MODE && fetchUrl.includes('gateway.irys.xyz')) {
    fetchUrl = fetchUrl.replace('gateway.irys.xyz', 'devnet.irys.xyz');
  }

  const res = await fetch(fetchUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch existing metadata: ${res.status}`);
  }
  return (await res.json()) as NftMetadata;
}

/**
 * Build updated metadata JSON with new image and buffer URIs.
 * Increments the Iteration attribute by 1.
 * Preserves all existing top-level fields to avoid data loss.
 */
export function buildUpdatedMetadata(
  existing: NftMetadata,
  imageUri: string,
  movementUri: string,
  paintUri: string,
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
    },
  };
}
