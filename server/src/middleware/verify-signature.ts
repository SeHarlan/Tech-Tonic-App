import * as ed25519 from '@noble/ed25519';
import bs58 from 'bs58';

/**
 * Verify that `signature` is a valid ed25519 signature of `message` by `walletAddress`.
 * Returns true if valid, false otherwise.
 */
export async function verifySignature(
  walletAddress: string,
  signature: string,
  message: string,
): Promise<boolean> {
  try {
    const publicKey = bs58.decode(walletAddress);
    const sig = bs58.decode(signature);
    const messageBytes = new TextEncoder().encode(message);
    return await ed25519.verifyAsync(sig, messageBytes, publicKey);
  } catch {
    return false;
  }
}
