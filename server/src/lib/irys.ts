import { Uploader } from '@irys/upload';
import { Solana } from '@irys/upload-solana';
import type { BaseNodeIrys } from '@irys/upload/base';
import { DEPLOYER_KEYPAIR, IRYS_FUNDING_RPC } from '../config.ts';

// Irys L1 uploader — built once at startup and reused.
// Irys L1 has no testnet; the SDK's .devnet() routes to a deprecated Arweave
// bundler that returns placeholder content. All uploads go to L1 mainnet
// (uploader.irys.xyz). Funding verification runs against mainnet-beta Solana
// regardless of DEMO_MODE, since the deployer wallet's Irys balance is
// universal across Solana clusters.

let _irysPromise: Promise<BaseNodeIrys> | undefined;

async function buildIrys(): Promise<BaseNodeIrys> {
  const irys = await Uploader(Solana)
    .withWallet(new Uint8Array(DEPLOYER_KEYPAIR))
    .withRpc(IRYS_FUNDING_RPC)
    .mainnet();
  console.log(`[irys] address=${irys.address}`);
  return irys;
}

export function getIrys(): Promise<BaseNodeIrys> {
  if (!_irysPromise) {
    _irysPromise = buildIrys();
    // Clear on rejection so the next call retries instead of re-serving the failure.
    _irysPromise.catch(() => {
      _irysPromise = undefined;
    });
  }
  return _irysPromise;
}

/** Public gateway URL for an Irys tx id — uniform across testnet and mainnet. */
export function gatewayUrl(id: string): string {
  return `https://gateway.irys.xyz/${id}`;
}
