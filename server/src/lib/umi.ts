import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { irysUploader } from '@metaplex-foundation/umi-uploader-irys';
import { mplCore } from '@metaplex-foundation/mpl-core';
import { keypairIdentity } from '@metaplex-foundation/umi';
import { DEPLOYER_KEYPAIR, RPC_ENDPOINT } from '../config.ts';

// Create once at startup, reuse across requests.
// Uses the deployer keypair as the identity — this is the collection's update authority.
// irysUploader() imported from the default entry (not /web) uses the keypair directly.
const umi = createUmi(RPC_ENDPOINT);
const keypair = umi.eddsa.createKeypairFromSecretKey(
  new Uint8Array(DEPLOYER_KEYPAIR),
);
umi.use(keypairIdentity(keypair));
umi.use(irysUploader());
umi.use(mplCore());

console.log(`[umi] identity=${keypair.publicKey}`);

export { umi };
