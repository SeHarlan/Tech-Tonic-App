import { useMemo, useCallback, useEffect, useState, useRef, type PointerEvent as RPointerEvent, type MouseEvent } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { MenuButton } from '../../components/ui/MenuButton';
import { WalletButton } from '../../components/ui/WalletButton';
import { useNavigate } from 'react-router';
import { cn } from '../../utils/ui-helpers';
import { OverlayTabs, type OverlayTab } from './OverlayTabs';
import { NftBrowser, loadNftIntoEngine, loadNftIntoEngineAsync, loadSketchSeed } from './NftBrowser';
import { XIcon, CaretLineLeft, CaretLineRight, FloppyDisk, ClockCounterClockwise } from '@phosphor-icons/react';
import { useNftStore } from '../../hooks/useNftStore';
import { useOverlay } from '../../hooks/useOverlay';
import {
  activeOwnedNftIdAtom,
  activeDiscoverNftIdAtom,
  sketchSeedAtom,
  pendingMintLoadAtom,
} from '../../store/atoms';
import type { Engine } from '../../engine/renderer';
import type { NftItem } from '../../utils/das-api';
import { saveDraft, loadDraft, hasDraft } from '../../services/draft-storage';
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

interface CanvasOverlayProps {
  canvasBottom: number;
  engine: Engine | null;
  onClose: () => void;
  showTouchPrompt?: boolean;
  onTransitionChange?: (state: { src: string | null; phase: SlidePhase; dir: 1 | -1 }) => void;
  needsInitialLoad?: React.RefObject<boolean>;
}

export function CanvasOverlay({ canvasBottom: _canvasBottom, engine, onClose, showTouchPrompt, onTransitionChange, needsInitialLoad }: CanvasOverlayProps) {
  const navigate = useNavigate();
  const { overlayTab, setOverlayTab, hasOwned } = useOverlayWithNfts();
  const { ownedNfts, discoverNfts } = useNftStore();
  const [activeOwnedId, setActiveOwnedId] = useAtom(activeOwnedNftIdAtom);
  const [activeDiscoverId, setActiveDiscoverId] = useAtom(activeDiscoverNftIdAtom);
  const sketchSeed = useAtomValue(sketchSeedAtom);
  const [pendingMintLoad, setPendingMintLoad] = useAtom(pendingMintLoadAtom);

  const activeTab = overlayTab;

  const browserItems = activeTab === 'owned' ? ownedNfts : activeTab === 'discover' ? discoverNfts : [];
  const browseIndex = activeTab === 'owned'
    ? indexFromId(ownedNfts, activeOwnedId)
    : activeTab === 'discover'
      ? indexFromId(discoverNfts, activeDiscoverId)
      : 0;

  const currentNft = browserItems.length > 0 ? browserItems[browseIndex] : null;
  const isBrowsing = activeTab !== 'sketch' && browserItems.length > 0;

  // --- Draft save/load for owned NFTs ---
  const [draftExists, setDraftExists] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);

  // Check if a draft exists whenever the active owned NFT changes
  useEffect(() => {
    if (activeTab !== 'owned' || !currentNft) { setDraftExists(false); return; }
    hasDraft(currentNft.id).then(setDraftExists).catch(() => setDraftExists(false));
  }, [activeTab, currentNft]);

  const handleSaveDraft = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    if (!engine || !currentNft || draftBusy) return;
    setDraftBusy(true);
    try {
      const state = await engine.serializeState();
      await saveDraft(currentNft.id, state, currentNft.defaultWaterfallMode);
      setDraftExists(true);
    } catch (err) { console.error('Draft save failed:', err); }
    setDraftBusy(false);
  }, [engine, currentNft, draftBusy]);

  const handleLoadDraft = useCallback(async (e: MouseEvent) => {
    e.stopPropagation();
    if (!engine || !currentNft || draftBusy) return;
    setDraftBusy(true);
    try {
      const draft = await loadDraft(currentNft.id);
      if (draft) loadNftIntoEngine(engine, currentNft, draft);
    } catch (err) { console.error('Draft load failed:', err); }
    setDraftBusy(false);
  }, [engine, currentNft, draftBusy]);

  // After a successful mint, load the newly minted NFT into the engine
  useEffect(() => {
    if (!pendingMintLoad || !engine || !currentNft) return;
    setPendingMintLoad(false);
    loadNftIntoEngine(engine, currentNft);
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
    const tabItems = activeTab === 'owned' ? ownedNfts : discoverNfts;
    const tabId = activeTab === 'owned' ? activeOwnedId : activeDiscoverId;
    const idx = indexFromId(tabItems, tabId);
    const nft = tabItems[idx];
    if (nft) loadNftIntoEngine(engine, nft);
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
    setOverlayTab(tab);
    triggerGlitch();
    if (!engine) return;
    if (tab === 'sketch') {
      loadSketchSeed(engine, sketchSeed);
      return;
    }
    const tabItems = tab === 'owned' ? ownedNfts : discoverNfts;
    const tabId = tab === 'owned' ? activeOwnedId : activeDiscoverId;
    const idx = indexFromId(tabItems, tabId);
    const nft = tabItems[idx];
    if (nft) loadNftIntoEngine(engine, nft);
  }, [activeTab, setOverlayTab, triggerGlitch, engine, sketchSeed, ownedNfts, discoverNfts, activeOwnedId, activeDiscoverId]);

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
      if (dx < 0) {
        // Swipe left → discover
        handleTabChange('discover');
      } else if (hasOwned) {
        // Swipe right → owned (only if available)
        handleTabChange('owned');
      }
    }
    sketchSwipeStart.current = null;
  }, [handleTabChange, hasOwned]);

  // --- Carousel transition state ---
  const [transitionSrc, setTransitionSrc] = useState<string | null>(null);
  const [slidePhase, setSlidePhase] = useState<'loading' | 'sliding' | null>(null);
  const [slideDir, setSlideDir] = useState<1 | -1>(1);
  const transitionLock = useRef(false);

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

    // 2-3. Load next NFT into engine (canvas hidden behind screenshot)
    await loadNftIntoEngineAsync(engine, nft);

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
            onClick={(e) => { e.stopPropagation(); handleTabChange('discover'); }}
            className="overlay-tab-btn absolute right-3 top-1/2 -translate-y-1/2 z-4 bg-transparent border-none cursor-pointer text-[rgba(0,255,128,0.5)] hover:text-[rgb(0,255,128)] p-2"
          >
            <CaretLineRight size={28} weight="bold" />
          </button>
        </>
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
          />

          {/* Separator */}
          <div className="canvas-overlay-separator" />

          {/* Draft save/load — owned tab only */}
          {activeTab === 'owned' && currentNft && (
            <div className="flex flex-row items-center justify-center gap-3">
              <MenuButton
                onClick={handleSaveDraft}
                disabled={draftBusy || !engine}
                className="tracking-[0.12em] uppercase"
              >
                <FloppyDisk size={16} weight="bold" className="shrink-0" />
                Save
              </MenuButton>
              <MenuButton
                onClick={handleLoadDraft}
                disabled={draftBusy || !engine || !draftExists}
                className="tracking-[0.12em] uppercase"
              >
                <ClockCounterClockwise size={16} weight="bold" className="shrink-0" />
                Load
              </MenuButton>
            </div>
          )}

          {/* Buttons row */}
          <div className="flex flex-row items-center justify-center gap-4 mt-1">
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
    </div>
  );
}

function useOverlayWithNfts() {
  const { overlayTab, setOverlayTab } = useOverlay();
  const { hasOwned } = useNftStore();
  return { overlayTab, setOverlayTab, hasOwned };
}
