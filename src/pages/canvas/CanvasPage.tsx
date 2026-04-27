import { useRef, useEffect, useState, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useAtomValue } from 'jotai';
import { FloppyDiskIcon } from '@phosphor-icons/react';
import { createEngine, type Engine } from '../../engine/renderer';
import { cn } from '../../utils/ui-helpers';
import { clientToCanvas } from '../../utils/canvas-aspect';
import { MenuDrawer, type MenuDrawerHandle } from './MenuDrawer';
import { CanvasOverlay, type SlidePhase } from './CanvasOverlay';
import { useOverlay } from '../../hooks/useOverlay';
import { useHandTracking } from '../../hooks/useHandTracking';
import { useAutoDraft } from '../../hooks/useAutoDraft';
import { sketchSeedAtom, pendingMintLoadAtom, overlayTabAtom } from '../../store/atoms';
import './canvas-overlay.css';

// --- Brush Overlay ---
//
// Two visual elements:
//   1. Ring — the brush preview circle. Follows the cursor while it's over the
//      canvas, hides when it leaves (same as a normal mouse). Can be pinned to
//      the canvas center while the two-hand brush-adjust gesture is active.
//   2. Dot — a small green cursor dot. Only visible while hand tracking is
//      active. Unlike the ring, the dot is always visible, including when the
//      hand cursor is hovering over the menu (higher z-index than menu).

interface BrushOverlayHandle {
  refresh(): void;
  /** Update dot position + ring position (hides ring if off-canvas). */
  updateFromHandTracking(clientX: number, clientY: number): void;
  /** Clear dot visibility (hand tracking disabled or lost). */
  hideDot(): void;
}

interface BrushOverlayProps {
  engine: Engine | null;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  hidden: boolean;
  /** When true, pin the brush ring to the canvas center regardless of cursor. */
  centerRing?: boolean;
  /**
   * When true, the canvas is stretched non-uniformly (fullscreen mode). Force
   * a uniform scale for the brush ring so it stays a perfect circle instead
   * of following the stretched aspect ratio.
   */
  forceUniformScale?: boolean;
  /**
   * True when the canvas element is CSS-rotated 90° CW (portrait viewport).
   * The ring's X/Y screen-to-canvas scale factors swap axes.
   */
  rotated?: boolean;
}

const BrushOverlay = forwardRef<BrushOverlayHandle, BrushOverlayProps>(function BrushOverlay({ engine, canvasRef, hidden, centerRing, forceUniformScale, rotated }, ref) {
  const ringRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const visible = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const updatePosition = useCallback((clientX: number, clientY: number, prefetchedRect?: DOMRect) => {
    lastPos.current = { x: clientX, y: clientY };
    const el = ringRef.current;
    const canvas = canvasRef.current;
    if (!el || !engine || !canvas || hidden) {
      if (el) el.style.opacity = '0';
      return;
    }

    const rect = prefetchedRect ?? canvas.getBoundingClientRect();

    let drawX = clientX;
    let drawY = clientY;
    if (centerRing) {
      drawX = rect.left + rect.width / 2;
      drawY = rect.top + rect.height / 2;
    }

    el.style.left = drawX + 'px';
    el.style.top = drawY + 'px';

    const brushSz = engine.getDrawingManager().getBrushSize();
    const params = engine.getParams();

    // Screen-px per native-canvas-px, accounting for 90° CSS rotation.
    // When rotated, screen X spans canvas-Y (native height) and vice versa.
    const displayScaleX = rotated ? rect.width / canvas.height : rect.width / canvas.width;
    const displayScaleY = rotated ? rect.height / canvas.width : rect.height / canvas.height;
    // In fullscreen mode the canvas is stretched non-uniformly — lock both
    // axes to the X scale so the ring stays a perfect circle.
    const ringScaleY = forceUniformScale ? displayScaleX : displayScaleY;
    const displayWidth = brushSz * 2 * displayScaleX;
    let displayHeight = brushSz * 2 * ringScaleY;

    let isSquare = false;
    if (params.fxWithBlocking) {
      const blockWidthPx = canvas.width / params.blockingScale;
      const blockHeightPx = canvas.height / params.blockingScale;
      displayHeight = brushSz * 2 * (blockHeightPx / blockWidthPx) * ringScaleY;
      isSquare = true;
    }

    el.style.width = displayWidth + 'px';
    el.style.height = displayHeight + 'px';
    el.style.borderRadius = isSquare ? '0' : '50%';
    el.style.opacity = '1';
    visible.current = true;
  }, [engine, canvasRef, hidden, centerRing, forceUniformScale, rotated]);

  const hide = useCallback(() => {
    if (ringRef.current) ringRef.current.style.opacity = '0';
    visible.current = false;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || hidden) { hide(); return; }

    const leaveIfNotPinned = () => { if (!centerRing) hide(); };

    function onMouseMove(e: MouseEvent) { updatePosition(e.clientX, e.clientY); }
    function onMouseEnter(e: MouseEvent) { updatePosition(e.clientX, e.clientY); }
    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0];
      if (t) updatePosition(t.clientX, t.clientY);
    }
    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      if (t) updatePosition(t.clientX, t.clientY);
    }
    function onPointerMove(e: PointerEvent) {
      if (e.pointerType === 'touch') return;
      updatePosition(e.clientX, e.clientY);
    }

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseenter', onMouseEnter);
    canvas.addEventListener('mouseleave', leaveIfNotPinned);
    canvas.addEventListener('touchmove', onTouchMove, { passive: true });
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });
    canvas.addEventListener('touchend', leaveIfNotPinned);
    canvas.addEventListener('touchcancel', leaveIfNotPinned);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', leaveIfNotPinned);

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseenter', onMouseEnter);
      canvas.removeEventListener('mouseleave', leaveIfNotPinned);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchend', leaveIfNotPinned);
      canvas.removeEventListener('touchcancel', leaveIfNotPinned);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', leaveIfNotPinned);
    };
  }, [canvasRef, hidden, centerRing, updatePosition, hide]);

  // When centerRing turns on, pin the ring to canvas center immediately.
  // When it turns off, hide the ring so it only reappears on cursor activity.
  useEffect(() => {
    if (centerRing) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      updatePosition(rect.left + rect.width / 2, rect.top + rect.height / 2, rect);
    } else {
      hide();
    }
  }, [centerRing, canvasRef, updatePosition, hide]);

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

  const updateFromHandTracking = useCallback((clientX: number, clientY: number) => {
    // The cursor-dot's "stays visible over the menu" exception only applies
    // to the brush menu drawer — when the full-screen overlay is open, the
    // dot must hide along with everything else.
    if (hidden) {
      if (dotRef.current) dotRef.current.style.opacity = '0';
      return;
    }
    const dot = dotRef.current;
    if (dot) {
      dot.style.left = clientX + 'px';
      dot.style.top = clientY + 'px';
      dot.style.opacity = '1';
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (centerRing) {
      updatePosition(clientX, clientY);
      return;
    }
    // Ring tracks the cursor only while it's over the canvas — same as a
    // normal mouse ring. Re-uses this rect inside updatePosition.
    const rect = canvas.getBoundingClientRect();
    const insideCanvas =
      clientX >= rect.left && clientX <= rect.right &&
      clientY >= rect.top && clientY <= rect.bottom;
    if (insideCanvas) {
      updatePosition(clientX, clientY, rect);
    } else if (visible.current) {
      hide();
    }
  }, [canvasRef, updatePosition, hide, hidden, centerRing]);

  const hideDot = useCallback(() => {
    if (dotRef.current) dotRef.current.style.opacity = '0';
  }, []);

  useImperativeHandle(ref, () => ({
    refresh,
    updateFromHandTracking,
    hideDot,
  }), [refresh, updateFromHandTracking, hideDot]);

  useEffect(() => { if (hidden) { hide(); hideDot(); } }, [hidden, hide, hideDot]);

  return (
    <>
      <div
        ref={ringRef}
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
      <div
        ref={dotRef}
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          background: 'rgba(0, 255, 128, 0.95)',
          boxShadow: '0 0 8px rgba(0, 255, 128, 0.8)',
          transform: 'translate(-50%, -50%)',
          zIndex: 10000,
          opacity: 0,
          transition: 'opacity 0.15s ease',
        }}
      />
    </>
  );
});

const SLIDE_DURATION_MS = 350;
const CANVAS_OVERLAY_SCALE = 0.8;
const SLIDE_EXIT_SCALE = 0.65;
const SLIDE_ENTER_SCALE = 0.55;


export function CanvasPage() {
  const [searchParams] = useSearchParams();
  const autostart = searchParams.has('autostart');
  const autoHandTracking = searchParams.has('handtracking');
  const autoFullscreen = searchParams.get('fullscreen') === 'true';
  const cameraRequested = searchParams.has('camera');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const menuDrawerRef = useRef<MenuDrawerHandle>(null);
  const brushOverlayRef = useRef<BrushOverlayHandle>(null);
  const engineRef = useRef<Engine | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const seed = useAtomValue(sketchSeedAtom);
  const pendingMintLoad = useAtomValue(pendingMintLoadAtom);
  const currentTab = useAtomValue(overlayTabAtom);
  const { isOverlayOpen, openOverlay, closeOverlay } = useOverlay();
  const isInitialRender = useRef(true);
  const needsInitialLoad = useRef(true);
  const [handTrackingEnabled, setHandTrackingEnabled] = useState(autoHandTracking);
  const [isFullscreen, setIsFullscreen] = useState(autoFullscreen);
  const [isPortrait, setIsPortrait] = useState(() =>
    window.matchMedia('(orientation: portrait)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(orientation: portrait)');
    const onChange = (e: MediaQueryListEvent) => setIsPortrait(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  // Rotate the canvas 90° CW when the viewport is portrait. Skip in fullscreen
  // mode (the stretch-to-viewport geometry doesn't mix cleanly with rotation).
  const rotateCanvas = isPortrait && !(isFullscreen && !isOverlayOpen);
  const { isSaving, saveNow } = useAutoDraft(engine, isFullscreen, rotateCanvas);
  // Tracks the previous pinch state so we can detect the down→up edges.
  const prevPinchRef = useRef(false);
  // Intent locked at pinch-start. Drives the rest of the pinch cycle:
  //   'draw'  → route pinch movements into engine as a stroke
  //   'click' → dispatched as a click on a UI element, ignored afterwards
  //   null    → not pinching
  const pinchIntentRef = useRef<'draw' | 'click' | null>(null);

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
  // Stable getter for the engine's current brush size — the hook captures
  // this value at the moment the grab gesture engages so vertical drag is
  // relative to wherever the brush already was.
  const getCurrentBrushSize = useCallback(
    () => engineRef.current?.getDrawingManager().getBrushSize() ?? 1,
    [],
  );
  const handTracking = useHandTracking(canvasRef, handTrackingEnabled, brushRange, getCurrentBrushSize, rotateCanvas);

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

  // Engine draws a circle of radius brushSize into the 1080x1920 backbuffer;
  // when CSS stretches the display non-uniformly (fullscreen), that circle
  // becomes an ellipse on screen. Feed displayScaleX / displayScaleY into
  // the drawing manager so it pre-distorts the stroke to cancel it out.
  useEffect(() => {
    if (!engine) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dm = engine.getDrawingManager();
    let lastRatio = Number.NaN;

    const update = () => {
      const sx = canvas.clientWidth / canvas.width;
      const sy = canvas.clientHeight / canvas.height;
      const ratio = sy > 0 ? sx / sy : 1;
      if (ratio === lastRatio) return;
      lastRatio = ratio;
      dm.setDisplayAspectCompensation(ratio);
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(canvas);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      dm.setDisplayAspectCompensation(1);
    };
  }, [engine, isFullscreen, isOverlayOpen]);

  // Camera feed → engine reset-color source (desktop browser + ?camera=1 only)
  useEffect(() => {
    if (!engine || !cameraRequested) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).Capacitor?.isNativePlatform?.()) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    if (!navigator.mediaDevices?.getUserMedia) return;

    let cancelled = false;
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    let stream: MediaStream | null = null;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.srcObject = stream;
        await new Promise<void>((resolve) => {
          if (video.readyState >= 1) return resolve();
          video.addEventListener('loadedmetadata', () => resolve(), { once: true });
        });
        if (cancelled) return;
        await video.play().catch(() => {});
        if (cancelled) return;
        engine.setCameraSource(video);
        engine.setCameraEnabled(true);
      } catch (err) {
        console.warn('Camera feed unavailable:', err);
      }
    })();

    return () => {
      cancelled = true;
      engine.setCameraEnabled(false);
      engine.setCameraSource(null);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    };
  }, [engine, cameraRequested]);

  // Toggle hand tracking with 'h' / fullscreen with 'j' (browser only)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).Capacitor?.isNativePlatform?.()) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'h') {
        setHandTrackingEnabled((prev) => !prev);
      } else if (e.key === 'j') {
        setIsFullscreen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Hand tracking → engine + virtual mouse clicks.
  //
  // On pinch-start, classify the element under the cursor once and lock the
  // intent for the rest of the pinch cycle:
  //   - Canvas → start a stroke; if the menu was open, the menu's own
  //     document-level click-outside handler fires from the dispatched
  //     pointerdown and closes it (matches real mouse behavior).
  //   - Any UI element (menu, menu button, action bar button) → dispatch
  //     pointerdown/up/click on the element and suppress drawing. The menu's
  //     existing handlers do the right thing (button action, close-on-empty).
  //
  // No isMenuOpen() guards — the target element is the only thing that
  // matters. Release + re-pinch to start a new interaction.
  useEffect(() => {
    if (!engine || !handTracking.isActive) {
      if (prevPinchRef.current && pinchIntentRef.current === 'draw') {
        engine?.handlePointerUp();
      }
      prevPinchRef.current = false;
      pinchIntentRef.current = null;
      return;
    }

    const { canvasPosition, clientPosition, isDrawing } = handTracking;
    const wasPinching = prevPinchRef.current;

    if (isDrawing && !wasPinching) {
      const { x, y } = clientPosition;
      const el = document.elementFromPoint(x, y);
      const canvas = canvasRef.current;
      const isCanvas = !!(canvas && el === canvas);

      if (isCanvas) {
        // Don't dispatch a synthetic pointerdown on the canvas to close the
        // menu — that would also hit React's onPointerDown, which calls
        // setPointerCapture on a fabricated pointerId (InvalidPointerId in
        // some browsers) AND double-invokes engine.handlePointerDown.
        if (isMenuOpen()) {
          menuDrawerRef.current?.close();
        }
        engine.handlePointerDown(canvasPosition.x, canvasPosition.y);
        pinchIntentRef.current = 'draw';
      } else if (el instanceof HTMLElement) {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y }));
        el.click();
        brushOverlayRef.current?.refresh();
        pinchIntentRef.current = 'click';
      } else {
        pinchIntentRef.current = null;
      }
    } else if (isDrawing && wasPinching) {
      // Clicks are one-shot — only 'draw' intent consumes per-frame moves.
      if (pinchIntentRef.current === 'draw') {
        engine.handlePointerMove(canvasPosition.x, canvasPosition.y);
      }
    } else if (!isDrawing && wasPinching) {
      if (pinchIntentRef.current === 'draw') {
        engine.handlePointerUp();
      }
      pinchIntentRef.current = null;
    }

    prevPinchRef.current = isDrawing;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, handTracking]);

  // When hand tracking drops out, clear the dot (the ring is handled inside
  // updateFromHandTracking via its hidden/leave logic).
  useEffect(() => {
    if (!handTracking.isActive) {
      brushOverlayRef.current?.hideDot();
      return;
    }
    brushOverlayRef.current?.updateFromHandTracking(
      handTracking.clientPosition.x,
      handTracking.clientPosition.y,
    );
  }, [handTracking.clientPosition.x, handTracking.clientPosition.y, handTracking.isActive]);

  // Brush size sync — engine is the single source of truth. When hand tracking
  // produces a new brush size (only during the two-hand adjust gesture), write
  // it to the engine, pull the menu's display state from the engine, and
  // refresh the brush overlay. handTracking.brushSize is null when the gate is
  // off, so this effect only fires during active adjustment and never stomps
  // on menu button / wheel / keyboard changes.
  useEffect(() => {
    if (!engine || handTracking.brushSize === null) return;
    engine.getDrawingManager().setBrushSize(handTracking.brushSize);
    menuDrawerRef.current?.syncBrushFromEngine();
    brushOverlayRef.current?.refresh();
  }, [engine, handTracking.brushSize]);

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const { x, y } = clientToCanvas(e.clientX, e.clientY, canvas, rotateCanvas);
    engine.handlePointerDown(x, y);
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas || !engine) return;
    const { x, y } = clientToCanvas(e.clientX, e.clientY, canvas, rotateCanvas);
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
    menuDrawerRef.current?.syncBrushFromEngine();
    brushOverlayRef.current?.refresh();
  }

  // Fullscreen mode stretches the canvas to the full viewport, ignoring aspect
  // ratio. Only active while the UI overlay is closed — when it reopens the
  // canvas reverts to normal aspect-preserving layout so chrome lays out over
  // a correctly-proportioned canvas.
  const stretchCanvas = isFullscreen && !isOverlayOpen;

  return (
    <div
      className={cn(
        'fixed flex items-center justify-center',
        stretchCanvas ? 'inset-0' : 'inset-x-0 top-0 bottom-[44px]',
      )}
    >
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
          'z-10 touch-none',
          stretchCanvas
            ? 'w-screen h-screen'
            : rotateCanvas
              ? ''
              : 'max-h-full max-w-full object-contain',
          // Normal overlay scale transition (only when not carousel-sliding)
          !slidePhase && 'transition-transform duration-500 ease-in-out',
          isOverlayOpen && 'canvas-overlay-glow',
          !engine && 'bg-[rgba(0,255,128,0.1)]',
        )}
        style={(() => {
          // Portrait viewport: apply a landscape layout box + 90° rotation.
          // Gets composed into every transform branch below.
          const rotateStyle = rotateCanvas
            ? {
                aspectRatio: '16 / 9',
                maxWidth: 'calc(100vh - 44px)',
                maxHeight: '100vw',
                width: 'calc(100vh - 44px)',
              }
            : null;
          const rot = rotateCanvas ? 'rotate(90deg) ' : '';

          if (slidePhase === 'loading') {
            return {
              ...rotateStyle,
              transform: `${rot}translateX(${slideDir === 1 ? '100%' : '-100%'}) scale(${SLIDE_ENTER_SCALE})`,
              opacity: 0,
            };
          }
          if (slidePhase === 'sliding') {
            return {
              ...rotateStyle,
              transition: `transform ${SLIDE_DURATION_MS}ms ease-in-out, opacity ${SLIDE_DURATION_MS}ms ease-in-out`,
              transform: `${rot}scale(${CANVAS_OVERLAY_SCALE})`,
              opacity: 1,
            };
          }
          // Overlay-open scale lives in .canvas-overlay-glow CSS; inline
          // transform would override it, so compose explicitly when rotated.
          if (rotateStyle) {
            return {
              ...rotateStyle,
              transform: `${rot}${(isOverlayOpen || !engine) ? `scale(${CANVAS_OVERLAY_SCALE})` : ''}`.trim(),
            };
          }
          if (!engine) {
            return { transform: `scale(${CANVAS_OVERLAY_SCALE})` };
          }
          return undefined;
        })()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
      <BrushOverlay
        ref={brushOverlayRef}
        engine={engine}
        canvasRef={canvasRef}
        hidden={isOverlayOpen}
        centerRing={handTracking.isAdjustingBrush}
        forceUniformScale={stretchCanvas}
        rotated={rotateCanvas}
      />
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
          isFullscreen={isFullscreen}
          rotated={rotateCanvas}
        />
      )}
    </div>
  );
}
