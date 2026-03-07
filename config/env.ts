// Single source of truth for all env vars and shared constants.
// Works in both Vite (import.meta.env) and Bun (aliases import.meta.env to process.env).

export type SolanaCluster = 'devnet' | 'mainnet-beta';

// --- Constants ---

// Mint prices — keep in sync with candy machine guard config
export const MINT_PRICE_SOL = 1;
export const MINT_PRICE_SKR = 20_000_000;

// SKR token mint (Seeker coin — mainnet only)
export const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
export const SKR_DECIMALS = 6;

// Royalties
export const ROYALTY_BPS = 1000; // 10%
export const ROYALTY_WALLET = 'EZAdWMUWCKSPH6r6yNysspQsZULwT9zZPqQzRhrUNwDX';

// Admin wallets for free preminting (allowList guard group)
export const ADMIN_WALLETS = [
  'EZAdWMUWCKSPH6r6yNysspQsZULwT9zZPqQzRhrUNwDX',
  'HsnsEpjV2nqUukLmyRTkurgXf37u7fi8pRbDuLJmdcN1',
];

// Candy machine config
export const MINT_LIMIT = 3;
export const BOT_TAX_SOL = 0.001;
export const NAME_PREFIX = 'TechTonic #';
export const COLLECTION_NAME = 'TechTonic Season One';
export const COLLECTION_DESCRIPTION =
  'The first TechTonic generative art collection.';
export const CONFIG_LINES_BATCH_SIZE = 10;

// Mint phase timing
export interface MintPhase {
  label: string;
  group: string;
  durationMs: number | null; // null = no end
  disabledOnDevnet?: boolean;
}

export const PHASE_DURATION_MS = 24 * 60 * 60 * 1000; // 24h

export const MINT_PHASES: MintPhase[] = [
  { label: 'Seeker Only', group: 'skr', durationMs: PHASE_DURATION_MS, disabledOnDevnet: true },
  { label: 'Public', group: 'public', durationMs: null },
];

// --- Environment variables ---

// Default RPC endpoints (public, no API key — use env vars for keyed endpoints)
const DEFAULT_RPC_DEVNET = 'https://api.devnet.solana.com';
const DEFAULT_RPC_MAINNET = 'https://api.mainnet-beta.solana.com';

// Demo mode — defaults to true.
// true:  devnet, no phase timing, SKR phase shown as complete, public always active.
// false: real launch — mainnet, all guards + phase timing active.
export const DEMO_MODE = (import.meta.env.VITE_DEMO ?? 'true') === 'true';

export const CLUSTER: SolanaCluster = DEMO_MODE
  ? 'devnet'
  : (import.meta.env.VITE_SOLANA_CLUSTER as SolanaCluster) || 'devnet';

export const RPC_ENDPOINT = CLUSTER === 'mainnet-beta'
  ? (import.meta.env.VITE_MAINNET_RPC_ENDPOINT || DEFAULT_RPC_MAINNET)
  : (import.meta.env.VITE_DEVNET_RPC_ENDPOINT || DEFAULT_RPC_DEVNET);

// Candy Machine addresses
// Demo uses the generic devnet CM (no time guards).
// Live uses the Season One CM (mainnet, full guards).
export const CANDY_MACHINE_ADDRESS = DEMO_MODE
  ? (import.meta.env.VITE_CANDY_MACHINE_ADDRESS || '')
  : (import.meta.env.VITE_SEASON_ONE_CANDY_MACHINE_ADDRESS || '');

// Collection address — static, derived from the candy machine's collectionMint.
export const COLLECTION_ADDRESS = DEMO_MODE
  ? (import.meta.env.VITE_COLLECTION_ADDRESS || '')
  : (import.meta.env.VITE_SEASON_ONE_COLLECTION_ADDRESS || '');

// When the Seeker Only phase begins (admin premint happens 24h before, off-timeline).
export const MINT_START_TIME =
  import.meta.env.VITE_MINT_START_TIME || undefined;

// Backend URL for NFT on-chain updates (Hono + Bun on Railway)
export const UPDATE_API_URL =
  import.meta.env.VITE_UPDATE_API_URL || '';
