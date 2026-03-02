import { useRef, useEffect, useState, useCallback } from 'react';
import { createEngine, type Engine } from './engine/renderer';

/** Convert pointer event CSS coords to canvas (WebGL) coords */
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

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [seed, setSeed] = useState(Math.floor(Math.random() * 1000));
  const [fps, setFps] = useState(0);

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

  const nextSeed = () => setSeed((s) => (s + 1) % 1000);
  const prevSeed = () => setSeed((s) => (s - 1 + 1000) % 1000);
  const randomSeed = () => setSeed(Math.floor(Math.random() * 1000));
  const toggleFreeze = () => {
    const e = engineRef.current;
    if (e) e.setGlobalFreeze(!e.isGlobalFrozen());
  };
  const reset = () => engineRef.current?.forceReset();

  return (
    <div className="fixed inset-0 bg-black flex flex-col items-center justify-center">
      <canvas
        ref={canvasRef}
        className="max-h-[calc(100vh-4rem)] max-w-full object-contain touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      <div className="flex gap-2 py-2">
        <button onClick={prevSeed} className="px-3 py-1 bg-white/10 text-white rounded text-sm">
          Prev
        </button>
        <span className="px-3 py-1 text-white text-sm font-mono">
          seed {seed} | {fps} fps
        </span>
        <button onClick={nextSeed} className="px-3 py-1 bg-white/10 text-white rounded text-sm">
          Next
        </button>
        <button onClick={randomSeed} className="px-3 py-1 bg-white/10 text-white rounded text-sm">
          Random
        </button>
        <button onClick={toggleFreeze} className="px-3 py-1 bg-white/10 text-white rounded text-sm">
          Freeze
        </button>
        <button onClick={reset} className="px-3 py-1 bg-white/10 text-white rounded text-sm">
          Reset
        </button>
      </div>
    </div>
  );
}

export default App;
