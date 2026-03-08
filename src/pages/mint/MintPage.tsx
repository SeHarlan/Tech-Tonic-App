import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useConnector, useAccount } from '@solana/connector';
import {
  generateSigner,
  transactionBuilder,
  publicKey,
  some,
  unwrapOption,
} from '@metaplex-foundation/umi';
import { base58 } from '@metaplex-foundation/umi/serializers';
import {
  mintV1,
  fetchCandyMachine,
  fetchCandyGuard,
  fetchMintCounterFromSeeds,
  type DefaultGuardSetMintArgs,
} from '@metaplex-foundation/mpl-core-candy-machine';
import { setComputeUnitLimit, setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox';
import { MenuButton } from '../../components/ui/MenuButton';
import { WalletButton } from '../../components/ui/WalletButton';
import { useUmi } from '../../hooks/useUmi';
import { CANDY_MACHINE_ADDRESS, DEMO_MODE, MINT_PRICE_SOL, MINT_PRICE_SKR, SKR_MINT } from '../../../config/env';
import { cn } from '../../utils/ui-helpers';
import { MintTimeline } from './MintTimeline';
import { useActivePhase } from './useActivePhase';
import { useSetAtom } from 'jotai';
import { useOverlay } from '../../hooks/useOverlay';
import { useNftStore } from '../../hooks/useNftStore';
import { useRefreshOwned } from '../../hooks/useRefreshOwned';
import { activeOwnedNftIdAtom, pendingMintLoadAtom } from '../../store/atoms';
import { fetchPriorityFee } from '../../utils/das-api';
import './mint-page.css';

function SegmentedProgress({ minted, total }: { minted: number; total: number }) {
  const segments = 20;
  const filled = (minted / total) * segments;
  return (
    <div className="w-full flex gap-[3px]">
      {Array.from({ length: segments }, (_, i) => {
        const blockFill = Math.min(1, Math.max(0, filled - i));
        return (
          <div
            key={i}
            className="h-3 flex-1 border border-[rgba(0,255,128,0.2)] overflow-hidden"
          >
            <div
              className="h-full bg-[rgba(0,255,128,0.55)]"
              style={{ width: `${blockFill * 100}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

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
  const [priceSol, setPriceSol] = useState(MINT_PRICE_SOL);
  const [priceSkr, setPriceSkr] = useState(MINT_PRICE_SKR);
  const [mintCount, setMintCount] = useState<{ minted: number; total: number } | null>(null);

  // Capture owned IDs before minting starts
  const prevOwnedIdsRef = useRef<Set<string>>(new Set());

  const group = paymentMethod === 'skr' ? 'skr' : 'public';
  const skrDisabledInDemo = DEMO_MODE && paymentMethod === 'skr';
  const mintEnabled =
    activePhase !== null && !!CANDY_MACHINE_ADDRESS && !skrDisabledInDemo;

  // Fetch live prices from on-chain guard data
  useEffect(() => {
    if (!CANDY_MACHINE_ADDRESS) return;
    let cancelled = false;

    (async () => {
      try {
        const cmPk = publicKey(CANDY_MACHINE_ADDRESS);
        const cm = await fetchCandyMachine(umi, cmPk);
        const guard = await fetchCandyGuard(umi, cm.mintAuthority);

        if (cancelled) return;

        setMintCount({
          minted: Number(cm.itemsRedeemed),
          total: Number(cm.data.itemsAvailable),
        });

        const publicGroup = guard.groups.find((g) => g.label === 'public');
        if (publicGroup) {
          const solPayment = unwrapOption(publicGroup.guards.solPayment);
          if (solPayment) {
            setPriceSol(Number(solPayment.lamports.basisPoints) / 1e9);
          }
        }

        const skrGroup = guard.groups.find((g) => g.label === 'skr');
        if (skrGroup) {
          const tokenPayment = unwrapOption(skrGroup.guards.tokenPayment);
          if (tokenPayment) {
            const decimals = 6; // SKR decimals
            setPriceSkr(Number(tokenPayment.amount.basisPoints) / 10 ** decimals);
          }
        }
      } catch (err) {
        console.warn('[Mint] Failed to fetch live prices:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [umi]);

  const handleMint = async () => {
    if (!address || !mintEnabled) return;

    prevOwnedIdsRef.current = new Set(ownedNfts.map((n) => n.id));
    setStatus('minting');
    setError('');

    try {
      const cmPublicKey = publicKey(CANDY_MACHINE_ADDRESS);

      const candyMachine = await fetchCandyMachine(umi, cmPublicKey);
      const candyGuard = await fetchCandyGuard(umi, candyMachine.mintAuthority);

      // --- Pre-validation: check capacity ---
      if (candyMachine.itemsRedeemed >= candyMachine.data.itemsAvailable) {
        throw new Error('Collection is fully minted — no items remaining.');
      }

      // Build mintArgs from on-chain guard data per Metaplex docs
      const guardGroup = candyGuard.groups.find((g) => g.label === group);
      if (!guardGroup) {
        throw new Error(`Guard group "${group}" not found on candy machine`);
      }
      const guards = guardGroup.guards;
      const mintArgs: Partial<DefaultGuardSetMintArgs> = {};

      if (group === 'skr') {
        const tokenPayment = unwrapOption(guards.tokenPayment);
        if (tokenPayment) {
          mintArgs.tokenPayment = some({
            mint: publicKey(SKR_MINT),
            destinationAta: tokenPayment.destinationAta,
          });
        }
        const mintLimit = unwrapOption(guards.mintLimit);
        if (mintLimit) mintArgs.mintLimit = some({ id: mintLimit.id });
      } else {
        const solPayment = unwrapOption(guards.solPayment);
        if (solPayment) {
          mintArgs.solPayment = some({ destination: solPayment.destination });
        }
        const mintLimit = unwrapOption(guards.mintLimit);
        if (mintLimit) mintArgs.mintLimit = some({ id: mintLimit.id });
      }

      // --- Pre-validation: check per-wallet mint limit ---
      const mintLimitGuard = unwrapOption(guards.mintLimit);
      if (mintLimitGuard) {
        try {
          const counter = await fetchMintCounterFromSeeds(umi, {
            id: mintLimitGuard.id,
            user: umi.identity.publicKey,
            candyMachine: cmPublicKey,
            candyGuard: candyGuard.publicKey,
          });
          if (counter.count >= mintLimitGuard.limit) {
            throw new Error(
              `Wallet mint limit reached (${counter.count}/${mintLimitGuard.limit}). Each wallet can only mint ${mintLimitGuard.limit} from this collection.`,
            );
          }
        } catch (e) {
          // If the counter PDA doesn't exist, the wallet hasn't minted yet — that's fine.
          // Re-throw only if it's our own limit-reached error.
          if (e instanceof Error && e.message.includes('mint limit reached')) throw e;
        }
      }

      const asset = generateSigner(umi);
      const priorityFee = await fetchPriorityFee([CANDY_MACHINE_ADDRESS]);

      const tx = transactionBuilder()
        .add(setComputeUnitLimit(umi, { units: 800_000 }))
        .add(setComputeUnitPrice(umi, { microLamports: priorityFee }))
        .add(
          mintV1(umi, {
            candyMachine: cmPublicKey,
            candyGuard: candyGuard.publicKey,
            asset,
            collection: candyMachine.collectionMint,
            group: some(group),
            mintArgs,
          }),
        );

      // Sign first, then send + confirm separately.
      // Keeps the wallet interaction short so Phantom's MV3 service worker
      // doesn't time out during the slower confirmation phase.
      const signedTx = await tx.buildAndSign(umi);

      // Capture the blockhash used by the transaction for confirmation.
      // Using a different blockhash can cause confirmation to falsely report
      // expiry while the original transaction is still valid.
      const txBlockhash = umi.transactions.deserialize(
        umi.transactions.serialize(signedTx),
      ).message.blockhash;
      const blockhashWithExpiry = await umi.rpc.getLatestBlockhash();
      // Override with the actual blockhash baked into the transaction
      blockhashWithExpiry.blockhash = txBlockhash;

      const signature = await umi.rpc.sendTransaction(signedTx);
      const [sigStr] = base58.deserialize(signature);
      console.log('[Mint] Sent:', sigStr);

      const result = await umi.rpc.confirmTransaction(signature, {
        strategy: { type: 'blockhash', ...blockhashWithExpiry },
        commitment: 'confirmed',
      });

      if (result.value.err) {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(result.value.err)}`);
      }

      setStatus('success');
      setRetrieving(true);

      // Wait for DAS indexing before polling — avoids wasted 400s on the first request
      await new Promise((r) => setTimeout(r, 2000));

      // Poll DAS until the new asset appears
      const prevIds = prevOwnedIdsRef.current;
      let finalList = await refreshOwned();

      //poll for up to 60 seconds or until a new nft is found (the new list is longer than the previous list) 
      for (let i = 0; i < 30 && finalList.length <= prevIds.size; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        finalList = await refreshOwned();
      }

      const newNft = finalList.find((n) => !prevIds.has(n.id));

      if (newNft) {
        setActiveOwnedNftId(newNft.id);
        setPendingMintLoad(true);
        openOverlay('owned');

        // Let the user enjoy the success state, then navigate.
        // Also ensures jotai atom writes (overlay tab, pending mint)
        // fully propagate before CanvasPage mounts and reads them.
        await new Promise((r) => setTimeout(r, 500));
      }

      navigate('/');
    } catch (err: unknown) {
      console.error('[Mint] Error:', err);
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrieving(false);
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

            <p className="mint-subheader text-center text-[rgba(0,255,128,0.5)] font-mono -mt-4">
              Season One
            </p>
            {/* Separator */}
            <div className="mint-separator" />
            {/* Subheader */}
            <p className="mint-subheader text-[10px] text-[rgba(0,255,128,0.54)]">
              {mintCount ? (
                <span>
                  {mintCount.minted} out of {mintCount.total} minted
                </span>
              ) : (
                <span>Loading...</span>
              )}
            </p>

            {/* Progress bar — segmented blocks */}
            {mintCount && (
              <div className="-mt-4 w-full">
                <SegmentedProgress minted={mintCount.minted} total={mintCount.total} />
              </div>
            )}

            <p className="mint-subheader text-[10px] text-[rgba(0,255,128,0.54)] -mt-4">
              <span>Limit 3 Per Wallet</span>
            </p>

            {/* Separator */}
            <div className="mint-separator" />

            {/* Action area */}

            <div className="flex flex-col items-center gap-5">
              {status === "idle" && (
                <>
                  {/* Payment toggle */}
                  <div className="flex items-center justify-center gap-4 font-mono text-xs tracking-[0.15em] uppercase">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("sol")}
                      className={cn(
                        "overlay-tab-btn bg-transparent border-none cursor-pointer whitespace-nowrap px-0.5 py-0",
                        paymentMethod === "sol"
                          ? "text-[rgb(0,255,128)]"
                          : "text-[rgba(0,255,128,0.35)] hover:text-[rgba(0,255,128,0.55)]",
                      )}
                    >
                      {paymentMethod === "sol" ? "[ SOL ]" : "SOL"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentMethod("skr")}
                      className={cn(
                        "overlay-tab-btn bg-transparent border-none cursor-pointer whitespace-nowrap px-0.5 py-0",
                        paymentMethod === "skr"
                          ? "text-[rgb(0,255,128)]"
                          : "text-[rgba(0,255,128,0.35)] hover:text-[rgba(0,255,128,0.55)]",
                      )}
                    >
                      {paymentMethod === "skr" ? "[ SKR ]" : "SKR"}
                    </button>
                  </div>

                  {!isConnected ? (
                    <MenuButton
                      onClick={handleMint}
                      disabled
                      className={cn(
                        "text-xl px-10 py-3 tracking-[0.15em] uppercase mt-2",
                      )}
                    >
                      Wallet Required
                    </MenuButton>
                  ) : (
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
                  )}
                  {/* Price */}
                  <p className="font-mono text-lg text-[rgba(0,255,128,0.85)] tracking-widest">
                    {paymentMethod === "skr"
                      ? `${priceSkr.toLocaleString()} SKR`
                      : `${priceSol} SOL`}
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

            {/* Bottom separator */}
            <div className="mint-separator" />

            <div className="flex flex-row items-center justify-center gap-4">
              <MenuButton
                onClick={() => navigate("/")}
                className="text-sm tracking-widest"
              >
                Home
              </MenuButton>
              <WalletButton
                className={cn(
                  "text-sm tracking-widest mint-action-btn",
                  !isConnected && "mint-action-btn",
                )}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
