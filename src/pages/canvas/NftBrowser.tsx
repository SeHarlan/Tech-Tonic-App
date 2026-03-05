import { useRef, useCallback } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { Engine } from '../../engine/renderer';
import type { NftItem } from '../../utils/das-api';

interface NftBrowserProps {
  count: number;
  onNavigate: (dir: 1 | -1) => void;
}

const SWIPE_THRESHOLD = 50;
const RENDER_FRAMES_BEFORE_FREEZE = 3;

function renderThenFreeze(engine: Engine) {
  engine.setGlobalFreeze(false);
  let frames = 0;
  const wait = () => {
    frames++;
    if (frames >= RENDER_FRAMES_BEFORE_FREEZE) {
      engine.setGlobalFreeze(true);
    } else {
      requestAnimationFrame(wait);
    }
  };
  requestAnimationFrame(wait);
}

export function loadNftIntoEngine(engine: Engine, nft: NftItem) {
  engine.loadSession(nft.seed, nft.frameCount, nft.thumbnailUrl, nft.defaultWaterfallMode)
    .then(() => renderThenFreeze(engine))
    .catch((err) => console.error('Failed to load NFT into engine:', err));
}

export function loadSketchSeed(engine: Engine, seed: number) {
  engine.setSeed(seed);
  renderThenFreeze(engine);
}

/**
 * Full-screen NFT browsing layer: swipe/arrow navigation UI.
 * Loading is handled imperatively by the parent on user actions.
 */
export function NftBrowser({ count, onNavigate }: NftBrowserProps) {
  const pointerStart = useRef<{ x: number } | null>(null);
  const didSwipe = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    pointerStart.current = { x: e.clientX };
    didSwipe.current = false;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!pointerStart.current) return;
    const dx = e.clientX - pointerStart.current.x;
    if (Math.abs(dx) >= SWIPE_THRESHOLD) {
      didSwipe.current = true;
      onNavigate(dx < 0 ? 1 : -1);
    }
    pointerStart.current = null;
  }, [onNavigate]);

  if (count === 0) return null;

  return (
    <>
      {/* Swipe capture zone — only blocks click propagation after a real swipe */}
      <div
        className="absolute inset-0 z-3 touch-none"
        onClick={(e) => { if (didSwipe.current) e.stopPropagation(); }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { pointerStart.current = null; }}
      />

      {count > 1 && (
        <>
          {/* Left arrow — vertically centered, left edge */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNavigate(-1); }}
            className="overlay-tab-btn absolute left-3 top-1/2 -translate-y-1/2 z-4 bg-transparent border-none cursor-pointer text-[rgba(0,255,128,0.5)] hover:text-[rgb(0,255,128)] p-2"
          >
            <CaretLeft size={28} weight="bold" />
          </button>

          {/* Right arrow — vertically centered, right edge */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onNavigate(1); }}
            className="overlay-tab-btn absolute right-3 top-1/2 -translate-y-1/2 z-4 bg-transparent border-none cursor-pointer text-[rgba(0,255,128,0.5)] hover:text-[rgb(0,255,128)] p-2"
          >
            <CaretRight size={28} weight="bold" />
          </button>
        </>
      )}
    </>
  );
}
