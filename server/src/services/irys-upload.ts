import { createGenericFile } from '@metaplex-foundation/umi';
import { umi } from '../lib/umi.ts';

/**
 * Retry an async operation once if it returns a falsy value.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T | undefined>,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await fn();
    if (result) return result;
    console.warn(
      `[irys] ${label} returned empty (attempt ${attempt + 1}/2), retrying...`,
    );
  }
  throw new Error(`Failed to upload ${label} to Arweave`);
}

/**
 * Upload a file to Irys/Arweave with one retry on empty URI.
 */
export async function uploadFileWithRetry(
  fileBytes: Uint8Array,
  filename: string,
  contentType: string,
): Promise<string> {
  const file = createGenericFile(fileBytes, filename, { contentType });
  return withRetry(filename, async () => {
    const [uri] = await umi.uploader.upload([file]);
    return uri;
  });
}

/**
 * Upload a metadata JSON object to Irys/Arweave with one retry on empty URI.
 */
export async function uploadMetadataJson(
  metadata: Record<string, unknown>,
): Promise<string> {
  return withRetry('metadata JSON', () => umi.uploader.uploadJson(metadata));
}
