export type SolanaCluster = 'devnet' | 'mainnet-beta';

export const CLUSTER: SolanaCluster =
  (import.meta.env.VITE_SOLANA_CLUSTER as SolanaCluster) || 'devnet';

export const RPC_ENDPOINT =
  import.meta.env.VITE_RPC_ENDPOINT ||
  (CLUSTER === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com');

export const MALLOW_API_BASE = 'https://api.mallow.art';

// Gumball machine address - set after creation on mallow.art
export const GUMBALL_KEY = import.meta.env.VITE_GUMBALL_KEY || '';
