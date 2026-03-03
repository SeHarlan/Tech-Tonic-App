import { useRef, useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { createEngine, type Engine } from '../engine/renderer';
import { MenuDrawer } from './MenuDrawer';
import { MenuButton } from './MenuButton';

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

export function ArtCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [seed, setSeed] = useState(Math.floor(Math.random() * 1000));
  const [fps, setFps] = useState(0);
  const [showOverlay, setShowOverlay] = useState(false);
  const navigate = useNavigate();

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
        className="max-h-full max-w-full object-contain touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <MenuDrawer engine={engineRef.current} onAppMenu={() => setShowOverlay(true)} />

      {showOverlay && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center"
          style={{ background: 'rgba(0, 0, 0, 0.8)' }}
          onClick={() => setShowOverlay(false)}
        >
          <div
            className="flex flex-col gap-1"
            style={{ background: 'rgba(0, 0, 0, 0.95)', border: '1px solid rgba(0, 255, 128, 0.5)', padding: '12px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <MenuButton active onClick={() => navigate('/mint')}>Mint</MenuButton>
            <MenuButton onClick={() => setShowOverlay(false)}>Close</MenuButton>
          </div>
        </div>
      )}
    </div>
  );
}
