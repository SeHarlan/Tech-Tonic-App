import { useRef, useEffect } from 'react';
import { createEngine, type Engine } from '../../engine/renderer';

declare global {
  interface Window {
    __engine: Engine | null;
    __engineReady: boolean;
  }
}

export function GeneratePage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const params = new URLSearchParams(window.location.search);
    const seed = parseInt(params.get('seed') ?? '0', 10);

    const engine = createEngine({ canvas, seed });
    engine.start();

    window.__engine = engine;
    window.__engineReady = true;

    return () => {
      engine.stop();
      engine.destroy();
      window.__engine = null;
      window.__engineReady = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <canvas ref={canvasRef} className="max-h-full max-w-full object-contain" />
    </div>
  );
}
