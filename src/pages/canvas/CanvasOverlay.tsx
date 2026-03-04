import { MenuButton } from '../../components/ui/MenuButton';
import { WalletButton } from '../../components/ui/WalletButton';
import { useNavigate } from 'react-router';
import { cn } from '../../utils/ui-helpers';
import type { Engine } from '../../engine/renderer';
import './canvas-overlay.css';
import { XIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';

interface CanvasOverlayProps {
  canvasBottom: number;
  onClose: () => void;
  engine: Engine | null;
}

export function CanvasOverlay({ canvasBottom: _canvasBottom, onClose }: CanvasOverlayProps) {
  const navigate = useNavigate();

  const controlBottom = useMemo(() => {
    const midpoint = _canvasBottom + (window.innerHeight - _canvasBottom) / 2;
    // panel is ~80px tall, half = 40px
    const accountForTranslation = 40;
    const maxTop = window.innerHeight - accountForTranslation - 40;
    return Math.min(midpoint, maxTop);
  }, [_canvasBottom]);

  return (
    <div
      className={cn(
        "canvas-overlay",
        "fixed inset-0 z-50 flex items-end justify-center overflow-hidden",
      )}
      onClick={onClose}
    >
      {/* Static scanlines over entire overlay */}
      <span className="canvas-overlay-scanlines" />

      {/* CRT vignette */}
      <div className="canvas-overlay-vignette" />

      {/* Glitch bars */}
      <span className="canvas-overlay-glitch canvas-overlay-glitch-a" />
      <span className="canvas-overlay-glitch canvas-overlay-glitch-b" />
      <span className="canvas-overlay-glitch canvas-overlay-glitch-c" />

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
            System
          </p>

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
