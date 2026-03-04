export type SolanaCluster = 'devnet' | 'mainnet-beta';

export const CLUSTER: SolanaCluster =
  (import.meta.env.VITE_SOLANA_CLUSTER as SolanaCluster) || 'devnet';

export const RPC_ENDPOINT =
  import.meta.env.VITE_RPC_ENDPOINT ||
  (CLUSTER === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com');

// Candy Machine address - set after running create-candy-machine script
export const CANDY_MACHINE_ADDRESS =
  import.meta.env.VITE_CANDY_MACHINE_ADDRESS || '';

// Mint price in SOL — keep in sync with scripts/create-candy-machine.ts DEFAULT_PRICE_SOL
export const MINT_PRICE_SOL = 0.01;
