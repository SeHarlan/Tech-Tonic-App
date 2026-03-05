import { useRef, useEffect, useState, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { createEngine, type Engine } from '../../engine/renderer';
import { cn } from '../../utils/ui-helpers';
import { MenuDrawer, type MenuDrawerHandle } from './MenuDrawer';
import { CanvasOverlay, type SlidePhase } from './CanvasOverlay';
import { useOverlay } from '../../hooks/useOverlay';
import { sketchSeedAtom, pendingMintLoadAtom } from '../../store/atoms';
import './canvas-overlay.css';

const SLIDE_DURATION_MS = 350;
const CANVAS_OVERLAY_SCALE = 0.8;
const SLIDE_EXIT_SCALE = 0.65;
const SLIDE_ENTER_SCALE = 0.55;

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
  const seed = useAtomValue(sketchSeedAtom);
  const pendingMintLoad = useAtomValue(pendingMintLoadAtom);
  const { isOverlayOpen, openOverlay, closeOverlay } = useOverlay();

  const [canvasBottom, setCanvasBottom] = useState(0);

  // Carousel transition state (lifted from CanvasOverlay)
  const [transitionSrc, setTransitionSrc] = useState<string | null>(null);
  const [slidePhase, setSlidePhase] = useState<SlidePhase>(null);
  const [slideDir, setSlideDir] = useState<1 | -1>(1);

  const handleTransitionChange = useCallback((state: { src: string | null; phase: SlidePhase; dir: 1 | -1 }) => {
    setTransitionSrc(state.src);
    setSlidePhase(state.phase);
    setSlideDir(state.dir);
  }, []);

  const computeCanvasBottom = useCallback(() => {
    if (canvasRef.current) {
      const h = canvasRef.current.offsetHeight;
      setCanvasBottom(window.innerHeight / 2 + (h * 0.8) / 2);
    }
  }, []);

  // Create engine and open overlay on mount (or when seed changes)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const eng = createEngine({ canvas, seed });
    engineRef.current = eng;
    setEngine(eng);
    eng.start();
    // Default to sketch overlay unless arriving from a successful mint
    if (!pendingMintLoad) openOverlay('sketch');
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

  const handleOverlayClose = useCallback(() => {
      closeOverlay();
      // NFT is already loaded into the engine by NftBrowser — just unfreeze
      engine?.setGlobalFreeze(false);
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

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      {/* Carousel transition screenshot — slides out as old content */}
      {transitionSrc && (
        <img
          src={transitionSrc}
          alt=""
          className="absolute z-20 max-h-full max-w-full object-contain pointer-events-none"
          style={{
            transition: slidePhase === 'sliding'
              ? `transform ${SLIDE_DURATION_MS}ms ease-in-out, opacity ${SLIDE_DURATION_MS}ms ease-in-out`
              : 'none',
            transform: slidePhase === 'sliding'
              ? `translateX(${slideDir === 1 ? '-100%' : '100%'}) scale(${SLIDE_EXIT_SCALE})`
              : `scale(${CANVAS_OVERLAY_SCALE})`,
            opacity: slidePhase === 'sliding' ? 0 : 1,
          }}
        />
      )}

      <canvas
        ref={canvasRef}
        className={cn(
          'z-10 max-h-full max-w-full object-contain touch-none',
          // Normal overlay scale transition (only when not carousel-sliding)
          !slidePhase && 'transition-transform duration-500 ease-in-out',
          isOverlayOpen && 'canvas-overlay-glow',
          !engine && 'bg-[rgba(0,255,128,0.1)]',
        )}
        style={slidePhase === 'loading'
          ? {
              // Instantly position off-screen + small + transparent (no transition)
              transform: `translateX(${slideDir === 1 ? '100%' : '-100%'}) scale(${SLIDE_ENTER_SCALE})`,
              opacity: 0,
            }
          : slidePhase === 'sliding'
            ? {
                // Animate into place at overlay scale
                transition: `transform ${SLIDE_DURATION_MS}ms ease-in-out, opacity ${SLIDE_DURATION_MS}ms ease-in-out`,
                transform: `scale(${CANVAS_OVERLAY_SCALE})`,
                opacity: 1,
              }
            : undefined
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <MenuDrawer ref={menuDrawerRef} engine={engine} onAppMenu={toggleOverlay} hidden={isOverlayOpen} />

      {isOverlayOpen && (
        <CanvasOverlay
          canvasBottom={canvasBottom}
          engine={engine}
          onClose={handleOverlayClose}
          showTouchPrompt
          onTransitionChange={handleTransitionChange}
        />
      )}
    </div>
  );
}
