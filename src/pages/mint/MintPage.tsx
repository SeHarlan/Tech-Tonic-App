import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useConnector, useAccount } from '@solana/connector';
import {
  generateSigner,
  transactionBuilder,
  publicKey,
  some,
} from '@metaplex-foundation/umi';
import {
  mintV2,
  fetchCandyMachine,
  fetchCandyGuard,
} from '@metaplex-foundation/mpl-candy-machine';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { MenuButton } from '../../components/ui/MenuButton';
import { WalletButton } from '../../components/ui/WalletButton';
import { useUmi } from '../../hooks/useUmi';
import { CANDY_MACHINE_ADDRESS, MINT_PRICE_SOL } from '../../config/env';
import { cn } from '../../utils/ui-helpers';
import './mint-page.css';

type MintStatus = 'idle' | 'minting' | 'success' | 'error';

export function MintPage() {
  const navigate = useNavigate();
  const { isConnected } = useConnector();
  const { address } = useAccount();
  const umi = useUmi();

  const [status, setStatus] = useState<MintStatus>('idle');
  const [error, setError] = useState<string>('');

  const handleMint = async () => {
    if (!address || !CANDY_MACHINE_ADDRESS) return;

    setStatus('minting');
    setError('');

    try {
      const cmPublicKey = publicKey(CANDY_MACHINE_ADDRESS);

      const candyMachine = await fetchCandyMachine(umi, cmPublicKey);
      const candyGuard = await fetchCandyGuard(umi, candyMachine.mintAuthority);

      const solPaymentGuard = candyGuard.guards.solPayment;
      const solPaymentDest = solPaymentGuard.__option === 'Some'
        ? solPaymentGuard.value.destination
        : undefined;

      const nftMint = generateSigner(umi);

      await transactionBuilder()
        .add(setComputeUnitLimit(umi, { units: 800_000 }))
        .add(
          mintV2(umi, {
            candyMachine: cmPublicKey,
            nftMint,
            collectionMint: candyMachine.collectionMint,
            collectionUpdateAuthority: candyMachine.authority,
            tokenStandard: candyMachine.tokenStandard,
            mintArgs: {
              solPayment: solPaymentDest
                ? some({ destination: solPaymentDest })
                : undefined,
              mintLimit: some({ id: 1 }),
            },
          }),
        )
        .sendAndConfirm(umi);

      setStatus('success');
      setTimeout(() => navigate('/'), 1500);
    } catch (err) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : 'Mint failed';
      setError(msg);
      console.error('Mint error:', err);
    }
  };

  return (
    <div className="mint-page fixed inset-0 flex flex-col items-center justify-center p-6">
      {/* CRT vignette */}
      <div className="mint-vignette" />

      {/* Glitch bars */}
      <span className="mint-glitch mint-glitch-a" />
      <span className="mint-glitch mint-glitch-b" />
      <span className="mint-glitch mint-glitch-c" />

      {/* Terminal frame */}
      <div className="mint-frame w-full max-w-sm px-8 py-10 flex flex-col items-center gap-6">
        {/* Corner bracket decorations */}
        <span className="mint-corner-bl" />
        <span className="mint-corner-br" />

        {/* Content */}
        <div className="relative z-1 flex flex-col items-center gap-6 w-full">
          {/* Title */}
          <h1
            className={cn(
              "mint-title",
              "text-3xl tracking-[0.18em] uppercase",
              "font-display text-[rgba(0,255,128,0.9)]",
            )}
          >
            Mint TechTonic
          </h1>

          {/* Separator */}
          <div className="mint-separator" />
          {/* Subheader */}
          <p className="mint-subheader text-center text-[10px] text-[rgba(0,255,128,0.4)] font-mono">
            Season One // Limit 3 Per Wallet
          </p>


          {/* Description */}
          <p className="text-center text-sm text-[rgba(0,255,128,0.55)] font-mono max-w-xs leading-relaxed -mt-2">
            Each mint is randomly assigned from the collection.
          </p>
          {/* Separator */}
          <div className="mint-separator" />


          {/* Action area */}
          {!isConnected ? (
            <div className="flex flex-col items-center gap-5">
              <p className="text-[rgba(0,255,128,0.4)] font-mono text-xs uppercase tracking-widest">
                Wallet Required
              </p>
              <WalletButton />
            </div>
          ) : (
            <div className="flex flex-col items-center gap-5">
              {status === "idle" && (
                <>
                  <MenuButton
                    onClick={handleMint}
                    disabled={!CANDY_MACHINE_ADDRESS}
                    className="mint-action-btn text-xl px-10 py-3 tracking-[0.15em] uppercase mt-2"
                  >
                    Mint
                  </MenuButton>
                  {/* Price */}
                  <p className="font-mono text-lg text-[rgba(0,255,128,0.85)] tracking-widest">
                    {MINT_PRICE_SOL} SOL
                  </p>
                </>
              )}

              {status === "minting" && (
                <p className="mint-status-minting text-[rgba(0,255,128,0.7)] font-mono animate-pulse tracking-widest uppercase">
                  Minting...
                </p>
              )}

              {status === "success" && (
                <p className="mint-status-success text-[rgba(0,255,128,0.9)] font-mono tracking-wide">
                  Minted! Redirecting...
                </p>
              )}

              {status === "error" && (
                <div className="flex flex-col items-center gap-4">
                  <p className="mint-status-error text-red-400 font-mono text-sm text-center max-h-50 overflow-auto">
                    {error}
                  </p>
                  <MenuButton onClick={() => setStatus("idle")}>
                    Try Again
                  </MenuButton>
                </div>
              )}
            </div>
          )}

          {/* Bottom separator */}
          <div className="mint-separator" />

          {/* Back button */}
          <MenuButton
            onClick={() => navigate("/")}
            className="text-sm tracking-[0.1em]"
          >
            Back
          </MenuButton>
        </div>
      </div>
    </div>
  );
}
