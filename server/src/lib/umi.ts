import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { DEPLOYER_KEYPAIR, RPC_ENDPOINT } from '../config.ts';

// Umi instance for MPL Core on-chain calls only. Irys uploads are handled by
// the standalone @irys/upload SDK (see ./irys.ts) — the deprecated
// umi-uploader-irys plugin wrote to the Arweave bundler which now returns
// a "Hello, Irys!" placeholder on devnet retrieval.
const umi = createUmi(RPC_ENDPOINT);
const keypair = umi.eddsa.createKeypairFromSecretKey(
  new Uint8Array(DEPLOYER_KEYPAIR),
);
umi.use(keypairIdentity(keypair));
umi.use(mplCore());

console.log(`[umi] identity=${keypair.publicKey}`);

export { umi };
