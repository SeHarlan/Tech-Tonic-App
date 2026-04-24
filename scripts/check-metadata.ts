/**
 * Verify NFT metadata health post-Irys-L1 migration.
 *
 * Works for both demo (devnet) and production (mainnet). The Solana cluster
 * and collection address are auto-selected from VITE_DEMO via config/env.ts.
 * Irys gateway URLs are uniform across both networks (gateway.irys.xyz) so
 * the same verification logic applies.
 *
 * For each asset checked, reports:
 *   - on-chain json_uri
 *   - last_update_at_ms + remaining cooldown (if any)
 *   - image URL + HEAD status + whether content looks like the deprecated
 *     "Hello, Irys!" placeholder (12 bytes = broken, pre-migration upload)
 *
 * Usage:
 *   bun run scripts/check-metadata.ts                   # scan full collection
 *   bun run scripts/check-metadata.ts --asset <id>      # single asset
 *   bun run scripts/check-metadata.ts --limit 5         # first 5 only
 *   bun run scripts/check-metadata.ts --verbose         # show each OK asset
 */

import {
  RPC_ENDPOINT,
  COLLECTION_ADDRESS,
  CLUSTER,
} from '../config/env';

const IRYS_PLACEHOLDER_BYTES = 12; // "Hello, Irys!" length — the known deprecated-bundler response
const UPDATE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

interface DasAsset {
  id: string;
  content: {
    json_uri: string;
    metadata: { name: string };
    links?: { image?: string };
    files?: Array<{ uri?: string; mime: string }>;
  };
  ownership?: { owner: string };
}

interface NftMetadataProps {
  files?: Array<{ uri: string; type: string }>;
  last_update_at_ms?: number;
  [k: string]: unknown;
}
interface NftMetadata {
  name: string;
  image?: string;
  attributes?: Array<{ trait_type: string; value: string }>;
  properties?: NftMetadataProps;
}

interface CheckResult {
  id: string;
  name: string;
  jsonUri: string;
  jsonOk: boolean;
  jsonError?: string;
  lastUpdateAtMs?: number;
  cooldownRemainingMs: number;
  imageUrl?: string;
  imageStatus?: number;
  imageContentLength?: number;
  imageLooksLikePlaceholder: boolean;
  iteration?: string;
}

interface Args {
  assetId?: string;
  limit?: number;
  verbose: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { verbose: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--asset':
        args.assetId = argv[++i];
        break;
      case '--limit': {
        const v = Number(argv[++i]);
        if (!Number.isFinite(v) || v <= 0) throw new Error('--limit must be a positive number');
        args.limit = v;
        break;
      }
      case '--verbose':
      case '-v':
        args.verbose = true;
        break;
      case '--help':
      case '-h':
        console.log(`
Usage:
  bun run scripts/check-metadata.ts                scan whole collection
  bun run scripts/check-metadata.ts --asset <id>   check a single asset
  bun run scripts/check-metadata.ts --limit 5      first 5 only
  bun run scripts/check-metadata.ts --verbose      show OK assets too
`);
        process.exit(0);
    }
  }
  return args;
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

function formatDuration(ms: number): string {
  if (ms < 0) return '0';
  const dayMs = 24 * 60 * 60 * 1000;
  if (ms >= dayMs) return `${Math.ceil(ms / dayMs)} day(s)`;
  return `${Math.ceil(ms / (60 * 60 * 1000))} hour(s)`;
}

async function checkAsset(asset: DasAsset): Promise<CheckResult> {
  const jsonUri = asset.content.json_uri;
  const result: CheckResult = {
    id: asset.id,
    name: asset.content.metadata.name,
    jsonUri,
    jsonOk: false,
    cooldownRemainingMs: 0,
    imageLooksLikePlaceholder: false,
  };

  // Fetch metadata JSON
  let metadata: NftMetadata | undefined;
  try {
    const res = await fetch(jsonUri);
    if (!res.ok) {
      result.jsonError = `HTTP ${res.status}`;
      return result;
    }
    metadata = await res.json();
    result.jsonOk = true;
  } catch (err) {
    result.jsonError = err instanceof Error ? err.message : String(err);
    return result;
  }

  // Cooldown
  const last = metadata?.properties?.last_update_at_ms;
  if (typeof last === 'number' && Number.isFinite(last)) {
    result.lastUpdateAtMs = last;
    const elapsed = Date.now() - last;
    if (elapsed >= 0 && elapsed < UPDATE_COOLDOWN_MS) {
      result.cooldownRemainingMs = UPDATE_COOLDOWN_MS - elapsed;
    }
  }

  // Iteration attribute for quick "has this been updated?" view
  const iter = metadata?.attributes?.find((a) => a.trait_type === 'Iteration');
  if (iter) result.iteration = iter.value;

  // Image probe
  const imageUrl =
    metadata?.image ??
    metadata?.properties?.files?.find((f) => f.type === 'image/png')?.uri;
  if (imageUrl) {
    result.imageUrl = imageUrl;
    try {
      const res = await fetch(imageUrl, { method: 'HEAD' });
      result.imageStatus = res.status;
      const lenHeader = res.headers.get('content-length');
      if (lenHeader) {
        const len = Number(lenHeader);
        result.imageContentLength = len;
        if (len === IRYS_PLACEHOLDER_BYTES) {
          result.imageLooksLikePlaceholder = true;
        }
      }
      // If HEAD omits content-length, do a ranged GET for the first 16 bytes
      if (result.imageContentLength === undefined) {
        const rangeRes = await fetch(imageUrl, {
          headers: { Range: 'bytes=0-15' },
        });
        if (rangeRes.ok) {
          const text = await rangeRes.text();
          if (text.startsWith('Hello, Irys!')) {
            result.imageLooksLikePlaceholder = true;
          }
        }
      }
    } catch (err) {
      result.imageStatus = 0;
      console.warn(`  [${result.name}] image fetch threw: ${err instanceof Error ? err.message : err}`);
    }
  }

  return result;
}

function printResult(r: CheckResult, verbose: boolean): boolean {
  const issues: string[] = [];
  if (!r.jsonOk) issues.push(`metadata fetch failed (${r.jsonError})`);
  if (r.imageLooksLikePlaceholder) issues.push('image is deprecated-bundler placeholder');
  if (r.imageStatus !== undefined && r.imageStatus !== 200 && r.imageStatus !== 0) {
    issues.push(`image HTTP ${r.imageStatus}`);
  }
  if (r.jsonOk && r.lastUpdateAtMs === undefined && r.iteration && r.iteration !== '0') {
    issues.push('updated asset missing last_update_at_ms (pre-migration update)');
  }

  const hasIssues = issues.length > 0;
  if (!hasIssues && !verbose) return hasIssues;

  const marker = hasIssues ? 'FAIL' : 'OK  ';
  console.log(`\n[${marker}] ${r.name} — ${r.id}`);
  console.log(`  json_uri:        ${r.jsonUri}`);
  if (r.iteration) console.log(`  iteration:       ${r.iteration}`);
  if (r.lastUpdateAtMs !== undefined) {
    const stamped = new Date(r.lastUpdateAtMs).toISOString();
    const cooldown =
      r.cooldownRemainingMs > 0
        ? `cooldown remaining: ${formatDuration(r.cooldownRemainingMs)}`
        : 'cooldown expired (update allowed)';
    console.log(`  last_update_at:  ${stamped} (${cooldown})`);
  } else if (r.jsonOk) {
    console.log(`  last_update_at:  — (never updated)`);
  }
  if (r.imageUrl) {
    const lenStr =
      r.imageContentLength !== undefined ? `${r.imageContentLength} bytes` : 'unknown length';
    console.log(`  image:           HTTP ${r.imageStatus ?? '?'} ${lenStr} ${r.imageUrl}`);
  }
  for (const issue of issues) console.log(`  !! ${issue}`);

  return hasIssues;
}

async function main() {
  const args = parseArgs();

  console.log('\n=== Metadata Health Check ===');
  console.log(`  Solana:       ${CLUSTER}`);
  console.log(`  Irys:         L1 mainnet (gateway.irys.xyz)`);
  console.log(`  RPC:          ${RPC_ENDPOINT}`);
  console.log(`  Collection:   ${COLLECTION_ADDRESS || '(none)'}\n`);

  if (args.assetId) {
    const asset = await dasRpc<DasAsset>('getAsset', { id: args.assetId });
    const result = await checkAsset(asset);
    const hasIssues = printResult(result, true);
    console.log(`\n${hasIssues ? 'Issues found.' : 'OK.'}\n`);
    process.exit(hasIssues ? 1 : 0);
  }

  if (!COLLECTION_ADDRESS) {
    console.error('Error: COLLECTION_ADDRESS not set in env.');
    process.exit(1);
  }

  console.log('Fetching collection assets...');
  const page = await dasRpc<{ items: DasAsset[] }>('getAssetsByGroup', {
    groupKey: 'collection',
    groupValue: COLLECTION_ADDRESS,
    page: 1,
    limit: 1000,
  });
  const all = args.limit ? page.items.slice(0, args.limit) : page.items;
  console.log(`Checking ${all.length} asset(s)${args.limit ? ` (limited from ${page.items.length})` : ''}...`);

  let failCount = 0;
  let updatedCount = 0;
  let inCooldownCount = 0;

  // Sequential — keeps log output readable and doesn't hammer the RPC/gateway.
  for (const asset of all) {
    const r = await checkAsset(asset);
    if (r.lastUpdateAtMs !== undefined) updatedCount++;
    if (r.cooldownRemainingMs > 0) inCooldownCount++;
    if (printResult(r, args.verbose)) failCount++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Checked:       ${all.length}`);
  console.log(`  Updated:       ${updatedCount}`);
  console.log(`  In cooldown:   ${inCooldownCount}`);
  console.log(`  With issues:   ${failCount}`);
  console.log('');

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
