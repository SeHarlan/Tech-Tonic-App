export type SolanaCluster = 'devnet' | 'mainnet-beta';

// Demo mode — defaults to true.
// true:  devnet, no phase timing, SKR phase shown as complete, public always active.
// false: real launch — mainnet, all guards + phase timing active.
export const DEMO_MODE = (import.meta.env.VITE_DEMO ?? 'true') === 'true';

export const CLUSTER: SolanaCluster = DEMO_MODE
  ? 'devnet'
  : (import.meta.env.VITE_SOLANA_CLUSTER as SolanaCluster) || 'devnet';

export const RPC_ENDPOINT =
  import.meta.env.VITE_RPC_ENDPOINT ||
  (CLUSTER === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com');

// Candy Machine addresses
// Demo uses the generic devnet CM (no time guards).
// Live uses the Season One CM (mainnet, full guards).
export const CANDY_MACHINE_ADDRESS = DEMO_MODE
  ? (import.meta.env.VITE_CANDY_MACHINE_ADDRESS || '')
  : (import.meta.env.VITE_SEASON_ONE_CANDY_MACHINE_ADDRESS || '');

// Collection address — static, derived from the candy machine's collectionMint.
// Set via env to avoid a runtime RPC call on every page load.
export const COLLECTION_ADDRESS = DEMO_MODE
  ? (import.meta.env.VITE_COLLECTION_ADDRESS || '')
  : (import.meta.env.VITE_SEASON_ONE_COLLECTION_ADDRESS || '');

// Mint prices — keep in sync with scripts/create-candy-machine.ts
export const MINT_PRICE_SOL = 1.11;
export const MINT_PRICE_SKR = 4200;

// SKR token mint (Seeker coin — mainnet only)
export const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';

// --- Mint phase timing ---
// When the Seeker Only phase begins (admin premint happens 24h before, off-timeline).
// Set via env before deploy; keep in sync with scripts/create-candy-machine.ts.
export const MINT_START_TIME =
  import.meta.env.VITE_MINT_START_TIME || '2026-04-01T00:00:00Z';

export interface MintPhase {
  label: string;
  group: string;
  durationMs: number | null; // null = no end
  disabledOnDevnet?: boolean;
}

export const MINT_PHASES: MintPhase[] = [
  { label: 'Seeker Only', group: 'skr', durationMs: 24 * 60 * 60 * 1000, disabledOnDevnet: true },
  { label: 'Public', group: 'public', durationMs: null },
];
