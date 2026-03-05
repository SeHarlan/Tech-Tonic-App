import { useRef, useEffect, useState, useCallback } from 'react';
import { createEngine, type Engine } from '../../engine/renderer';
import { cn } from '../../utils/ui-helpers';
import { MenuDrawer, type MenuDrawerHandle } from './MenuDrawer';
import { CanvasOverlay } from './CanvasOverlay';
import { useOverlay } from '../../hooks/useOverlay';
import type { NftItem } from '../../utils/das-api';
import './canvas-overlay.css';

/** Check localStorage to detect a previously connected wallet (auto-reconnect). */
const hadWallet = !!localStorage.getItem('connector-kit:wallet');

function toCanvasCoords(
  e: React.PointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width),
    y: canvas.height - (e.clientY - rect.top) * (canvas.height / rect.height),
  };
}

export function CanvasPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const menuDrawerRef = useRef<MenuDrawerHandle>(null);
  const engineRef = useRef<Engine | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [seed] = useState(() => Math.floor(Math.random() * 1000));
  const { isOverlayOpen, openOverlay, closeOverlay } = useOverlay();

  const [canvasBottom, setCanvasBottom] = useState(0);

  const computeCanvasBottom = useCallback(() => {
    if (canvasRef.current) {
      const h = canvasRef.current.offsetHeight;
      setCanvasBottom(window.innerHeight / 2 + (h * 0.8) / 2);
    }
  }, []);

  // --- No-wallet path: create engine immediately, open overlay ---
  useEffect(() => {
    if (hadWallet) return; // wallet path handled separately
    const canvas = canvasRef.current;
    if (!canvas) return;

    const eng = createEngine({ canvas, seed });
    engineRef.current = eng;
    setEngine(eng);
    eng.start();
    openOverlay('sketch');
    computeCanvasBottom();

    // Let a few frames render so the canvas isn't blank, then freeze
    let frames = 0;
    const waitForContent = () => {
      frames++;
      if (frames >= 3) {
        eng.setGlobalFreeze(true);
      } else {
        requestAnimationFrame(waitForContent);
      }
    };
    requestAnimationFrame(waitForContent);

    return () => {
      eng.destroy();
      engineRef.current = null;
      setEngine(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // Sync engine freeze when overlay reopens (covers return from /mint)
  useEffect(() => {
    if (!engine || !isOverlayOpen) return;
    engine.setGlobalFreeze(true);
    computeCanvasBottom();
  }, [engine, isOverlayOpen, computeCanvasBottom]);

  const toggleOverlay = useCallback(() => {
    if (isOverlayOpen) {
      closeOverlay();
      engine?.setGlobalFreeze(false);
    } else {
      menuDrawerRef.current?.close();
      engine?.setGlobalFreeze(true);
      computeCanvasBottom();
      openOverlay();
    }
  }, [engine, isOverlayOpen, openOverlay, closeOverlay, computeCanvasBottom]);

  const handleOverlayClose = useCallback(
    (selectedNft?: NftItem) => {
      closeOverlay();
      if (engine && selectedNft) {
        engine
          .loadSession(selectedNft.seed, selectedNft.frameCount, selectedNft.thumbnailUrl)
          .catch((err) => console.error('Failed to load NFT session:', err))
          .finally(() => engine.setGlobalFreeze(false));
      } else if (engine) {
        engine.setGlobalFreeze(false);
      }
    },
    [engine, closeOverlay],
  );

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const { x, y } = toCanvasCoords(e, canvas);
    engine.handlePointerDown(x, y);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;
    const { x, y } = toCanvasCoords(e, canvas);
    engine.handlePointerMove(x, y);
  }

  function onPointerUp() {
    engine?.handlePointerUp();
  }

  const showTouchPrompt = !hadWallet;

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <canvas
        ref={canvasRef}
        className={cn('z-10 max-h-full max-w-full object-contain touch-none transition-transform duration-500 ease-in-out', isOverlayOpen && 'canvas-overlay-glow')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <MenuDrawer ref={menuDrawerRef} engine={engine} onAppMenu={toggleOverlay} hidden={isOverlayOpen} />

      {isOverlayOpen && (
        <CanvasOverlay
          canvasBottom={canvasBottom}
          onClose={handleOverlayClose}
          showTouchPrompt={showTouchPrompt}
        />
      )}
    </div>
  );
}
