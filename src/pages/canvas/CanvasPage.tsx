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
  const engineRef = useRef<Engine | null>(null);
  const menuDrawerRef = useRef<MenuDrawerHandle>(null);
  const [seed, setSeed] = useState(Math.floor(Math.random() * 1000));
  const [fps, setFps] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);

  const [canvasBottom, setCanvasBottom] = useState(0);

  const openOverlay = useCallback(() => {
    menuDrawerRef.current?.close();
    if (canvasRef.current) {
      const h = canvasRef.current.offsetHeight;
      setCanvasBottom(window.innerHeight / 2 + (h * 0.8) / 2);
    }
    setShowOverlay(true);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = createEngine({
      canvas,
      seed,
      onFpsUpdate: setFps,
    });
    engineRef.current = engine;
    engine.start();

    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [seed]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !engineRef.current) return;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    const { x, y } = toCanvasCoords(e, canvas);
    engineRef.current.handlePointerDown(x, y);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !engineRef.current) return;
    const { x, y } = toCanvasCoords(e, canvas);
    engineRef.current.handlePointerMove(x, y);
  }, []);

  const onPointerUp = useCallback(() => {
    engineRef.current?.handlePointerUp();
  }, []);

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
      <MenuDrawer ref={menuDrawerRef} engine={engineRef.current} onAppMenu={openOverlay} />

      {showOverlay && (
        <CanvasOverlay canvasBottom={canvasBottom} onClose={() => setShowOverlay(false)} />
      )}
    </div>
  );
}
