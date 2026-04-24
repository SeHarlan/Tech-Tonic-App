import { useMemo, useCallback, useEffect, useState, useRef, type PointerEvent as RPointerEvent } from 'react';
import { useAtom } from 'jotai';
import { useAccount } from '@solana/connector';
import { MenuButton } from '../../components/ui/MenuButton';
import { WalletButton } from '../../components/ui/WalletButton';
import { useNavigate } from 'react-router';
import { cn } from '../../utils/ui-helpers';
import { OverlayTabs, type OverlayTab } from './OverlayTabs';
import { NftBrowser, loadNftIntoEngine, loadNftIntoEngineAsync, loadSketchSeed } from './NftBrowser';
import { XIcon, CaretLineLeft, CaretLineRight, ShuffleIcon, FloppyDiskIcon, CircleNotchIcon } from '@phosphor-icons/react';
import { SaveDialog } from './SaveDialog';
import { useNftStore } from '../../hooks/useNftStore';
import { useOverlay } from '../../hooks/useOverlay';
import { useUmi } from '../../hooks/useUmi';
import { useRefreshOwned } from '../../hooks/useRefreshOwned';
import {
  activeOwnedNftIdAtom,
  activeDiscoverNftIdAtom,
  sketchSeedAtom,
  pendingMintLoadAtom,
} from '../../store/atoms';
import type { Engine } from '../../engine/renderer';
import type { NftItem } from '../../utils/das-api';
import { saveDraft } from '../../services/draft-storage';
import { assertSaveableCanvasAspect } from '../../utils/canvas-aspect';
import { UPDATE_API_URL } from '../../../config/env';
import { base58 } from '@metaplex-foundation/umi/serializers';
import './canvas-overlay.css';

/** Resolve a persisted NFT ID to an index in a list, falling back to 0. */
function indexFromId(list: NftItem[], id: string | null): number {
  if (!id) return 0;
  const i = list.findIndex((n) => n.id === id);
  return i >= 0 ? i : 0;
}

export type SlidePhase = 'loading' | 'sliding' | null;

/** First-load glitch should only fire once per page session. */
let hasPlayedInitialGlitch = false;

/** Cache of already-prefetched image URLs — survives re-renders, cleared on page reload. */
const prefetchedUrls = new Set<string>();

function prefetchImage(url: string) {
  if (!url || prefetchedUrls.has(url)) return;
  prefetchedUrls.add(url);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
}

interface CanvasOverlayProps {
  canvasBottom: number;
  engine: Engine | null;
  onClose: () => void;
  showTouchPrompt?: boolean;
  onTransitionChange?: (state: { src: string | null; phase: SlidePhase; dir: 1 | -1 }) => void;
  needsInitialLoad?: React.RefObject<boolean>;
  isFullscreen?: boolean;
  rotated?: boolean;
}

export function CanvasOverlay({ canvasBottom: _canvasBottom, engine, onClose, showTouchPrompt, onTransitionChange, needsInitialLoad, isFullscreen = false, rotated = false }: CanvasOverlayProps) {
  const navigate = useNavigate();
  const { overlayTab, setOverlayTab, hasOwned, hasDiscover } = useOverlayWithNfts();
  const { ownedNfts, discoverNfts } = useNftStore();
  const { address } = useAccount();
  const umi = useUmi();
  const refreshOwned = useRefreshOwned();
  const [activeOwnedId, setActiveOwnedId] = useAtom(activeOwnedNftIdAtom);
  const [activeDiscoverId, setActiveDiscoverId] = useAtom(activeDiscoverNftIdAtom);
  const [sketchSeed, setSketchSeed] = useAtom(sketchSeedAtom);
  const [pendingMintLoad, setPendingMintLoad] = useAtom(pendingMintLoadAtom);

  const activeTab = overlayTab;

  // Filter out NFTs without thumbnails — they can't be loaded into the engine
  const browserItems = useMemo(() => {
    const items = activeTab === 'owned' ? ownedNfts : activeTab === 'discover' ? discoverNfts : [];
    return items.filter((n) => n.thumbnailUrl);
  }, [activeTab, ownedNfts, discoverNfts]);
  const browseIndex = activeTab === 'owned'
    ? indexFromId(ownedNfts, activeOwnedId)
    : activeTab === 'discover'
      ? indexFromId(discoverNfts, activeDiscoverId)
      : 0;

  const currentNft = browserItems.length > 0 ? browserItems[browseIndex] : null;
  const isBrowsing = activeTab !== 'sketch' && browserItems.length > 0;

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  // --- On-chain update ---
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateResult, setUpdateResult] = useState<'success' | 'error' | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const canUpdate = !!(
    address &&
    currentNft &&
    currentNft.owner === address &&
    UPDATE_API_URL
  );

  const handleUpdate = useCallback(async () => {
    if (!engine || !currentNft || !address || !UPDATE_API_URL) return;
    setUpdateBusy(true);
    setUpdateResult(null);
    setUpdateError(null);

    try {
      assertSaveableCanvasAspect(engine.getCanvas(), rotated);

      // 1. Save draft as safety net
      const state = await engine.serializeState();
      await saveDraft(currentNft.id, state, currentNft.defaultWaterfallMode, engine.isManualMode());

      // 2. Sign confirmation message
      const message = `Confirm permanent update of ${currentNft.name} (asset: ${currentNft.id})`;
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await umi.identity.signMessage(messageBytes);
      const signature = base58.deserialize(signatureBytes)[0];

      // 3. POST to backend
      const formData = new FormData();
      formData.append('image', state.imageBuffer, 'image.png');
      formData.append('movement', state.movementBuffer, 'movement.png');
      formData.append('paint', state.paintBuffer, 'paint.png');
      formData.append('assetId', currentNft.id);
      formData.append('walletAddress', address);
      formData.append('signature', signature);
      formData.append('message', message);

      const res = await fetch(`${UPDATE_API_URL}/api/update-nft`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(body.error || `Update failed (${res.status})`);
      }

      // 4. Refresh owned NFTs to pick up new metadata
      await refreshOwned();

      // 5. Show success
      setUpdateResult('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed';
      setUpdateResult('error');
      setUpdateError(msg);
    } finally {
      setUpdateBusy(false);
    }
  }, [engine, currentNft, address, umi, refreshOwned]);

  const handleReset = useCallback(() => {
    if (!engine || !currentNft) return;
    loadNftIntoEngine(engine, currentNft, null);
  }, [engine, currentNft]);

  // After a successful mint, load the newly minted NFT into the engine
  useEffect(() => {
    if (!pendingMintLoad || !engine || !currentNft) return;
    setPendingMintLoad(false);
    loadNftIntoEngine(engine, currentNft, null);
  }, [pendingMintLoad, engine, currentNft, setPendingMintLoad]);

  // On first overlay open after engine creation: load the correct content for
  // the persisted tab (owned/discover). Sketch is skipped — engine already has
  // the seed from createEngine, and calling setSeed would clear the framebuffers.
  // Uses a ref from CanvasPage so it only fires once per engine lifecycle,
  // not every time the overlay re-opens.
  useEffect(() => {
    if (!needsInitialLoad?.current || pendingMintLoad || !engine) return;
    needsInitialLoad.current = false;
    if (activeTab === 'sketch') return;
    const tabItems = (activeTab === 'owned' ? ownedNfts : discoverNfts).filter((n) => n.thumbnailUrl);
    const tabId = activeTab === 'owned' ? activeOwnedId : activeDiscoverId;
    const idx = indexFromId(tabItems, tabId);
    const nft = tabItems[idx];
    if (nft) loadNftIntoEngine(engine, nft, activeTab === 'discover' ? null : undefined);
  }, [activeTab, engine, pendingMintLoad, needsInitialLoad, ownedNfts, discoverNfts, activeOwnedId, activeDiscoverId]);

  const controlBottom = useMemo(() => {
    const midpoint = _canvasBottom + (window.innerHeight - _canvasBottom) / 2;
    const accountForTranslation = 65;
    const maxTop = window.innerHeight - accountForTranslation - 40;
    return Math.min(midpoint, maxTop);
  }, [_canvasBottom]);

  const titleTop = useMemo(() => {
    const canvasTop = window.innerHeight - _canvasBottom;
    const midpoint = canvasTop / 2;
    const accountForTranslation = 30;
    const minTop = accountForTranslation + 30;
    return Math.max(midpoint, minTop);
  }, [_canvasBottom]);

  // --- Glitch burst effect (tab switch + initial load) ---
  const [tabGlitch, setTabGlitch] = useState(() => {
    if (hasPlayedInitialGlitch) return false;
    hasPlayedInitialGlitch = true;
    return true;
  });
  const glitchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-clear the initial load glitch
  useEffect(() => {
    if (!tabGlitch) return;
    glitchTimer.current = setTimeout(() => setTabGlitch(false), 450);
    return () => clearTimeout(glitchTimer.current);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerGlitch = useCallback(() => {
    setTabGlitch(false);
    requestAnimationFrame(() => {
      setTabGlitch(true);
      clearTimeout(glitchTimer.current);
      glitchTimer.current = setTimeout(() => setTabGlitch(false), 450);
    });
  }, []);

  const handleTabChange = useCallback((tab: OverlayTab) => {
    if (tab === activeTab) return;
    if (tab === 'owned' && !hasOwned) return;
    if (tab === 'discover' && !hasDiscover) return;
    setOverlayTab(tab);
    triggerGlitch();
    if (!engine) return;
    if (tab === 'sketch') {
      loadSketchSeed(engine, sketchSeed);
      return;
    }
    const tabItems = (tab === 'owned' ? ownedNfts : discoverNfts).filter((n) => n.thumbnailUrl);
    const tabId = tab === 'owned' ? activeOwnedId : activeDiscoverId;
    const idx = indexFromId(tabItems, tabId);
    const nft = tabItems[idx];
    if (nft) loadNftIntoEngine(engine, nft, tab === 'discover' ? null : undefined);
  }, [activeTab, hasOwned, hasDiscover, setOverlayTab, triggerGlitch, engine, sketchSeed, ownedNfts, discoverNfts, activeOwnedId, activeDiscoverId]);

  // If the persisted tab becomes disabled (e.g., collection empty or wallet
  // disconnected), fall back to sketch so the overlay doesn't render a blank
  // carousel.
  useEffect(() => {
    if (activeTab === 'owned' && !hasOwned) {
      setOverlayTab('sketch');
      if (engine) loadSketchSeed(engine, sketchSeed);
    } else if (activeTab === 'discover' && !hasDiscover) {
      setOverlayTab('sketch');
      if (engine) loadSketchSeed(engine, sketchSeed);
    }
  }, [activeTab, hasOwned, hasDiscover, setOverlayTab, engine, sketchSeed]);

  // --- Sketch tab swipe handling ---
  const sketchSwipeStart = useRef<{ x: number } | null>(null);
  const sketchDidSwipe = useRef(false);
  const SWIPE_THRESHOLD = 50;

  const onSketchSwipeDown = useCallback((e: RPointerEvent) => {
    sketchSwipeStart.current = { x: e.clientX };
    sketchDidSwipe.current = false;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onSketchSwipeUp = useCallback((e: RPointerEvent) => {
    if (!sketchSwipeStart.current) return;
    const dx = e.clientX - sketchSwipeStart.current.x;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      sketchDidSwipe.current = true;
      if (dx < 0 && hasDiscover) {
        // Swipe left → discover (only if available)
        handleTabChange('discover');
      } else if (dx > 0 && hasOwned) {
        // Swipe right → owned (only if available)
        handleTabChange('owned');
      }
    }
    sketchSwipeStart.current = null;
  }, [handleTabChange, hasOwned, hasDiscover]);

  // --- Carousel transition state ---
  const [transitionSrc, setTransitionSrc] = useState<string | null>(null);
  const [slidePhase, setSlidePhase] = useState<'loading' | 'sliding' | null>(null);
  const [slideDir, setSlideDir] = useState<1 | -1>(1);
  const transitionLock = useRef(false);

  // --- Image prefetching for adjacent carousel items ---
  useEffect(() => {
    if (browserItems.length <= 1) return;
    const len = browserItems.length;
    const prev = browserItems[(browseIndex - 1 + len) % len];
    const next = browserItems[(browseIndex + 1) % len];
    if (prev) prefetchImage(prev.thumbnailUrl);
    if (next) prefetchImage(next.thumbnailUrl);
  }, [browseIndex, browserItems]);

  // --- Spinner for slow engine loads (>1s) ---
  const [showSpinner, setShowSpinner] = useState(false);
  const spinnerTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Clear spinner when loading phase ends or component unmounts
  useEffect(() => {
    if (slidePhase !== 'loading') {
      clearTimeout(spinnerTimer.current);
      setShowSpinner(false);
    }
    return () => clearTimeout(spinnerTimer.current);
  }, [slidePhase]);

  // Notify parent of transition state changes for canvas transforms
  useEffect(() => {
    onTransitionChange?.({ src: transitionSrc, phase: slidePhase, dir: slideDir });
  }, [transitionSrc, slidePhase, slideDir, onTransitionChange]);

  const handleNavigate = useCallback(async (dir: 1 | -1) => {
    const len = browserItems.length;
    if (len === 0 || !engine || transitionLock.current) return;
    transitionLock.current = true;

    const next = (browseIndex + dir + len) % len;
    const nft = browserItems[next];
    if (activeTab === 'owned') setActiveOwnedId(nft.id);
    else if (activeTab === 'discover') setActiveDiscoverId(nft.id);

    // 1. Capture screenshot of current frame
    const src = await engine.captureScreenshotBase64();
    setTransitionSrc(src);
    setSlideDir(dir);
    setSlidePhase('loading');

    // Show spinner if load takes >1s
    clearTimeout(spinnerTimer.current);
    spinnerTimer.current = setTimeout(() => setShowSpinner(true), 1000);

    try {
      // 2-3. Load next NFT into engine (canvas hidden behind screenshot)
      await loadNftIntoEngineAsync(engine, nft, activeTab === 'discover' ? null : undefined);
    } catch (err) {
      console.warn('[Carousel] Failed to load NFT, skipping transition:', err);
    }

    // 4-5. Trigger slide animation
    setSlidePhase('sliding');

    // 6. Cleanup after CSS transition ends
    setTimeout(() => {
      setTransitionSrc(null);
      setSlidePhase(null);
      transitionLock.current = false;
    }, 400);
  }, [browserItems, browseIndex, activeTab, setActiveOwnedId, setActiveDiscoverId, engine]);

  return (
    <div
      className={cn(
        "canvas-overlay",
        "fixed inset-0 z-50 flex items-end justify-center overflow-hidden",
      )}
      onClick={onClose}
    >
      {/* Full-screen NFT browser (image + arrows + swipe) — behind overlay effects */}
      {isBrowsing && (
        <NftBrowser count={browserItems.length} onNavigate={handleNavigate} />
      )}

      {/* Sketch tab — swipe zone + caret-line arrows to switch tabs */}
      {activeTab === 'sketch' && (
        <>
          <div
            className="absolute inset-0 z-3 touch-none"
            onClick={(e) => { if (sketchDidSwipe.current) e.stopPropagation(); }}
            onPointerDown={onSketchSwipeDown}
            onPointerUp={onSketchSwipeUp}
            onPointerCancel={() => { sketchSwipeStart.current = null; }}
          />

          <button
            type="button"
            disabled={!hasOwned}
            onClick={(e) => { e.stopPropagation(); handleTabChange('owned'); }}
            className={cn(
              "overlay-tab-btn absolute left-3 top-1/2 -translate-y-1/2 z-4 bg-transparent border-none p-2",
              hasOwned
                ? "cursor-pointer text-[rgba(0,255,128,0.5)] hover:text-[rgb(0,255,128)]"
                : "cursor-not-allowed text-[rgba(0,255,128,0.15)]",
            )}
          >
            <CaretLineLeft size={28} weight="bold" />
          </button>

          <button
            type="button"
            disabled={!hasDiscover}
            onClick={(e) => { e.stopPropagation(); handleTabChange('discover'); }}
            className={cn(
              "overlay-tab-btn absolute right-3 top-1/2 -translate-y-1/2 z-4 bg-transparent border-none p-2",
              hasDiscover
                ? "cursor-pointer text-[rgba(0,255,128,0.5)] hover:text-[rgb(0,255,128)]"
                : "cursor-not-allowed text-[rgba(0,255,128,0.15)]",
            )}
          >
            <CaretLineRight size={28} weight="bold" />
          </button>
        </>
      )}

      {/* Loading spinner — shown when engine load exceeds 1s */}
      {showSpinner && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <CircleNotchIcon
            size={32}
            weight="bold"
            className="text-[rgba(0,255,128,0.5)] animate-spin"
          />
        </div>
      )}

      {/* Touch prompt — centered, doesn't intercept clicks */}
      {showTouchPrompt && (
        <p className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 font-mono text-sm tracking-[0.2em] uppercase text-[rgba(0,255,128,0.5)] animate-pulse">
          touch to start program
        </p>
      )}

      {/* Static scanlines over entire overlay */}
      <span className="canvas-overlay-scanlines" />

      {/* CRT vignette */}
      <div className="canvas-overlay-vignette" />

      {/* Tab switch glitch burst */}
      {tabGlitch && <div className="tab-glitch-burst" />}

      {/* Glitch bars */}
      <span className="canvas-overlay-glitch canvas-overlay-glitch-a" />
      <span className="canvas-overlay-glitch canvas-overlay-glitch-b" />
      <span className="canvas-overlay-glitch canvas-overlay-glitch-c" />

      {/* NFT title panel — top center, mirrored placement from control panel */}
      {isBrowsing && currentNft && (
        <div
          className={cn("canvas-overlay-panel", "z-10 px-6 py-3 absolute left-1/2 -translate-x-1/2 -translate-y-1/2")}
          onClick={(e) => e.stopPropagation()}
          style={{ top: titleTop }}
        >
          <span className="canvas-overlay-panel-corner-bl" />
          <span className="canvas-overlay-panel-corner-br" />
          <span className="canvas-overlay-panel-corner-tl" />
          <span className="canvas-overlay-panel-corner-tr" />
          <div className="relative z-1 flex flex-col items-center gap-0.5">
            <p className="font-mono text-sm tracking-[0.15em] uppercase text-[rgba(0,255,128,0.7)] m-0 whitespace-nowrap">
              {currentNft.name}
            </p>
            <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-[rgba(0,255,128,0.35)] m-0">
              {browseIndex + 1}/{browserItems.length}
            </p>
          </div>
        </div>
      )}

      {/* Close button — top right */}
      <MenuButton
        onClick={onClose}
        className="size-9.25 absolute top-4 right-4 z-20"
      >
        <XIcon weight="bold" className="shrink-0" />
      </MenuButton>

      {/* Bottom control bar */}
      <div
        className={cn("canvas-overlay-panel", "z-10 px-8 py-4 absolute -translate-y-1/2")}
        onClick={(e) => e.stopPropagation()}
        style={{ top: controlBottom }}
      >
        {/* Corner brackets */}
        <span className="canvas-overlay-panel-corner-bl" />
        <span className="canvas-overlay-panel-corner-br" />
        <span className="canvas-overlay-panel-corner-tl" />
        <span className="canvas-overlay-panel-corner-tr" />

        {/* Bar content */}
        <div className="relative z-1 flex flex-col items-center gap-2">
          {/* Terminal label */}
          <p className="-mt-1 canvas-overlay-label text-xs text-[rgba(0,255,128,0.35)] font-mono">
            - System -
          </p>

          {/* Tab switcher */}
          <OverlayTabs
            activeTab={activeTab}
            onTabChange={handleTabChange}
            ownedDisabled={!hasOwned}
            discoverDisabled={!hasDiscover}
          />

          {/* Separator */}
          <div className="canvas-overlay-separator" />

          {/* Buttons row */}
          <div className="flex flex-row items-center justify-center gap-4 mt-1">
            {activeTab === 'sketch' && (
              <MenuButton
                onClick={(e) => {
                  e.stopPropagation();
                  const newSeed = Math.floor(Math.random() * 1000);
                  setSketchSeed(newSeed);
                  if (engine) loadSketchSeed(engine, newSeed);
                }}
                className="size-9.25"
              >
                <ShuffleIcon size={18} weight="bold" className="shrink-0" />
              </MenuButton>
            )}
            {activeTab === 'owned' && currentNft && (
              <MenuButton
                onClick={(e) => { e.stopPropagation(); setSaveDialogOpen(true); }}
                className="size-9.25"
              >
                <FloppyDiskIcon size={18} weight="bold" className="shrink-0" />
              </MenuButton>
            )}
            <WalletButton />
            <MenuButton
              onClick={() => navigate("/mint")}
              className="canvas-overlay-mint-btn tracking-[0.12em] uppercase"
            >
              Mint
            </MenuButton>
          </div>
        </div>
      </div>

      {/* Save/Load dialog */}
      <SaveDialog
        open={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onUpdate={handleUpdate}
        onReset={handleReset}
        engineReady={!!engine}
        canUpdate={canUpdate}
        updateBusy={updateBusy}
        updateResult={updateResult}
        updateError={updateError}
        disabled={isFullscreen}
      />
    </div>
  );
}

function useOverlayWithNfts() {
  const { overlayTab, setOverlayTab } = useOverlay();
  const { hasOwned, hasDiscover } = useNftStore();
  return { overlayTab, setOverlayTab, hasOwned, hasDiscover };
}
