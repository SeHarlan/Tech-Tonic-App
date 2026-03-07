// Load and validate all env vars at startup. Throws immediately if any required var is missing.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

// Demo mode — true = devnet, false = mainnet
export const DEMO_MODE = (process.env.DEMO_MODE ?? 'true') === 'true';

// Deployer keypair — JSON array of secret key bytes (same format as ~/.config/solana/id.json)
// Set per environment (dev vs prod Railway service), not switched by DEMO_MODE.
export const DEPLOYER_KEYPAIR: number[] = JSON.parse(required('DEPLOYER_KEYPAIR'));

// RPC endpoint — DEMO_MODE selects between devnet and mainnet Helius endpoints.
export const RPC_ENDPOINT = DEMO_MODE
  ? required('DEVNET_RPC_ENDPOINT')
  : required('MAINNET_RPC_ENDPOINT');

// Collection address — follows the frontend's dual-address pattern.
// DEMO_MODE selects between dev collection and Season One (mainnet) collection.
export const COLLECTION_ADDRESS = DEMO_MODE
  ? required('COLLECTION_ADDRESS')
  : required('SEASON_ONE_COLLECTION_ADDRESS');

// CORS origins — comma-separated list of allowed frontend origins
export const ALLOWED_ORIGINS = required('ALLOWED_ORIGINS')
  .split(',')
  .map((o) => o.trim());

// Server port — Railway sets this automatically
export const PORT = parseInt(process.env.PORT || '3000', 10);

// Log resolved config (no secrets)
console.log(`[config] DEMO_MODE=${DEMO_MODE}`);
console.log(`[config] cluster=${DEMO_MODE ? 'devnet' : 'mainnet-beta'}`);
console.log(`[config] collection=${COLLECTION_ADDRESS}`);
console.log(`[config] origins=${ALLOWED_ORIGINS.join(', ')}`);
console.log(`[config] port=${PORT}`);
