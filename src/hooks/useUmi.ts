import { useMemo } from 'react';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCandyMachine } from '@metaplex-foundation/mpl-core-candy-machine';
import { mplCore } from '@metaplex-foundation/mpl-core';
import {
  signerIdentity,
  publicKey,
  type Signer,
  type Transaction,
} from '@metaplex-foundation/umi';
import { useAccount, useTransactionSigner } from '@solana/connector';
import { RPC_ENDPOINT } from '../config/env';

/**
 * Bridge @solana/connector's TransactionSigner to Umi's Signer interface.
 * Serializes Umi transactions → Uint8Array for the wallet, then deserializes
 * the signed bytes back into Umi's Transaction type.
 */
function createWalletSigner(
  address: string,
  connectorSigner: NonNullable<
    ReturnType<typeof useTransactionSigner>['signer']
  >,
  umi: ReturnType<typeof createUmi>,
): Signer {
  const pk = publicKey(address);

  const signTransaction = async (transaction: Transaction) => {
    const serialized = umi.transactions.serialize(transaction);
    const signed = await connectorSigner.signTransaction(serialized);
    const signedBytes = signed instanceof Uint8Array
      ? signed
      : new Uint8Array(signed.buffer, signed.byteOffset, signed.byteLength);
    return umi.transactions.deserialize(signedBytes);
  };

  return {
    publicKey: pk,
    signTransaction,
    signAllTransactions: (txs: Transaction[]) =>
      Promise.all(txs.map(signTransaction)),
    signMessage: async (message: Uint8Array) => {
      if (!connectorSigner.signMessage) {
        throw new Error('Wallet does not support message signing');
      }
      return connectorSigner.signMessage(message);
    },
  };
}

export function useUmi() {
  const { address } = useAccount();
  const { signer: walletSigner } = useTransactionSigner();

  return useMemo(() => {
    const umi = createUmi(RPC_ENDPOINT);
    umi.use(mplCore());
    umi.use(mplCandyMachine());

    if (address && walletSigner) {
      umi.use(signerIdentity(createWalletSigner(address, walletSigner, umi)));
    }

    return umi;
  }, [address, walletSigner]);
}
