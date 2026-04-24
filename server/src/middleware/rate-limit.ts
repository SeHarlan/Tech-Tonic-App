// In-memory concurrency mutex — NOT the 7-day rate limit.
//
// The real 7-day-per-asset rate limit is enforced against the on-chain
// metadata JSON's `properties.last_update_at_ms` field (see routes/update-nft.ts
// and services/metadata.ts). That check is durable across deploys.
//
// This file guards only against *concurrent* requests for the same asset
// racing past the on-chain check before either finishes writing. Entries are
// cleared on success, failure, and after a short TTL.

const MUTEX_TTL_MS = 2 * 60 * 1000; // 2 minutes — longer than a normal upload

const inFlight = new Map<string, number>();

// Prune stale entries every 5 minutes. The route's try/finally releases the
// mutex after each request; this sweep only bounds the map for assetIds that
// never come back.
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of inFlight) {
    if (now - ts > MUTEX_TTL_MS) inFlight.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Try to acquire the in-flight mutex for an asset. Returns true on success,
 * false if another request is already in flight for this asset.
 */
export function acquireMutex(assetId: string): boolean {
  const now = Date.now();
  const existing = inFlight.get(assetId);
  if (existing && now - existing < MUTEX_TTL_MS) return false;
  inFlight.set(assetId, now);
  return true;
}

/** Release the mutex. Safe to call unconditionally in a finally block. */
export function releaseMutex(assetId: string): void {
  inFlight.delete(assetId);
}
