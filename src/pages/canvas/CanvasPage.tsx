import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useAtomValue } from 'jotai';
import { FloppyDiskIcon } from '@phosphor-icons/react';
import { createEngine, type Engine } from '../../engine/renderer';
import { cn } from '../../utils/ui-helpers';
import { MenuDrawer, type MenuDrawerHandle } from './MenuDrawer';
import { CanvasOverlay, type SlidePhase } from './CanvasOverlay';
import { useOverlay } from '../../hooks/useOverlay';
import { useHandTracking } from '../../hooks/useHandTracking';
import { useAutoDraft } from '../../hooks/useAutoDraft';
import { sketchSeedAtom, pendingMintLoadAtom, overlayTabAtom } from '../../store/atoms';
import './canvas-overlay.css';

// --- Brush Overlay ---

interface BrushOverlayHandle {
  refresh(): void;
  updateFromHandTracking(clientX: number, clientY: number): void;
}

interface BrushOverlayProps {
  engine: Engine | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hidden: boolean;
  /** When true, show a small pointer dot instead of the brush preview */
  pointerMode?: boolean;
}

const BrushOverlay = forwardRef<BrushOverlayHandle, BrushOverlayProps>(function BrushOverlay({ engine, canvasRef, hidden, pointerMode }, ref) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const visible = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const updatePosition = useCallback((clientX: number, clientY: number) => {
    lastPos.current = { x: clientX, y: clientY };
    const el = overlayRef.current;
    const canvas = canvasRef.current;
    if (!el || !engine || !canvas || hidden) {
      if (el) el.style.opacity = '0';
      return;
    }

    el.style.left = clientX + 'px';
    el.style.top = clientY + 'px';

    // Always show brush preview ring
    const rect = canvas.getBoundingClientRect();
    const brushSz = engine.getDrawingManager().getBrushSize();
    const params = engine.getParams();

    const displayScaleX = rect.width / canvas.width;
    const displayScaleY = rect.height / canvas.height;
    let displayWidth = brushSz * 2 * displayScaleX;
    let displayHeight = brushSz * 2 * displayScaleY;

    let isSquare = false;
    if (params.fxWithBlocking) {
      const blockWidthPx = canvas.width / params.blockingScale;
      const blockHeightPx = canvas.height / params.blockingScale;
      displayHeight = brushSz * 2 * (blockHeightPx / blockWidthPx) * displayScaleY;
      isSquare = true;
    }

    el.style.width = displayWidth + 'px';
    el.style.height = displayHeight + 'px';
    el.style.borderRadius = isSquare ? '0' : '50%';
    el.style.border = '2px solid rgba(0, 255, 128, 0.7)';

    // In pointer mode: add a filled center dot via radial gradient
    if (pointerMode) {
      el.style.background = 'radial-gradient(circle, rgba(0,255,128,0.9) 3px, transparent 4px)';
    } else {
      el.style.background = 'transparent';
    }

    el.style.opacity = '1';
    visible.current = true;
  }, [engine, canvasRef, hidden, pointerMode]);

  const hide = useCallback(() => {
    if (overlayRef.current) overlayRef.current.style.opacity = '0';
    visible.current = false;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || hidden) { hide(); return; }

    function onMouseMove(e: MouseEvent) { updatePosition(e.clientX, e.clientY); }
    function onMouseEnter(e: MouseEvent) { updatePosition(e.clientX, e.clientY); }
    function onMouseLeave() { hide(); }
    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      if (t) updatePosition(t.clientX, t.clientY);
    }
    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (t) updatePosition(t.clientX, t.clientY);
    }
    function onTouchEnd() { hide(); }
    function onPointerMove(e: PointerEvent) {
      if (e.pointerType === 'touch') return;
      updatePosition(e.clientX, e.clientY);
    }
    function onPointerLeave() { hide(); }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseenter', onMouseEnter);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseenter', onMouseEnter);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [canvasRef, hidden, updatePosition, hide]);

  const autoHideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const refresh = useCallback(() => {
    if (visible.current && lastPos.current) {
      updatePosition(lastPos.current.x, lastPos.current.y);
    } else {
      // No cursor on canvas — show centered on canvas with auto-hide
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      updatePosition(cx, cy);
      clearTimeout(autoHideTimer.current);
      autoHideTimer.current = setTimeout(hide, 800);
    }
  }, [updatePosition, canvasRef, hide]);

  useImperativeHandle(ref, () => ({
    refresh,
    updateFromHandTracking(clientX: number, clientY: number) {
      updatePosition(clientX, clientY);
    },
  }), [refresh, updatePosition]);

  useEffect(() => { if (hidden) hide(); }, [hidden, hide]);

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'fixed',
        pointerEvents: 'none',
        border: '2px solid rgba(0, 255, 128, 0.7)',
        borderRadius: '50%',
        background: 'transparent',
        transform: 'translate(-50%, -50%)',
        zIndex: 9999,
        opacity: 0,
        transition: 'opacity 0.15s ease, border-radius 0s',
      }}
    />
  );
});

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
  const [searchParams] = useSearchParams();
  const autostart = searchParams.has('autostart');
  const autoHandTracking = searchParams.has('handtracking');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const menuDrawerRef = useRef<MenuDrawerHandle>(null);
  const brushOverlayRef = useRef<BrushOverlayHandle>(null);
  const engineRef = useRef<Engine | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const seed = useAtomValue(sketchSeedAtom);
  const pendingMintLoad = useAtomValue(pendingMintLoadAtom);
  const currentTab = useAtomValue(overlayTabAtom);
  const { isOverlayOpen, openOverlay, closeOverlay } = useOverlay();
  const { isSaving, saveNow } = useAutoDraft(engine);
  const isInitialRender = useRef(true);
  const needsInitialLoad = useRef(true);
  const [handTrackingEnabled, setHandTrackingEnabled] = useState(autoHandTracking);
  const prevHandDrawing = useRef(false);   // owned by draw effect
  const prevClickDrawing = useRef(false);  // owned by virtual click effect
  // Set when a pinch is consumed as an in-menu click. Blocks the draw effect
  // from starting a stroke on the same pinch cycle (user must release and
  // re-pinch). Mirrors how a real mouse press+release on a menu doesn't
  // start a drag on the canvas below.
  const suppressHandDrawUntilRelease = useRef(false);

  // Check actual menu DOM state — always in sync, no stale refs
  const isMenuOpen = useCallback(() => {
    const el = document.getElementById('menu-container');
    return el ? !el.classList.contains('menu-closed') : false;
  }, []);

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

  // Hand tracking (browser only)
  const brushRange = useMemo(() => {
    const opts = engine?.getDrawingManager().getBrushSizeOptions() ?? [];
    return { min: opts[0] ?? 1, max: opts[opts.length - 1] ?? 64 };
  }, [engine]);
  const handTracking = useHandTracking(canvasRef, handTrackingEnabled, brushRange);

  // Create engine and open overlay on mount (or when seed changes)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const eng = createEngine({ canvas, seed });
    engineRef.current = eng;
    setEngine(eng);
    eng.start();
    needsInitialLoad.current = true;

    if (autostart) {
      // Skip overlay — go straight to drawing canvas
      isInitialRender.current = false;
    } else {
      // Restore persisted tab — use 'owned' when returning from a successful mint
      openOverlay(pendingMintLoad ? 'owned' : currentTab);
      computeCanvasBottom();

      // Let a few frames render so the canvas isn't blank, then freeze.
      // We count to 5 then freeze on the NEXT rAF to guarantee the engine's
      // render loop has painted the final frame before we halt it.
      isInitialRender.current = true;
      let frames = 0;
      const waitForContent = () => {
        frames++;
        if (frames >= 5) {
          // Freeze one frame later so the engine's rAF callback runs first
          requestAnimationFrame(() => {
            eng.setGlobalFreeze(true);
            isInitialRender.current = false;
          });
        } else {
          requestAnimationFrame(waitForContent);
        }
      };
      requestAnimationFrame(waitForContent);
    }

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
    // Skip during initial 3-frame warmup — waitForContent handles freeze
    if (isInitialRender.current) return;
    engine.setGlobalFreeze(true);
    computeCanvasBottom();
  }, [engine, isOverlayOpen, computeCanvasBottom]);

  const toggleOverlay = useCallback(() => {
    if (isOverlayOpen) {
      closeOverlay();
      engine?.setGlobalFreeze(false);
    } else {
      saveNow();
      menuDrawerRef.current?.close();
      engine?.setGlobalFreeze(true);
      computeCanvasBottom();
      openOverlay();
    }
  }, [engine, isOverlayOpen, openOverlay, closeOverlay, computeCanvasBottom, saveNow]);

  const handleOverlayClose = useCallback(() => {
      closeOverlay();
      // NFT is already loaded into the engine by NftBrowser — just unfreeze
      engine?.setGlobalFreeze(false);
    },
    [engine, closeOverlay],
  );

  // Toggle hand tracking with 'h' key (browser only)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).Capacitor?.isNativePlatform?.()) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        setHandTrackingEnabled((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Open/close menu from hand gesture
  useEffect(() => {
    if (handTracking.menuCommand === 'open' && !isMenuOpen()) {
      menuDrawerRef.current?.open();
    } else if (handTracking.menuCommand === 'close' && isMenuOpen()) {
      menuDrawerRef.current?.close();
    }
  }, [handTracking.menuCommand, isMenuOpen]);

  // Virtual click: when menu is open and hand tracking pinches, behave like a real mouse.
  // - Click on canvas (outside menu): close menu + start drawing immediately
  // - Click on menu button: perform the action
  // - Click on menu non-button area: close menu, do NOT start drawing
  useEffect(() => {
    if (!isMenuOpen() || !handTracking.isActive) {
      prevClickDrawing.current = handTracking.isDrawing;
      return;
    }
    if (handTracking.isDrawing && !prevClickDrawing.current) {
      const { x, y } = handTracking.clientPosition;
      const el = document.elementFromPoint(x, y);
      if (el instanceof HTMLElement) {
        const menuContainer = document.getElementById('menu-container');
        const actionBar = document.getElementById('engine-action-bar');
        const isInsideMenu = !!(menuContainer?.contains(el) || actionBar?.contains(el));

        if (isInsideMenu) {
          // Click inside menu — dispatch events, let menu handle it
          // (button click or non-button close are handled by menu's own handlers).
          // Set suppress flag so the draw effect won't start a stroke on this
          // same pinch — even if the click closed the menu (empty-area click).
          suppressHandDrawUntilRelease.current = true;
          el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
          el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
          el.click();
          brushOverlayRef.current?.refresh();
        } else {
          // Click outside menu (canvas) — close menu, draw effect will start drawing
          menuDrawerRef.current?.close();
        }
      }
    }
    prevClickDrawing.current = handTracking.isDrawing;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handTracking.isDrawing, handTracking.isActive, isMenuOpen]);

  // Drive engine from hand tracking (skip when menu is open — pinch = click, not draw)
  useEffect(() => {
    const menuUp = isMenuOpen();
    if (!engine || !handTracking.isActive || menuUp) {
      if (prevHandDrawing.current && !menuUp) {
        engine?.handlePointerUp();
        prevHandDrawing.current = false;
      }
      return;
    }

    const { canvasPosition, isDrawing, brushSize } = handTracking;

    // If the current pinch was consumed as an in-menu click, don't start a
    // stroke. Wait for the user to release before re-enabling draw handling.
    if (suppressHandDrawUntilRelease.current) {
      if (brushSize !== null) {
        engine.getDrawingManager().setBrushSize(brushSize);
      }
      if (!isDrawing) {
        suppressHandDrawUntilRelease.current = false;
      }
      return;
    }

    // Update brush size from left hand (if detected)
    if (brushSize !== null) {
      engine.getDrawingManager().setBrushSize(brushSize);
    }

    // Draw state transitions
    if (isDrawing && !prevHandDrawing.current) {
      engine.handlePointerDown(canvasPosition.x, canvasPosition.y);
    } else if (isDrawing && prevHandDrawing.current) {
      engine.handlePointerMove(canvasPosition.x, canvasPosition.y);
    } else if (!isDrawing && prevHandDrawing.current) {
      engine.handlePointerUp();
    }
    prevHandDrawing.current = isDrawing;
  }, [engine, handTracking]);

  // Update brush overlay from hand tracking
  useEffect(() => {
    if (!handTracking.isActive) return;
    brushOverlayRef.current?.updateFromHandTracking(
      handTracking.clientPosition.x,
      handTracking.clientPosition.y,
    );
  }, [handTracking.clientPosition.x, handTracking.clientPosition.y, handTracking.isActive]);

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

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    if (!engine) return;
    e.preventDefault();
    const dm = engine.getDrawingManager();
    const opts = dm.getBrushSizeOptions();
    const min = opts[0] ?? 1;
    const max = opts[opts.length - 1] ?? 64;
    const range = max - min;
    const step = range * 0.04; // 4% of range per scroll tick
    const current = dm.getBrushSize();
    const next = Math.max(min, Math.min(max, current + (e.deltaY < 0 ? step : -step)));
    dm.setBrushSize(next);
    brushOverlayRef.current?.refresh();
  }

  return (
    <div className="fixed inset-x-0 top-0 bottom-[44px]  flex items-center justify-center">
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
            : !engine
              ? { transform: `scale(${CANVAS_OVERLAY_SCALE})` }
              : undefined
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
      <BrushOverlay ref={brushOverlayRef} engine={engine} canvasRef={canvasRef} hidden={isOverlayOpen} pointerMode={handTrackingEnabled && isMenuOpen()} />
      <div className={cn(
        "fixed top-4 left-4 z-100 pointer-events-none flex items-center gap-1.5 transition-opacity duration-500 ease-in-out",
        isSaving ? "opacity-100" : "opacity-0",
      )}>
        <FloppyDiskIcon size={16} weight="bold" className="text-[rgba(0,255,128,0.6)] animate-pulse" />
        <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[rgba(0,255,128,0.5)]">draft saved</span>
      </div>
      <MenuDrawer ref={menuDrawerRef} engine={engine} onAppMenu={toggleOverlay} onBrushSizeChange={() => brushOverlayRef.current?.refresh()} hidden={isOverlayOpen} />

      {isOverlayOpen && (
        <CanvasOverlay
          canvasBottom={canvasBottom}
          engine={engine}
          onClose={handleOverlayClose}
          showTouchPrompt
          onTransitionChange={handleTransitionChange}
          needsInitialLoad={needsInitialLoad}
        />
      )}
    </div>
  );
}
