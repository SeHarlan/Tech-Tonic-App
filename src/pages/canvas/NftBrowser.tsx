import { useRef, useCallback } from 'react';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import type { NftItem } from '../../utils/das-api';

interface NftBrowserProps {
  items: NftItem[];
  index: number;
  onNavigate: (dir: 1 | -1) => void;
}

const SWIPE_THRESHOLD = 50;

/**
 * Full-screen NFT browsing layer: background image + edge-mounted arrow buttons.
 * Renders at the overlay level (not inside the panel).
 */
export function NftBrowser({ items, index, onNavigate }: NftBrowserProps) {
  const pointerStart = useRef<{ x: number } | null>(null);
  const didSwipe = useRef(false);

  const current = items[index];

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

  const count = items.length;
  if (count === 0) return null;

  return (
    <>
      {/* Thumbnail positioned like the canvas — centered, scaled 0.8, with glow border */}
      <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
        <img
          src={current.thumbnailUrl}
          alt={current.name}
          className="canvas-overlay-glow max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>

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
