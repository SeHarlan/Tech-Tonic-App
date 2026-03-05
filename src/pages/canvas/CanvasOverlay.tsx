import { useMemo, useCallback } from 'react';
import { useAtom } from 'jotai';
import { MenuButton } from '../../components/ui/MenuButton';
import { WalletButton } from '../../components/ui/WalletButton';
import { useNavigate } from 'react-router';
import { cn } from '../../utils/ui-helpers';
import { OverlayTabs, type OverlayTab } from './OverlayTabs';
import { NftBrowser } from './NftBrowser';
import { XIcon } from '@phosphor-icons/react';
import { useNftStore } from '../../hooks/useNftStore';
import { useOverlay } from '../../hooks/useOverlay';
import {
  activeOwnedNftIdAtom,
  activeDiscoverNftIdAtom,
} from '../../store/atoms';
import type { NftItem } from '../../utils/das-api';
import './canvas-overlay.css';

/** Resolve a persisted NFT ID to an index in a list, falling back to 0. */
function indexFromId(list: NftItem[], id: string | null): number {
  if (!id) return 0;
  const i = list.findIndex((n) => n.id === id);
  return i >= 0 ? i : 0;
}

interface CanvasOverlayProps {
  canvasBottom: number;
  onClose: (selectedSeed?: number) => void;
}

export function CanvasOverlay({ canvasBottom: _canvasBottom, onClose }: CanvasOverlayProps) {
  const navigate = useNavigate();
  const { overlayTab, setOverlayTab, hasOwned } = useOverlayWithNfts();
  const { ownedNfts, discoverNfts } = useNftStore();
  const [activeOwnedId, setActiveOwnedId] = useAtom(activeOwnedNftIdAtom);
  const [activeDiscoverId, setActiveDiscoverId] = useAtom(activeDiscoverNftIdAtom);

  const activeTab = overlayTab;

  const browserItems = activeTab === 'owned' ? ownedNfts : activeTab === 'discover' ? discoverNfts : [];
  const browseIndex = activeTab === 'owned'
    ? indexFromId(ownedNfts, activeOwnedId)
    : activeTab === 'discover'
      ? indexFromId(discoverNfts, activeDiscoverId)
      : 0;

  const currentNft = browserItems.length > 0 ? browserItems[browseIndex] : null;
  const isBrowsing = activeTab !== 'sketch' && browserItems.length > 0;

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

  const handleClose = useCallback(() => {
    if (activeTab !== 'sketch' && currentNft) {
      onClose(currentNft.seed);
    } else {
      onClose();
    }
  }, [activeTab, currentNft, onClose]);

  const handleTabChange = useCallback((tab: OverlayTab) => {
    setOverlayTab(tab);
  }, [setOverlayTab]);

  const handleNavigate = useCallback((dir: 1 | -1) => {
    const len = browserItems.length;
    if (len === 0) return;
    const next = (browseIndex + dir + len) % len;
    const nft = browserItems[next];
    if (activeTab === 'owned') setActiveOwnedId(nft.id);
    else if (activeTab === 'discover') setActiveDiscoverId(nft.id);
  }, [browserItems, browseIndex, activeTab, setActiveOwnedId, setActiveDiscoverId]);

  return (
    <div
      className={cn(
        "canvas-overlay",
        "fixed inset-0 z-50 flex items-end justify-center overflow-hidden",
      )}
      onClick={handleClose}
    >
      {/* Full-screen NFT browser (image + arrows + swipe) — behind overlay effects */}
      {isBrowsing && (
        <NftBrowser items={browserItems} index={browseIndex} onNavigate={handleNavigate} />
      )}

      {/* Static scanlines over entire overlay */}
      <span className="canvas-overlay-scanlines" />

      {/* CRT vignette */}
      <div className="canvas-overlay-vignette" />

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
        onClick={handleClose}
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
