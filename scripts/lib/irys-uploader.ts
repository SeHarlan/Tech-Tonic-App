import { Uploader } from '@irys/upload';
import { Solana } from '@irys/upload-solana';
import type { BaseNodeIrys } from '@irys/upload/base';

export type IrysUploader = BaseNodeIrys;

/**
 * Build an Irys L1 mainnet uploader bound to the given Solana keypair.
 *
 * Irys L1 has no testnet — the SDK's .devnet() routes to the deprecated
 * Arweave bundler devnet node, which returns a "Hello, Irys!" placeholder
 * on reads. All uploads go to uploader.irys.xyz (L1 Publish ledger).
 *
 * Funding is verified against mainnet-beta Solana. The caller should pass
 * a mainnet Solana RPC URL even if the rest of the app is pointing at
 * devnet — uploaded files are usable by any Solana cluster since Irys
 * URIs (gateway.irys.xyz) are chain-agnostic.
 */
export async function createIrys(
  keypairData: number[],
  solanaMainnetRpcUrl: string,
): Promise<IrysUploader> {
  return Uploader(Solana)
    .withWallet(new Uint8Array(keypairData))
    .withRpc(solanaMainnetRpcUrl)
    .mainnet();
}

export function gatewayUrl(id: string): string {
  return `https://gateway.irys.xyz/${id}`;
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T | undefined>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await fn();
      if (result) return result;
      console.warn(`  ${label} returned empty (attempt ${attempt + 1}/2), retrying...`);
    } catch (err) {
      lastErr = err;
      console.warn(
        `  ${label} threw (attempt ${attempt + 1}/2): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 750));
  }
  throw new Error(
    `Failed to upload ${label} to Irys${lastErr instanceof Error ? `: ${lastErr.message}` : ''}`,
  );
}

export async function uploadBytes(
  irys: IrysUploader,
  bytes: Uint8Array,
  label: string,
  contentType: string,
): Promise<string> {
  const { id } = await withRetry(label, async () => {
    const receipt = await irys.upload(Buffer.from(bytes), {
      tags: [{ name: 'Content-Type', value: contentType }],
    });
    return receipt?.id ? receipt : undefined;
  });
  return gatewayUrl(id);
}

export async function uploadJson(
  irys: IrysUploader,
  obj: unknown,
): Promise<string> {
  const { id } = await withRetry('metadata JSON', async () => {
    const receipt = await irys.upload(JSON.stringify(obj), {
      tags: [{ name: 'Content-Type', value: 'application/json' }],
    });
    return receipt?.id ? receipt : undefined;
  });
  return gatewayUrl(id);
}
