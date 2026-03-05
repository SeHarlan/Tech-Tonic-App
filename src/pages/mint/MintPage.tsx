import { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useConnector, useAccount } from '@solana/connector';
import {
  generateSigner,
  transactionBuilder,
  publicKey,
  some,
  type OptionOrNullable,
} from '@metaplex-foundation/umi';
import {
  mintV1,
  fetchCandyMachine,
  fetchCandyGuard,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { setComputeUnitLimit } from '@metaplex-foundation/mpl-toolbox';
import { MenuButton } from '../../components/ui/MenuButton';
import { WalletButton } from '../../components/ui/WalletButton';
import { useUmi } from '../../hooks/useUmi';
import { CANDY_MACHINE_ADDRESS, DEMO_MODE, MINT_PRICE_SOL, MINT_PRICE_SKR, SKR_MINT } from '../../config/env';
import { cn } from '../../utils/ui-helpers';
import { MintTimeline } from './MintTimeline';
import { useActivePhase } from './useActivePhase';
import { useSetAtom } from 'jotai';
import { useOverlay } from '../../hooks/useOverlay';
import { useNftStore } from '../../hooks/useNftStore';
import { useRefreshOwned } from '../../hooks/useRefreshOwned';
import { activeOwnedNftIdAtom, pendingMintLoadAtom } from '../../store/atoms';
import './mint-page.css';

type MintStatus = 'idle' | 'minting' | 'success' | 'error';
type PaymentMethod = 'sol' | 'skr';

export function MintPage() {
  const navigate = useNavigate();
  const { isConnected } = useConnector();
  const { address } = useAccount();
  const umi = useUmi();
  const activePhase = useActivePhase();
  const { openOverlay } = useOverlay();
  const { ownedNfts } = useNftStore();
  const refreshOwned = useRefreshOwned();
  const setActiveOwnedNftId = useSetAtom(activeOwnedNftIdAtom);
  const setPendingMintLoad = useSetAtom(pendingMintLoadAtom);

  const [status, setStatus] = useState<MintStatus>('idle');
  const [retrieving, setRetrieving] = useState(false);
  const [error, setError] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('sol');

  // Capture owned IDs before minting starts
  const prevOwnedIdsRef = useRef<Set<string>>(new Set());

  const group = paymentMethod === 'skr' ? 'skr' : 'public';
  const skrDisabledInDemo = DEMO_MODE && paymentMethod === 'skr';
  const mintEnabled =
    activePhase !== null && !!CANDY_MACHINE_ADDRESS && !skrDisabledInDemo;

  const handleMint = async () => {
    if (!address || !mintEnabled) return;

    prevOwnedIdsRef.current = new Set(ownedNfts.map((n) => n.id));
    setStatus('minting');
    setError('');

    try {
      const cmPublicKey = publicKey(CANDY_MACHINE_ADDRESS);

      const candyMachine = await fetchCandyMachine(umi, cmPublicKey);
      const candyGuard = await fetchCandyGuard(umi, candyMachine.mintAuthority);

      const asset = generateSigner(umi);

      let mintArgs: OptionOrNullable<object> | undefined;

      if (group === 'skr') {
        const skrGroup = candyGuard.groups.find((g) => g.label === 'skr');
        const tokenPayment = skrGroup?.guards.tokenPayment;
        const destAta = tokenPayment?.__option === 'Some'
          ? tokenPayment.value.destinationAta
          : publicKey(SKR_MINT);

        mintArgs = {
          tokenPayment: some({
            mint: publicKey(SKR_MINT),
            destinationAta: destAta,
          }),
          mintLimit: some({ id: 3 }),
        };
      } else {
        const publicGroup = candyGuard.groups.find((g) => g.label === 'public');
        const solPaymentGuard = publicGroup?.guards.solPayment;
        const solPaymentDest = solPaymentGuard?.__option === 'Some'
          ? solPaymentGuard.value.destination
          : undefined;

        mintArgs = {
          solPayment: solPaymentDest
            ? some({ destination: solPaymentDest })
            : undefined,
          mintLimit: some({ id: 1 }),
        };
      }

      await transactionBuilder()
        .add(setComputeUnitLimit(umi, { units: 800_000 }))
        .add(
          mintV1(umi, {
            candyMachine: cmPublicKey,
            asset,
            collection: candyMachine.collectionMint,
            group: some(group),
            mintArgs,
          }),
        )
        .sendAndConfirm(umi);

      setStatus('success');
      setRetrieving(false);

      // Brief "Minted!" celebration before starting retrieval
      await new Promise((r) => setTimeout(r, 1200));
      setRetrieving(true);

      const prevIds = prevOwnedIdsRef.current;
      let finalList = await refreshOwned();
      for (let i = 0; i < 30 && finalList.length <= prevIds.size; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        finalList = await refreshOwned();
      }

      // Point the owned carousel to the newly minted NFT
      const newNft = finalList.find((n) => !prevIds.has(n.id));
      if (newNft) setActiveOwnedNftId(newNft.id);

      setPendingMintLoad(true);
      openOverlay('owned');
      navigate('/');
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

      {/* Stacked layout: timeline box + main frame */}
      <div className="relative z-10 flex flex-col items-center gap-4 w-full max-w-sm">
        {/* Timeline — separate box above */}
        <MintTimeline />

        {/* Terminal frame */}
        <div className="mint-frame w-full px-8 py-10 flex flex-col items-center gap-6">
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
              TechTonic
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
                    {/* Payment toggle */}
                    <div className="flex items-center justify-center gap-4 font-mono text-xs tracking-[0.15em] uppercase">
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('sol')}
                        className={cn(
                          "overlay-tab-btn bg-transparent border-none cursor-pointer whitespace-nowrap px-0.5 py-0",
                          paymentMethod === 'sol'
                            ? "text-[rgb(0,255,128)]"
                            : "text-[rgba(0,255,128,0.35)] hover:text-[rgba(0,255,128,0.55)]",
                        )}
                      >
                        {paymentMethod === 'sol' ? '[ SOL ]' : 'SOL'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaymentMethod('skr')}
                        className={cn(
                          "overlay-tab-btn bg-transparent border-none cursor-pointer whitespace-nowrap px-0.5 py-0",
                          paymentMethod === 'skr'
                            ? "text-[rgb(0,255,128)]"
                            : "text-[rgba(0,255,128,0.35)] hover:text-[rgba(0,255,128,0.55)]",
                        )}
                      >
                        {paymentMethod === 'skr' ? '[ SKR ]' : 'SKR'}
                      </button>
                    </div>

                    <MenuButton
                      onClick={handleMint}
                      disabled={!mintEnabled}
                      className={cn(
                        "text-xl px-10 py-3 tracking-[0.15em] uppercase mt-2",
                        mintEnabled && "mint-action-btn",
                      )}
                    >
                      Mint
                    </MenuButton>
                    {/* Price */}
                    <p className="font-mono text-lg text-[rgba(0,255,128,0.85)] tracking-widest">
                      {paymentMethod === 'skr'
                        ? `${MINT_PRICE_SKR.toLocaleString()} SKR`
                        : `${MINT_PRICE_SOL} SOL`}
                    </p>
                  </>
                )}

                {status === "minting" && (
                  <p className="mint-status-minting text-[rgba(0,255,128,0.7)] font-mono animate-pulse tracking-widest uppercase">
                    Minting...
                  </p>
                )}

                {status === "success" && (
                  <div className="flex flex-col items-center gap-2">
                    <p className="mint-status-success text-[rgba(0,255,128,0.9)] font-mono tracking-wide">
                      Minted!
                    </p>
                    {retrieving && (
                      <p className="text-[rgba(0,255,128,0.4)] font-mono text-xs animate-pulse tracking-widest uppercase">
                        Retrieving from chain...
                      </p>
                    )}
                  </div>
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
              className="text-sm tracking-widest"
            >
              Back
            </MenuButton>
          </div>
        </div>
      </div>
    </div>
  );
}
