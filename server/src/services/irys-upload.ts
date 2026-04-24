import { getIrys, gatewayUrl } from '../lib/irys.ts';

/** Retry an async operation once on empty return or throw, with a small backoff. */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T | undefined>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await fn();
      if (result) return result;
      console.warn(`[irys] ${label} returned empty (attempt ${attempt + 1}/2)`);
    } catch (err) {
      lastErr = err;
      console.warn(
        `[irys] ${label} threw (attempt ${attempt + 1}/2): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(
    `Failed to upload ${label} to Irys${lastErr instanceof Error ? `: ${lastErr.message}` : ''}`,
  );
}

/** Upload raw bytes to Irys L1. Returns a full gateway URL. */
export async function uploadFileWithRetry(
  fileBytes: Uint8Array,
  label: string,
  contentType: string,
): Promise<string> {
  const irys = await getIrys();
  const { id } = await withRetry(label, async () => {
    const receipt = await irys.upload(Buffer.from(fileBytes), {
      tags: [{ name: 'Content-Type', value: contentType }],
    });
    return receipt?.id ? receipt : undefined;
  });
  return gatewayUrl(id);
}

/** Upload a JSON object to Irys L1. Returns a full gateway URL. */
export async function uploadMetadataJson(
  metadata: Record<string, unknown>,
): Promise<string> {
  const irys = await getIrys();
  const { id } = await withRetry('metadata JSON', async () => {
    const receipt = await irys.upload(JSON.stringify(metadata), {
      tags: [{ name: 'Content-Type', value: 'application/json' }],
    });
    return receipt?.id ? receipt : undefined;
  });
  return gatewayUrl(id);
}
