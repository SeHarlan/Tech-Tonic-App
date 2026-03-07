// In-memory per-asset rate limiter.
// Resets on deploy — intentionally simple, fine for this use case.

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

const lastUpdate = new Map<string, number>();

// Prune stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of lastUpdate) {
    if (now - ts > COOLDOWN_MS) lastUpdate.delete(key);
  }
}, 10 * 60 * 1000);

/**
 * Check if an asset is rate-limited. Returns the remaining cooldown in ms, or 0 if allowed.
 */
export function checkRateLimit(assetId: string): number {
  const last = lastUpdate.get(assetId);
  if (!last) return 0;
  const elapsed = Date.now() - last;
  return elapsed < COOLDOWN_MS ? COOLDOWN_MS - elapsed : 0;
}

/**
 * Record that an asset was updated now.
 */
export function recordUpdate(assetId: string): void {
  lastUpdate.set(assetId, Date.now());
}

/**
 * Clear the rate limit for an asset (used when a request fails before the expensive work).
 */
export function clearUpdate(assetId: string): void {
  lastUpdate.delete(assetId);
}
