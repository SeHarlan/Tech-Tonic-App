import { useRef, useEffect, useState, useCallback } from 'react';
import { createEngine, type Engine } from '../../engine/renderer';
import { cn } from '../../utils/ui-helpers';
import { MenuDrawer, type MenuDrawerHandle } from './MenuDrawer';
import { CanvasOverlay } from './CanvasOverlay';
import './canvas-overlay.css';

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
  const [seed] = useState(() => Math.floor(Math.random() * 1000));
  const [engine, setEngine] = useState<Engine | null>(null);
  // const [fps, setFps] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);

  const [canvasBottom, setCanvasBottom] = useState(0);

  const toggleOverlay = useCallback(() => {
    setShowOverlay(prev => {
      if (prev) return false;
      menuDrawerRef.current?.close();
      if (canvasRef.current) {
        const h = canvasRef.current.offsetHeight;
        setCanvasBottom(window.innerHeight / 2 + (h * 0.8) / 2);
      }
      return true;
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const eng = createEngine({
      canvas,
      seed,
      // onFpsUpdate: setFps,
    });
    setEngine(eng);
    eng.start();

    return () => {
      eng.destroy();
      setEngine(null);
    };
  }, [seed]);

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
      <canvas
        ref={canvasRef}
        className={cn('max-h-full max-w-full object-contain touch-none transition-transform duration-500 ease-in-out', showOverlay && 'canvas-overlay-glow')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <MenuDrawer ref={menuDrawerRef} engine={engine} onAppMenu={toggleOverlay} hidden={showOverlay} />

      {showOverlay && (
        <CanvasOverlay canvasBottom={canvasBottom} onClose={() => setShowOverlay(false)} />
      )}
    </div>
  );
}
