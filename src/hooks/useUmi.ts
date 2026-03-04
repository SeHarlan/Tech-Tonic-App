import { useMemo } from 'react';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplCandyMachine } from '@metaplex-foundation/mpl-candy-machine';
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
 * Converts Umi transactions to Uint8Array, passes to wallet for signing,
 * and deserializes the signed result back to Umi format.
 */
function createWalletSigner(
  address: string,
  connectorSigner: NonNullable<
    ReturnType<typeof useTransactionSigner>['signer']
  >,
  umi: ReturnType<typeof createUmi>,
): Signer {
  return {
    publicKey: publicKey(address),

    signTransaction: async (transaction: Transaction) => {
      const serialized = umi.transactions.serialize(transaction);
      const signed = await connectorSigner.signTransaction(serialized);

      // Handle various return formats from the connector
      if (signed instanceof Uint8Array) {
        return umi.transactions.deserialize(signed);
      }
      if (ArrayBuffer.isView(signed)) {
        return umi.transactions.deserialize(
          new Uint8Array(signed.buffer, signed.byteOffset, signed.byteLength),
        );
      }
      // web3.js Transaction or VersionedTransaction — has serialize()
      const bytes = (signed as { serialize(): Uint8Array }).serialize();
      return umi.transactions.deserialize(bytes);
    },

    signAllTransactions: async (transactions: Transaction[]) => {
      return Promise.all(
        transactions.map((tx) =>
          createWalletSigner(address, connectorSigner, umi).signTransaction(tx),
        ),
      );
    },

    signMessage: async (message: Uint8Array) => {
      if (connectorSigner.signMessage) {
        return connectorSigner.signMessage(message);
      }
      throw new Error('Wallet does not support message signing');
    },
  };
}

export function useUmi() {
  const { address } = useAccount();
  const { signer: walletSigner } = useTransactionSigner();

  return useMemo(() => {
    const umi = createUmi(RPC_ENDPOINT);
    umi.use(mplCandyMachine());

    if (address && walletSigner) {
      const signer = createWalletSigner(address, walletSigner, umi);
      umi.use(signerIdentity(signer));
    }

    return umi;
  }, [address, walletSigner]);
}
