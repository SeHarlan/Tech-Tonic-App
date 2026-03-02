# Tech-Tonic Implementation Plan

> **Project**: GPU-intensive generative art app for Solana Seeker phone
> **Stack**: Vite + React + TypeScript + Tailwind + Capacitor + WebGL2
> **Hackathon**: 10-day timeline
> **Target**: Android APK for Solana Seeker (Dimensity 7300, Mali-G615 MC2)

---

## Table of Contents

1. [Phase 0: Project Scaffold](#phase-0-project-scaffold)
2. [Phase 1: Engine Extraction](#phase-1-engine-extraction)
3. [Phase 2: React App Shell](#phase-2-react-app-shell)
4. [Phase 3: Solana Integration](#phase-3-solana-integration)
5. [Phase 3: Mallow API + Discover Feed](#phase-4-mallow-api--discover-feed)
6. [Phase 5: Thumbnail & Video Generation Script](#phase-5-thumbnail--video-generation-script)
7. [Phase 6: Capacitor Mobile Build](#phase-6-capacitor-mobile-build)
8. [Phase 7: Standalone On-Chain Renderer](#phase-7-standalone-on-chain-renderer)
9. [Architecture Reference](#architecture-reference)

---

## Phase 0: Project Scaffold ✅

### 0.1 Create project

```bash
bun create vite@latest tech-tonic -- --template react-ts
cd tech-tonic
bun install
```

### 0.2 Add Tailwind CSS

```bash
bun add -D tailwindcss @tailwindcss/vite
```

In `vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
```

In `src/index.css` (replace contents):
```css
@import "tailwindcss";
```

### 0.3 Add Capacitor

```bash
bun add @capacitor/core @capacitor/cli
bunx cap init "Tech-Tonic" "com.techtonic.app" --web-dir dist
bun add @capacitor/android @capacitor/filesystem
bunx cap add android
```

### 0.4 Add React Router

```bash
bun add react-router-dom
```

### 0.5 Environment config (devnet/mainnet switch)

Create `src/config/env.ts`:
```ts
export type SolanaCluster = 'devnet' | 'mainnet-beta';

export const CLUSTER: SolanaCluster =
  (import.meta.env.VITE_SOLANA_CLUSTER as SolanaCluster) || 'devnet';

export const RPC_ENDPOINT =
  import.meta.env.VITE_RPC_ENDPOINT ||
  (CLUSTER === 'mainnet-beta'
    ? 'https://api.mainnet-beta.solana.com'
    : 'https://api.devnet.solana.com');

export const MALLOW_API_BASE = 'https://api.mallow.art';

// Gumball machine address - set after creation on mallow.art
export const GUMBALL_KEY = import.meta.env.VITE_GUMBALL_KEY || '';
```

Create `.env`:
```
VITE_SOLANA_CLUSTER=devnet
VITE_RPC_ENDPOINT=https://api.devnet.solana.com
VITE_GUMBALL_KEY=
```

Create `.env.production`:
```
VITE_SOLANA_CLUSTER=mainnet-beta
VITE_RPC_ENDPOINT=https://api.mainnet-beta.solana.com
VITE_GUMBALL_KEY=
```

### 0.6 Target directory structure

```
tech-tonic/
├── src/
│   ├── engine/                 ← WebGL engine (Phase 1)
│   │   ├── renderer.ts         ← Core WebGL lifecycle
│   │   ├── shaders.ts          ← Shader source strings
│   │   ├── drawing.ts          ← Drawing buffer / brush system
│   │   ├── parameters.ts       ← Seeded parameter randomization
│   │   ├── recording.ts        ← Screenshot / video capture
│   │   ├── state.ts            ← State serialization / loading (buffers, time, params)
│   │   └── types.ts            ← Shared types/interfaces
│   ├── standalone/             ← On-chain standalone renderer (Phase 7)
│   │   ├── standalone.html     ← Shell HTML (canvas + existing menu UI + style.css)
│   │   └── bootstrap.ts        ← State loading, URL parsing, event wiring
│   ├── components/             ← React components (Phase 2)
│   │   ├── ArtCanvas.tsx       ← Full-screen WebGL canvas
│   │   ├── PauseOverlay.tsx    ← Pause UI with action bar + discover
│   │   ├── DiscoverFeed.tsx    ← Horizontal swipe cards
│   │   ├── MintPage.tsx        ← Mint flow page
│   │   └── Menu.tsx            ← Drawing controls (drawer)
│   ├── solana/                 ← Blockchain integration (Phase 3)
│   │   ├── WalletProvider.tsx  ← Wallet adapter setup
│   │   ├── mallow.ts           ← Mallow API client
│   │   └── transactions.ts     ← Transaction builders
│   ├── config/
│   │   └── env.ts              ← Environment config
│   ├── App.tsx                 ← Router + layout
│   ├── main.tsx                ← Entry point
│   └── index.css               ← Tailwind imports
├── scripts/
│   ├── generate-assets.mjs     ← Thumbnail/video generator (Phase 5)
│   └── build-standalone.mjs    ← Bundles standalone HTML (Phase 7)
├── public/
│   └── (static assets)
├── android/                    ← Capacitor (generated)
├── .env                        ← devnet config
├── .env.production             ← mainnet config
├── capacitor.config.ts
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

---

## Phase 1: Engine Extraction

Convert the existing vanilla JS WebGL code into clean ES modules. The engine must remain **framework-agnostic** — no React imports, no DOM assumptions beyond a canvas element.

### 1.1 Create `src/engine/types.ts`

Define all shared types:

```ts
export interface EngineConfig {
  canvas: HTMLCanvasElement;
  seed?: number;
  initialState?: EngineState | null; // Load from saved state (NFT update)
  onFpsUpdate?: (fps: number) => void;
  onRecordingStop?: (blob: Blob, extension: string) => void;
}

// Serialized state for NFT updates and standalone renderer loading
export interface EngineState {
  seed: number;
  time: number;
  totalFrameCount: number; // deterministic frame counter
  params: ShaderParams;
  imageBuffer: Blob | HTMLImageElement;     // PNG — current framebuffer pixels (main simulation)
  movementBuffer: Blob | HTMLImageElement;  // PNG — persistent movement/freeze brush data
  paintBuffer: Blob | HTMLImageElement;     // PNG — persistent paint brush data (empty/static/gem)
}

export interface ShaderParams {
  seed: number;
  fxWithBlocking: boolean;
  blockingScale: number;
  shouldMoveThreshold: number;
  shouldFallThreshold: number;
  // ... all parameters from current main.js top-level vars
}

export type DrawMode =
  | 'waterfall' | 'move' | 'shuffle' | 'trickle'
  | 'erase' | 'freeze'
  | 'static' | 'gem' | 'empty'; // paint modes

export type Direction = 'up' | 'down' | 'left' | 'right';

export type EraseVariant = 'movement' | 'paint' | 'both';

// Waterfall variant: true = variable speed (waterfall), false = uniform speed (straight)
export type WaterfallVariant = boolean;
```

**CRITICAL: All three buffers are PNG (lossless).**
- **Image buffer**: Feeds back into shader every frame — JPEG artifacts compound through the feedback loop.
- **Movement buffer**: RGBA channels encode mode data with threshold-based decoding — lossy compression corrupts values.
- **Paint buffer**: R channel encodes paint variant (empty/static/gem) — same threshold issue.

### 1.2 Create `src/engine/shaders/` directory with `.glsl` files

Shader source lives in separate `.glsl` files, imported as strings at build time via `vite-plugin-glsl`. This gives us syntax highlighting, easier editing, and clean separation.

**Vite config** already includes `glsl()` plugin and `tsconfig.app.json` includes `vite-plugin-glsl/ext` for TypeScript support.

**Shader files** (5 programs, 10 files):
```
src/engine/shaders/
├── main.vert           ← from vertexShader.glsl (pass-through)
├── main.frag           ← from fragmentShader.glsl (main simulation)
├── draw.vert           ← from setupDrawingProgram() in main.js
├── draw.frag           ← from setupDrawingProgram() in main.js
├── display.vert        ← from setupDisplayProgram() in main.js
├── display.frag        ← from setupDisplayProgram() in main.js
├── blockNoise.vert     ← from setupBlockNoiseProgram() in main.js
├── blockNoise.frag     ← from setupBlockNoiseProgram() in main.js
├── noiseVolume.vert    ← from setupNoiseVolumeProgram() in main.js
└── noiseVolume.frag    ← from setupNoiseVolumeProgram() in main.js
```

**Re-export barrel** `src/engine/shaders.ts`:
```ts
import mainVert from './shaders/main.vert';
import mainFrag from './shaders/main.frag';
import drawVert from './shaders/draw.vert';
import drawFrag from './shaders/draw.frag';
import displayVert from './shaders/display.vert';
import displayFrag from './shaders/display.frag';
import blockNoiseVert from './shaders/blockNoise.vert';
import blockNoiseFrag from './shaders/blockNoise.frag';
import noiseVolumeVert from './shaders/noiseVolume.vert';
import noiseVolumeFrag from './shaders/noiseVolume.frag';

export {
  mainVert, mainFrag,
  drawVert, drawFrag,
  displayVert, displayFrag,
  blockNoiseVert, blockNoiseFrag,
  noiseVolumeVert, noiseVolumeFrag,
};
```

**Note for Phase 7 (standalone renderer)**: The build script will read these `.glsl` files and inline them into the standalone HTML.

### 1.3 Create `src/engine/parameters.ts`

Extract from `main.js`:
- `createSeededRNG()`
- `weightedRandom()`
- `randomizeShaderParameters()`
- `normalizeSeed()`
- All default parameter values
- `getShapeScale()`, `getFallShapeScale()`, `getMoveShapeScale()`

Export as:
```ts
export function createSeededRNG(seed: number): () => number;
export function randomizeShaderParameters(seed: number): ShaderParams;
export const DEFAULT_PARAMS: ShaderParams;
export const SEED_MODULUS: number;
```

### 1.4 Create `src/engine/drawing.ts`

Extract the drawing buffer system. The architecture uses **two separate single textures** (no ping-pong) with brush-sized quads and `discard`:
- **Movement buffer** (persistent): R=horizontal (shuffle/move), G=vertical (trickle/straight/waterfall, 5-way split), B=freeze
- **Paint buffer** (persistent): R=variant (empty/static/gem). Cleared only by erase or global clear.

Drawing uses `gl.colorMask()` for per-channel isolation. Movement strokes also clear paint in the same area.

```ts
export function createDrawingManager(
  gl: WebGL2RenderingContext,
  width: number,
  height: number
): DrawingManager;

export interface DrawingManager {
  drawAt(x: number, y: number, mode: DrawMode, direction: Direction, opts: DrawOpts): void;
  drawLine(x1: number, y1: number, x2: number, y2: number, mode: DrawMode, direction: Direction, opts: DrawOpts): void;
  clearAll(): void;
  getMovementTexture(): WebGLTexture;
  getPaintTexture(): WebGLTexture;
  setBrushSize(size: number): void;
  getBrushSize(): number;
  generateBrushSizeOptions(canvasWidth: number, canvasHeight: number, blocking: boolean, blockingScale: number): number[];
  destroy(): void;
}

interface DrawOpts {
  waterfallVariant?: boolean;  // true=waterfall (variable speed), false=straight
  eraseVariant?: EraseVariant; // 'movement' | 'paint' | 'both'
  blocking?: boolean;
  blockingScale?: number;
}
```

**Key implementation details from current code:**
- `getMovementColor()`: Encodes mode into RGB channels with threshold-centered float values (e.g., shuffle=0.375, move left=0.875)
- `getPaintColor()`: R channel only — empty=0.5, static=0.75, gem=1.0
- `drawAt()` routes to correct FBO, applies colorMask, and movement strokes additionally clear paint
- Erase uses `vec4(0.0)` with colorMask targeting the appropriate buffer(s)
- All draw textures use `gl.NEAREST` filtering (critical for threshold-based mode decoding)

### 1.5 Create `src/engine/recording.ts`

Extract:
- `saveScreenshot()` → `captureScreenshot(gl, canvas, textures, currentFbIndex)`
- `startVideoRecording()` / `stopVideoRecording()` → class or factory
- All recording constants (`RECORD_DURATION_FRAMES`, `RECORD_BITRATE`, etc.)

```ts
export function captureScreenshot(gl: WebGLRenderingContext, canvas: HTMLCanvasElement, ...): void;
export function createVideoRecorder(canvas: HTMLCanvasElement, config: RecordConfig): VideoRecorder;
```

### 1.6 Create `src/engine/state.ts` — State Serialization

Handles capturing and restoring the full engine state for NFT updates and standalone renderer loading. All three buffers are **always PNG** (lossless).

```ts
export interface SerializedState {
  seed: number;
  time: number;
  totalFrameCount: number;
  params: ShaderParams;
  imageBuffer: Blob;     // PNG — main simulation framebuffer
  movementBuffer: Blob;  // PNG — persistent movement/freeze brush data
  paintBuffer: Blob;     // PNG — persistent paint brush data
}

// Capture current engine state as serializable blobs
// Serializes one buffer at a time to minimize memory pressure (~8MB per buffer)
export async function serializeState(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  framebufferTexture: WebGLTexture,  // textures[currentFbIndex]
  movementTexture: WebGLTexture,
  paintTexture: WebGLTexture,
  time: number,
  totalFrameCount: number,
  seed: number,
  params: ShaderParams
): Promise<SerializedState> {
  // Sequential — not parallel — to avoid holding 3x 8MB buffers simultaneously
  const imageBuffer = await readTextureToPNG(gl, canvas, framebufferTexture);
  const movementBuffer = await readTextureToPNG(gl, canvas, movementTexture);
  const paintBuffer = await readTextureToPNG(gl, canvas, paintTexture);

  return { seed, time, totalFrameCount, params, imageBuffer, movementBuffer, paintBuffer };
}

// Read a WebGL texture into a lossless PNG Blob
async function readTextureToPNG(
  gl: WebGL2RenderingContext,
  canvas: HTMLCanvasElement,
  texture: WebGLTexture
): Promise<Blob> {
  const width = canvas.width;
  const height = canvas.height;
  const pixels = new Uint8Array(width * height * 4);

  // Bind texture to temporary framebuffer and read pixels
  const tempFb = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, tempFb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(tempFb);

  // Flip vertically (WebGL bottom-left origin) and encode as PNG
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const ctx = tempCanvas.getContext('2d')!;
  const imageData = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const src = y * width * 4;
    const dst = (height - 1 - y) * width * 4;
    imageData.data.set(pixels.subarray(src, src + width * 4), dst);
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve) =>
    tempCanvas.toBlob((blob) => resolve(blob!), 'image/png')
  );
}

// Load state into engine — called at startup from saved NFT or standalone URL
export async function loadStateIntoTextures(
  gl: WebGL2RenderingContext,
  state: {
    imageBufferSrc: string | HTMLImageElement;
    movementBufferSrc: string | HTMLImageElement;
    paintBufferSrc: string | HTMLImageElement;
  },
  targets: {
    framebufferTextures: [WebGLTexture, WebGLTexture]; // both ping-pong textures
    movementTexture: WebGLTexture;
    paintTexture: WebGLTexture;
  }
): Promise<void> {
  const loadImage = (src: string | HTMLImageElement): Promise<HTMLImageElement> => {
    if (src instanceof HTMLImageElement) return Promise.resolve(src);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  const [imageImg, movementImg, paintImg] = await Promise.all([
    loadImage(state.imageBufferSrc),
    loadImage(state.movementBufferSrc),
    loadImage(state.paintBufferSrc),
  ]);

  // Load image into BOTH ping-pong framebuffer textures
  // This ensures the first render reads valid data regardless of which
  // texture is currently the "read" buffer
  for (const tex of targets.framebufferTextures) {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageImg);
  }

  // Movement and paint are single textures (no ping-pong)
  gl.bindTexture(gl.TEXTURE_2D, targets.movementTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, movementImg);

  gl.bindTexture(gl.TEXTURE_2D, targets.paintTexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paintImg);

  gl.bindTexture(gl.TEXTURE_2D, null);
}
```

**Why PNG for all three buffers**:
- **Image buffer**: Feeds back into shader every frame via ping-pong. JPEG artifacts compound through the feedback loop — each NFT update would degrade the art further.
- **Movement buffer**: RGBA channels encode mode data (R=move type with 3-way threshold, G=fall type with 5-way threshold, B=freeze). Lossy compression would corrupt the threshold values the shader reads to determine per-pixel behavior.
- **Paint buffer**: R channel encodes variant via thresholds (empty/static/gem). Same issue.

**⚠️ Performance**: `readPixels` on 1080×1920 textures will stall the GPU pipeline (~50-200ms per buffer on Mali-G615). PNG encoding via `canvas.toBlob()` blocks the main thread for another 200-500ms per buffer. Total serialization time: ~750ms-2s for 3 buffers. **The UI must show a loading spinner during serialization and upload.** The engine should be paused (frozen) before serializing to avoid reading a mid-frame buffer.

**⚠️ Ping-pong loading**: The image buffer must be loaded into **both** ping-pong FBO textures (`textures[0]` and `textures[1]`). The ping-pong alternates which texture is the read source each frame. If only one is loaded, the other contains uninitialized data and will produce a blank/garbage frame every other cycle. Movement and paint textures are single (no ping-pong) so they just need one load each.

### 1.7 Create `src/engine/renderer.ts` — Main Engine

This is the core orchestrator. It owns the render loop, WebGL context, framebuffers, and uniform management.

```ts
export function createEngine(config: EngineConfig): Engine;

export interface Engine {
  // Lifecycle
  start(): void;
  stop(): void;
  destroy(): void;

  // State
  setSeed(seed: number): void;
  getSeed(): number;
  setGlobalFreeze(frozen: boolean): void;
  setManualMode(manual: boolean): void;
  forceReset(): void;

  // State serialization (for NFT updates + standalone loading)
  serializeState(): Promise<EngineState>;
  loadState(state: EngineState): Promise<void>;

  // Drawing
  getDrawingManager(): DrawingManager;

  // Canvas interaction (for React component to call)
  handlePointerDown(canvasX: number, canvasY: number): void;
  handlePointerMove(canvasX: number, canvasY: number): void;
  handlePointerUp(): void;

  // Current state getters
  getParams(): ShaderParams;
  getTime(): number;
  isRunning(): boolean;

  // Recording
  captureScreenshot(): void;
  captureScreenshotBase64(): Promise<string>; // For asset generation script
  startRecording(): void;
  stopRecording(): void;
  isRecording(): boolean;

  // Canvas sizing
  getCanvasDisplayRect(): { left: number; top: number; width: number; height: number };
}
```

**Migration approach for `renderer.ts`**:

1. Move all WebGL setup code from `window.onload` into `createEngine()`
2. Move `animate()` and `render()` into engine's private scope
3. Replace all global variable access with engine instance state
4. Keep `resizeCanvas()` logic but expose via engine API
5. Remove all DOM event listeners — React handles events and calls engine methods

**Critical constants to preserve** (from main.js):
```
CANVAS_SCALE = 1.2
FIXED_CANVAS_WIDTH = 900 * CANVAS_SCALE  (1080)
FIXED_CANVAS_HEIGHT = 1600 * CANVAS_SCALE (1920)
FIXED_PIXEL_RATIO_UNIFORM = 1.0
DEFAULT_TARGET_FPS = 60
```

### 1.8 Verification step

After extraction, the engine should work with a minimal test:
```tsx
// Quick test — not the final component
const canvas = document.createElement('canvas');
document.body.appendChild(canvas);
const engine = createEngine({ canvas });
engine.start();
// Should see the art rendering
```

---

## Phase 2: React App Shell

### 2.1 App.tsx — Router setup

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ArtCanvas } from './components/ArtCanvas';
import { MintPage } from './components/MintPage';
import { WalletProvider } from './solana/WalletProvider';

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ArtCanvas />} />
          <Route path="/mint" element={<MintPage />} />
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  );
}
```

### 2.2 ArtCanvas.tsx — Core art experience

This component:
1. Mounts a `<canvas>` element
2. Creates the engine on mount, destroys on unmount
3. Forwards touch/mouse events to engine
4. Manages pause state
5. Renders the Menu drawer and PauseOverlay as siblings

```tsx
import { useRef, useEffect, useState, useCallback } from 'react';
import { createEngine, Engine } from '../engine/renderer';

export function ArtCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [paused, setPaused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = createEngine({
      canvas: canvasRef.current,
      onFpsUpdate: (fps) => { /* update state if showing FPS */ },
    });
    engineRef.current = engine;
    engine.start();
    return () => engine.destroy();
  }, []);

  const togglePause = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !paused;
    engine.setGlobalFreeze(next);
    setPaused(next);
  }, [paused]);

  // Touch/mouse forwarding
  const handlePointerDown = (e: React.PointerEvent) => {
    if (paused || menuOpen) return;
    const coords = getCanvasCoords(e, canvasRef.current!);
    engineRef.current?.handlePointerDown(coords.x, coords.y);
  };
  // ... handlePointerMove, handlePointerUp similarly

  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center">
      <canvas
        ref={canvasRef}
        id="glCanvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="max-w-full max-h-full"
        style={{ aspectRatio: '9/16', imageRendering: 'pixelated' }}
      />

      {/* Minimal HUD when not paused */}
      {!paused && (
        <div className="absolute top-4 right-4 flex gap-2">
          <button onClick={togglePause} className="...">⏸</button>
        </div>
      )}

      {/* Pause overlay */}
      {paused && (
        <PauseOverlay
          onResume={togglePause}
          engine={engineRef.current}
        />
      )}

      {/* Drawing controls drawer (existing menu, converted to React) */}
      {!paused && (
        <Menu
          engine={engineRef.current}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        />
      )}
    </div>
  );
}
```

### 2.3 PauseOverlay.tsx — Navigation gateway

When paused, the art freezes and a dimmed overlay appears with:
- Action bar: Wallet, Save, Record, Update NFT
- Discover feed: horizontal swipe cards
- Mint button
- Tap on art background = resume

```tsx
export function PauseOverlay({ onResume, engine }: PauseOverlayProps) {
  return (
    <div
      className="absolute inset-0 bg-black/50 flex flex-col justify-end"
      onClick={onResume} // Tap background = resume
    >
      <div onClick={(e) => e.stopPropagation()} className="...">
        {/* Action bar */}
        <div className="flex justify-center gap-4 py-3">
          <ActionButton icon="🔗" label="Wallet" onClick={...} />
          <ActionButton icon="💾" label="Save" onClick={() => engine?.captureScreenshot()} />
          <ActionButton icon="📹" label="Record" onClick={...} />
        </div>

        {/* Discover feed */}
        <DiscoverFeed />

        {/* Mint button */}
        <Link to="/mint" className="...">
          ✨ Mint New Iteration
        </Link>
      </div>
    </div>
  );
}
```

**Loading states**: Save, Record, and Update NFT operations should show a simple loading spinner overlay while in progress. State serialization (500ms-1.5s) and Arweave upload will block — keep the engine frozen and show feedback. On success/failure, show a brief toast message (e.g., "Saved!" or "Upload failed — try again").

### 2.4 Menu.tsx — Drawing controls

Convert the existing HTML drawer menu to a React component. Preserve the pip-boy terminal aesthetic (green on black). Use Tailwind for layout, keep the custom CSS animations for the active button glow/scanline effects in a small CSS file or Tailwind `@layer`.

The menu receives the engine ref and calls engine methods:
```tsx
<button onClick={() => engine?.getDrawingManager().setMode('waterfall', 'down')}>↓</button>
```

### 2.5 MintPage.tsx — Separate route

```tsx
export function MintPage() {
  // Show preview of random iteration
  // Price/supply info from Mallow API
  // Connect wallet button (if not connected)
  // Mint button → calls gumball draw transaction
  // Success → confetti → navigate back to / with new NFT seed
  return (
    <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
      {/* Mint UI */}
    </div>
  );
}
```

---

## Phase 3: Solana Integration

### 3.1 Install dependencies

```bash
bun add \
  @solana/web3.js \
  @solana/wallet-adapter-base \
  @solana/wallet-adapter-react \
  @solana/wallet-adapter-react-ui \
  @solana-mobile/wallet-adapter-mobile
```

### 3.2 WalletProvider.tsx

```tsx
import { ConnectionProvider, WalletProvider as SolanaWalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { SolanaMobileWalletAdapter } from '@solana-mobile/wallet-adapter-mobile';
import { RPC_ENDPOINT, CLUSTER } from '../config/env';

// Import default styles for wallet modal
import '@solana/wallet-adapter-react-ui/styles.css';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const wallets = [
    new SolanaMobileWalletAdapter({
      appIdentity: { name: 'Tech-Tonic' },
      cluster: CLUSTER,
      authorizationResultCache: /* AsyncStorage adapter for Capacitor */,
    }),
  ];

  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
}
```

**Note on Mobile Wallet Adapter**: On Seeker, this routes to the Seed Vault wallet. The adapter handles the full MWA protocol — app builds transaction, adapter sends to wallet, user confirms with biometric, signed transaction returned.

### 3.3 Transaction builders (`src/solana/transactions.ts`)

```ts
import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import { MALLOW_API_BASE, GUMBALL_KEY } from '../config/env';

// Fetch gumball draw transaction from Mallow API
export async function getDrawGumballTransaction(
  buyerAddress: string
): Promise<Transaction> {
  const response = await fetch(
    `${MALLOW_API_BASE}/v1/getDrawGumballTxs/${GUMBALL_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ buyer: buyerAddress }),
    }
  );
  if (!response.ok) {
    throw new Error(`Gumball API error: ${response.status}`);
  }
  const data = await response.json();
  // Deserialize and return transaction for signing
  const tx = Transaction.from(Buffer.from(data.transaction, 'base64'));
  return tx;
}
```

**Error handling pattern**: All Solana and Mallow API calls should use try/catch at the component level, with user-facing toast/banner messages for failures (e.g., "Mint failed — check your wallet balance"). Keep error handling simple — catch, log, show message, allow retry.

---

## Phase 3: Mallow API + Discover Feed

### 4.1 Mallow API client (`src/solana/mallow.ts`)

```ts
import { MALLOW_API_BASE } from '../config/env';

export interface MallowArtwork {
  mint: string;
  name: string;
  image: string; // thumbnail URL
  seller?: string;
  price?: number;
  // metadata with seed/params for loading into renderer
  metadata?: {
    seed: number;
    params: Record<string, any>;
  };
}

export async function fetchArtworksByCreator(
  creatorAddress: string,
  limit = 20,
  offset = 0
): Promise<MallowArtwork[]> {
  try {
    const res = await fetch(`${MALLOW_API_BASE}/artworks/byCreator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ creator: creatorAddress, limit, offset }),
    });
    if (!res.ok) throw new Error(`Mallow API ${res.status}`);
    return res.json();
  } catch (e) {
    console.error('Failed to fetch artworks:', e);
    return []; // Graceful fallback — empty feed
  }
}

export async function fetchArtwork(mintAccount: string): Promise<MallowArtwork> {
  const res = await fetch(`${MALLOW_API_BASE}/artworks/${mintAccount}`);
  return res.json();
}

export async function fetchListedBySeller(
  sellerAddress: string
): Promise<MallowArtwork[]> {
  const res = await fetch(`${MALLOW_API_BASE}/artworks/listedBySeller`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seller: sellerAddress }),
  });
  return res.json();
}
```

### 4.2 DiscoverFeed.tsx

Horizontal scroll container with artwork cards. Three filter tabs: **Owned**, **Recent**, **Hot**.

```tsx
export function DiscoverFeed() {
  const [filter, setFilter] = useState<'owned' | 'recent' | 'hot'>('recent');
  const [artworks, setArtworks] = useState<MallowArtwork[]>([]);

  // Fetch based on filter
  useEffect(() => {
    // fetch artworks from Mallow API based on filter
  }, [filter]);

  return (
    <div>
      {/* Filter tabs */}
      <div className="flex gap-2 px-4 pb-2">
        {['owned', 'recent', 'hot'].map(f => (
          <button key={f} onClick={() => setFilter(f)} className={...}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Horizontal scroll */}
      <div className="flex gap-3 overflow-x-auto px-4 pb-4 snap-x snap-mandatory">
        {artworks.map(art => (
          <ArtworkCard
            key={art.mint}
            artwork={art}
            onSelect={() => {
              // Load this artwork's seed/params into the renderer
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

Each card shows: static thumbnail, name, price (if listed). Tap → loads seed/params into the engine and resumes art.

---

## Phase 5: Thumbnail & Video Generation Script

### 5.1 Overview

Headless script that generates 999 iterations of thumbnails + optional videos + JSON metadata for gumball machine setup on Mallow.

**Requirements**:
- Loop seeds 0–998
- For each seed: initialize engine, wait 20 seconds for art to evolve, capture thumbnail (PNG) and optionally record video (MP4)
- Output: `output/thumbnails/{seed}.png`, `output/videos/{seed}.mp4`, `output/metadata/{seed}.json`
- JSON metadata contains seed + all randomized parameters for that seed

### 5.2 Script: `scripts/generate-assets.mjs`

Uses Puppeteer to run the app headlessly with each seed:

```js
import puppeteer from 'puppeteer';
import fs from 'fs/promises';
import path from 'path';

const TOTAL_ITERATIONS = 999;
const SETTLE_TIME_MS = 20_000; // 20 seconds for art to evolve
const VIDEO_DURATION_MS = 6_667; // ~400 frames at 60fps (one hue cycle)
const OUTPUT_DIR = 'output';
const CAPTURE_THUMBNAIL = true;
const CAPTURE_VIDEO = false; // Set true when needed

// Ensure output directories exist
await fs.mkdir(`${OUTPUT_DIR}/thumbnails`, { recursive: true });
await fs.mkdir(`${OUTPUT_DIR}/metadata`, { recursive: true });
if (CAPTURE_VIDEO) {
  await fs.mkdir(`${OUTPUT_DIR}/videos`, { recursive: true });
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--enable-webgl',
    '--use-gl=swiftshader', // Software WebGL for headless
    '--no-sandbox',
  ],
});

for (let seed = 0; seed < TOTAL_ITERATIONS; seed++) {
  console.log(`[${seed + 1}/${TOTAL_ITERATIONS}] Generating seed ${seed}...`);
  const page = await browser.newPage();

  // Set viewport to match canvas dimensions
  await page.setViewport({ width: 1080, height: 1920 });

  // Navigate to local dev server with seed parameter
  await page.goto(`http://localhost:5173?seed=${seed}`, {
    waitUntil: 'networkidle0',
  });

  // Wait for engine to initialize
  await page.waitForFunction(() => window.__engineReady === true, {
    timeout: 10_000,
  });

  // Wait for art to evolve
  console.log(`  Settling for ${SETTLE_TIME_MS / 1000}s...`);
  await page.waitForTimeout(SETTLE_TIME_MS);

  // Capture thumbnail
  if (CAPTURE_THUMBNAIL) {
    // Trigger screenshot via engine API exposed on window
    const pngBase64 = await page.evaluate(() => {
      return window.__engine.captureScreenshotBase64();
    });
    const pngBuffer = Buffer.from(pngBase64, 'base64');
    await fs.writeFile(`${OUTPUT_DIR}/thumbnails/${seed}.png`, pngBuffer);
    console.log(`  Thumbnail saved`);
  }

  // Capture video (optional)
  if (CAPTURE_VIDEO) {
    // Start recording via engine
    await page.evaluate(() => window.__engine.startRecording());
    await page.waitForTimeout(VIDEO_DURATION_MS);
    // Get recorded blob
    const videoBase64 = await page.evaluate(() => {
      return new Promise((resolve) => {
        window.__engine.stopRecording((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result.split(',')[1]);
          reader.readAsDataURL(blob);
        });
      });
    });
    const videoBuffer = Buffer.from(videoBase64, 'base64');
    await fs.writeFile(`${OUTPUT_DIR}/videos/${seed}.mp4`, videoBuffer);
    console.log(`  Video saved`);
  }

  // Export metadata (seed + all params)
  const metadata = await page.evaluate(() => {
    const engine = window.__engine;
    return {
      seed: engine.getSeed(),
      params: engine.getParams(),
    };
  });
  await fs.writeFile(
    `${OUTPUT_DIR}/metadata/${seed}.json`,
    JSON.stringify(metadata, null, 2)
  );

  await page.close();
  console.log(`  Done`);
}

await browser.close();
console.log(`\nGeneration complete: ${TOTAL_ITERATIONS} iterations`);
```

### 5.3 Engine hooks for script

The engine needs to expose itself on `window` when running in asset generation mode. The exact detection mechanism (URL param, environment variable, or explicit flag) needs separate careful consideration to avoid accidentally exposing `__engine` in production builds.

**Basic requirements**:
- Engine instance accessible from Puppeteer via `window.__engine`
- Ready signal (`window.__engineReady = true`) for the script to wait on
- `captureScreenshotBase64()` method that returns a base64 PNG string
- Seed set from URL or script command

**⚠️ TODO**: The generation script needs its own dedicated design pass — detection mechanism, security (don't leak engine to production), batch error recovery, parallel vs. sequential page processing, and SwiftShader compatibility testing. For now, the script in 6.2 is a starting template, not final.

### 5.4 Running the script

```bash
# Terminal 1: Start dev server
bun run dev

# Terminal 2: Run generator
bun add -D puppeteer
bun scripts/generate-assets.mjs
```

### 5.5 Gumball metadata format

Each `{seed}.json` should match the format Mallow expects for gumball items. The exact format depends on Mallow's gumball setup — typically NFT metadata with:

```json
{
  "name": "Tech-Tonic #42",
  "symbol": "TTONIC",
  "description": "Generative art iteration #42",
  "image": "https://arweave.net/{thumbnail-hash}",
  "animation_url": "https://arweave.net/{standalone-renderer-hash}?seed=42",
  "attributes": [
    { "trait_type": "Seed", "value": 42 },
    { "trait_type": "Blocking", "value": "true" },
    { "trait_type": "Blocking Scale", "value": 32 }
  ],
  "properties": {
    "files": [
      { "uri": "https://arweave.net/{thumbnail-hash}", "type": "image/png" },
      { "uri": "https://arweave.net/{video-hash}", "type": "video/mp4" }
    ],
    "creators": [{ "address": "YOUR_WALLET", "share": 100 }],
    "category": "image"
  },
  "tech_tonic": {
    "seed": 42,
    "version": 0,
    "params": { /* full ShaderParams object */ }
  }
}
```

**Initial mint** (version 0): Only `seed` and `params` are needed. The standalone renderer initializes from seed — no saved buffers yet.

**After NFT update** (version 1+): Metadata gains state snapshot fields:

```json
{
  "tech_tonic": {
    "seed": 42,
    "version": 3,
    "time": 847.3,
    "totalFrameCount": 50838,
    "params": { /* ShaderParams, possibly with runtime modifications */ },
    "imageBuffer": "https://arweave.net/{image-buffer-png-hash}",
    "movementBuffer": "https://arweave.net/{movement-buffer-png-hash}",
    "paintBuffer": "https://arweave.net/{paint-buffer-png-hash}"
  }
}
```

The standalone renderer checks for buffer URLs:
- **Present**: Loads all three PNGs as initial textures, sets time/frameCount, resumes from saved state
- **Absent**: Falls back to seed-only initialization (original mint state)

The `tech_tonic.params` field is what the app reads to recreate the artwork. All buffer files are **always PNG** (lossless) — see Phase 1.6 for rationale.

**Update authority**: The creator retains Metaplex update authority. Owner delegation for simple updates (state snapshots) may be added later. For V1, NFT state updates go through the creator's authority.

**Arweave upload costs**: The user covers upload costs for their NFT updates (3 PNGs + metadata JSON, typically 3-6MB total per update). Use Irys (formerly Bundlr) as the Arweave bundler — standard for Solana NFTs, supports paying in SOL. Implementation details deferred to Phase 3.

**Standalone renderer reference**: In addition to `animation_url` (which may point to the standalone with state params), store a direct reference to the standalone renderer's Arweave hash in `attributes`:
```json
{
  "attributes": [
    { "trait_type": "Seed", "value": 42 },
    { "trait_type": "Renderer", "value": "ar://{standalone-hash}" },
    { "trait_type": "Blocking", "value": "true" },
    { "trait_type": "Blocking Scale", "value": 32 }
  ]
}
```
This ensures the renderer hash is always discoverable from on-chain data, even if `animation_url` changes format.

---

## Phase 6: Capacitor Mobile Build

### 6.1 capacitor.config.ts

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.techtonic.app',
  appName: 'Tech-Tonic',
  webDir: 'dist',
  android: {
    // Allow WebGL2 in WebView
    webContentsDebuggingEnabled: true, // Remove for production
  },
  server: {
    // For dev: use live reload
    // url: 'http://YOUR_IP:5173',
    // cleartext: true,
  },
};

export default config;
```

### 6.2 Build and run

```bash
# Build the web app
bun run build

# Sync to Android project
bunx cap sync android

# Open in Android Studio
bunx cap open android

# Or run directly (if device/emulator connected)
bunx cap run android
```

### 6.3 Android WebView settings

In `android/app/src/main/java/.../MainActivity.java`, the WebView needs:
- Hardware acceleration enabled (default in Capacitor)
- WebGL enabled (default in modern Android WebView / Chrome)
- No specific changes needed — Capacitor's default WebView config supports WebGL2 on Android 15

### 6.4 Deep link / intent filter

For Solana Mobile Wallet Adapter to work, the app needs to handle the MWA callback. Capacitor handles this via its App plugin or custom URL scheme. The `@solana-mobile/wallet-adapter-mobile` package manages the protocol.

### 6.5 Dev workflow

For daily development:
```bash
# Browser (fastest iteration)
bun run dev
# Open http://localhost:5173 in browser

# iOS test (iPhone proxy for Android WebView)
bun run build && bunx cap sync ios && bunx cap run ios

# Android emulator (for wallet testing)
bun run build && bunx cap sync android && bunx cap run android
```

---

## Phase 7: Standalone On-Chain Renderer

A single HTML file uploaded to Arweave that contains the **full interactive art instrument** — rendering, drawing tools, brush controls, keyboard shortcuts, all in the existing pip-boy UI. No wallet, no marketplace, no React. Anyone can recreate and interact with any Tech-Tonic NFT using only decentralized storage.

### 7.1 What goes in vs. stays out

**In the standalone HTML (on-chain)**:
- WebGL2 context setup, framebuffer ping-pong
- Fragment + vertex shaders (main + draw)
- Parameter system (`createSeededRNG`, `randomizeShaderParameters`)
- DrawingManager (brush modes, draw texture ping-pong, `drawAt`/`drawLine`)
- State loading (fetch PNG buffers from Arweave, initialize textures)
- Full menu UI — **existing HTML + CSS from current `index.html` + `style.css`**
- All keyboard shortcuts (current key bindings)
- Touch + mouse event handling
- Screenshot + video recording
- Canvas sizing (fixed 1080×1920, CSS display scaling)

**NOT in the standalone (app-only)**:
- React, Tailwind, react-router
- Wallet adapter / MWA / Solana web3.js
- Mallow API client
- Discover feed, mint page, pause overlay
- State *upload* to Arweave (serialization is in, uploading is out)
- Capacitor native shell

### 7.2 Standalone UI — single source, compiled from app codebase

The standalone uses the **exact same HTML structure and CSS** from the current codebase (`index.html` + `style.css`). The pip-boy terminal aesthetic, drawer menu, brush overlay, recording indicator — all preserved verbatim.

The build script (Phase 7.4) compiles the standalone from the same source files used by the React app. There is **one canonical UI implementation** — the standalone's HTML/CSS is extracted and inlined during the build, not maintained as a separate copy. When controls change in the app, the standalone build picks them up automatically.

No redesign for the standalone. If anyone forks the code, they can change the CSS.

### 7.3 State loading from URL

The standalone reads configuration from URL parameters:

```
ar://{standalone-hash}?seed=42
ar://{standalone-hash}?seed=42&state=ar://{metadata-hash}
```

Bootstrap logic in `src/standalone/bootstrap.ts`:

```ts
interface StandaloneConfig {
  seed: number;
  time?: number;
  totalFrameCount?: number;
  params?: ShaderParams;
  imageBufferUrl?: string;    // Arweave URL to PNG
  movementBufferUrl?: string; // Arweave URL to PNG
  paintBufferUrl?: string;    // Arweave URL to PNG
}

async function loadConfig(): Promise<StandaloneConfig> {
  const url = new URLSearchParams(window.location.search);
  const seed = parseInt(url.get('seed') || '0');

  // If state URL provided, fetch metadata JSON for saved buffers
  const stateUrl = url.get('state');
  if (stateUrl) {
    const res = await fetch(stateUrl);
    const metadata = await res.json();
    const tt = metadata.tech_tonic;
    return {
      seed: tt.seed,
      time: tt.time,
      totalFrameCount: tt.totalFrameCount,
      params: tt.params,
      imageBufferUrl: tt.imageBuffer,
      movementBufferUrl: tt.movementBuffer,
      paintBufferUrl: tt.paintBuffer,
    };
  }

  // Seed-only mode: initialize from scratch
  return { seed };
}

async function init() {
  const config = await loadConfig();
  const canvas = document.getElementById('glCanvas') as HTMLCanvasElement;

  const engine = createEngine({ canvas, seed: config.seed });

  // If saved state exists, load all three buffer textures before starting
  if (config.imageBufferUrl && config.movementBufferUrl && config.paintBufferUrl) {
    await engine.loadState({
      seed: config.seed,
      time: config.time || 0,
      totalFrameCount: config.totalFrameCount || 0,
      params: config.params || engine.getParams(),
      imageBuffer: config.imageBufferUrl,
      movementBuffer: config.movementBufferUrl,
      paintBuffer: config.paintBufferUrl,
    });
  }

  engine.start();

  // Wire up existing menu UI (same event handling as current main.js)
  setupKeyboardListeners(engine);
  setupMouseListeners(engine, canvas);
  setupRadialMenu(engine);
  setupBrushOverlay(engine, canvas);
}

init();
```

### 7.4 Build script — `scripts/build-standalone.mjs`

Bundles all engine modules + standalone bootstrap + HTML/CSS into a single self-contained file:

```js
import { build } from 'vite';
import { readFileSync, writeFileSync } from 'fs';

// 1. Build engine + bootstrap as single IIFE bundle
await build({
  build: {
    lib: {
      entry: 'src/standalone/bootstrap.ts',
      formats: ['iife'],
      name: 'TechTonic',
      fileName: 'standalone-bundle',
    },
    outDir: 'dist/standalone-build',
    emptyOutDir: true,
  },
});

// 2. Assemble final HTML
const js = readFileSync('dist/standalone-build/standalone-bundle.iife.js', 'utf-8');
const html = readFileSync('src/standalone/standalone.html', 'utf-8');
const css = readFileSync('src/standalone/standalone.css', 'utf-8');

const final = html
  .replace('/* __INLINE_CSS__ */', css)
  .replace('/* __INLINE_JS__ */', js);

writeFileSync('dist/standalone.html', final);
console.log(`Built: dist/standalone.html (${Math.round(Buffer.byteLength(final) / 1024)} KB)`);
```

### 7.5 `src/standalone/standalone.html` — shell

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tech-Tonic</title>
    <style>/* __INLINE_CSS__ */</style>
</head>
<body>
    <!-- Identical DOM structure from current index.html -->
    <div id="container">
        <canvas id="glCanvas"></canvas>
        <div id="brush-overlay"></div>
        <div id="gif-recording-indicator" class="hidden">...</div>
        <div id="fps-warning-indicator" class="hidden">...</div>
        <div id="loading-overlay"><div class="loading-text">Loading...</div></div>
        <div id="error-overlay" class="hidden">...</div>
        <div id="menu-container" class="menu-closed">
            <!-- Full drawer menu — verbatim from current index.html -->
        </div>
    </div>
    <script>/* __INLINE_JS__ */</script>
</body>
</html>
```

`src/standalone/standalone.css` is a copy of the current `style.css`.

### 7.6 Arweave deployment

1. `bun scripts/build-standalone.mjs` → `dist/standalone.html`
2. Upload to Arweave **once** → permanent URL `ar://{hash}`
3. This single hash serves ALL 999 iterations forever
4. Initial mint `animation_url` = `ar://{hash}?seed={N}`
5. After NFT update: `animation_url` = `ar://{hash}?seed={N}&state=ar://{state-hash}`

The renderer file never changes. State is always loaded from separate Arweave uploads pointed to by the NFT metadata.

### 7.7 Expected bundle size

| Component | Estimated |
|-----------|-----------|
| Shaders (GLSL strings) | ~11 KB |
| Parameter system | ~5 KB |
| WebGL setup + render loop | ~10 KB |
| DrawingManager | ~8 KB |
| State loading | ~3 KB |
| Recording | ~4 KB |
| Event handling + menu wiring | ~13 KB |
| HTML + CSS | ~10 KB |
| **Total (unminified)** | **~64 KB** |
| **Total (minified)** | **~25-35 KB** |

---

## Architecture Reference

### Data flow

```
URL seed param or random → randomizeShaderParameters(seed) → ShaderParams
                                                                  ↓
Touch events → React ArtCanvas → Engine.handlePointer*() → DrawingManager → draw texture
                                                                  ↓
Engine render loop:
  1. Read previous frame texture (ping-pong)
  2. Read draw texture (user brush strokes)
  3. Apply fragment shader (movement, fall, reset, color cycle)
  4. Write to next frame texture
  5. Display to canvas
  6. Swap buffers
```

### NFT lifecycle

```
1. Artist creates 999 seeds → generates thumbnails + metadata
2. Upload to Arweave/IPFS
3. Create gumball machine on mallow.art with 999 items
4. User opens app → taps "Mint" → gumball draw → receives random iteration NFT
5. NFT metadata contains seed + params
6. App reads NFT metadata → loads seed → recreates artwork in real-time
7. User interacts (draws, moves, pauses)
8. User can "Update" → captures current state → uploads to Arweave → updates NFT URI
```

### Key technical decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Framework | React + Vite | Wallet adapter compatibility, minimal hackathon risk |
| Styling | Tailwind CSS | Rapid UI development, small bundle |
| Mobile wrapper | Capacitor | WebGL code runs as-is, thin native shell |
| WebGL version | WebGL2 | 3D textures for noise baking, zero compat risk on Seeker |
| Shader language | GLSL ES 3.0 | Required for WebGL2, mechanical upgrade |
| Blockchain | Solana (devnet → mainnet) | Seeker native, env var switch |
| Wallet | Mobile Wallet Adapter | Routes to Seed Vault on Seeker |
| Marketplace | Mallow API | Gumball minting, artwork discovery |
| Canvas resolution | Fixed 1080×1920 | Deterministic output, display scales via CSS |
| State management | React hooks + engine ref | Simple, no Redux needed for V1 |
| Buffer format | PNG (lossless) for all 3 buffers | Feedback loop + mode encoding require exact values |
| NFT update authority | Creator retains, owner delegation TBD | Simplest for V1, revisit for V2 |
| Arweave uploads | User-paid via Irys (Bundlr), 3 PNGs + JSON | Standard Solana NFT tooling, SOL payment |
| Noise implementation | GPU-baked 3D texture (128³×64 R8) | Single path everywhere — no procedural fallback in main shader |
| Drawing buffers | 2 separate textures (movement + paint) | Both persistent, no ping-pong, brush-sized quads with discard |

### ⚠️ Determinism principle

**The same seed + state must produce identical visual output in every context**: app, standalone renderer, and thumbnail generation. This means:
- No runtime fallbacks between different noise implementations
- No platform-dependent rendering paths
- Fixed canvas resolution everywhere (1080×1920)
- Shader code is byte-identical between app build and standalone build (both compile from the same source files)
- The noise volume MUST be generated from the same GPU shader with the same seed — trilinear interpolation results depend on the exact texel values

### Resolved from code review

These items were previously deferred pending WebGL2 code review. All resolved:
- ✅ **Draw texture filtering**: Both movement and paint textures use `gl.NEAREST` (confirmed in `createFBOTexture` and `setupFramebuffers`)
- ✅ **Ping-pong double-load**: State restoration must load image into both `textures[0]` and `textures[1]` — movement and paint are single textures
- ✅ **`preserveDrawingBuffer`**: Still present. `saveScreenshot()` reads screen first with FBO fallback. Video recording via `captureStream()` likely still needs it. Test removal later.
- ✅ **`WebGL2RenderingContext`**: All code uses `webgl2` context. Type consistency will be enforced during TypeScript extraction (Phase 1)

### Performance targets

- **60fps** on Mali-G615 MC2 (with noise baking optimization)
- **<100ms** startup to first frame
- **<200KB** JS bundle (engine) — majority of weight is shader strings
- **~42KB** React + react-dom (acceptable in cached APK)

---

## CLAUDE.md (for new repo)

Place this in the root of the new `tech-tonic` repo:

```markdown
# Tech-Tonic

GPU-intensive generative art application for Solana Seeker.

## Stack
- **Engine**: WebGL2 + GLSL ES 3.0 (vanilla TypeScript, framework-agnostic)
- **UI**: React + TypeScript + Tailwind CSS
- **Build**: Vite
- **Mobile**: Capacitor (Android)
- **Blockchain**: Solana (devnet/mainnet via VITE_SOLANA_CLUSTER env var)
- **Marketplace**: Mallow API

## Architecture
- `src/engine/` — WebGL rendering engine. No React imports. Communicates via typed interface.
- `src/standalone/` — On-chain standalone renderer (single HTML, compiled from engine source)
- `src/components/` — React UI components (art canvas, pause overlay, menu, mint page)
- `src/solana/` — Wallet adapter, Mallow API client, transaction builders
- `src/config/` — Environment configuration
- `scripts/` — Asset generation tools, standalone build script

## Rendering Pipeline (per frame)
1. Block noise pass — wrapping/black/ribbon noise at block resolution
2. Main compute pass — reads prev frame + movement + paint + block noise + noise volume → writes next frame
3. Display blit — copies result to screen
4. (Drawing happens between frames, targeting movement or paint FBO)

## GPU Resources
- 5 shader programs: main simulation, draw brush, display blit, block noise, noise volume
- 2 ping-pong framebuffers (main simulation)
- Movement texture (persistent, NEAREST filtering)
- Paint texture (persistent, NEAREST filtering)
- Block noise texture (re-rendered each frame at block resolution)
- 3D noise volume (128×128×64 R8, LINEAR filtering, REPEAT wrap, baked per-seed)

## Key Constants
- Canvas: 1080×1920 fixed resolution (CANVAS_SCALE=1.2 × 900×1600)
- Target: 60fps
- Seed modulus: 1000 (seeds 0-999)
- Pixel ratio uniform: always 1.0 (fixed resolution)
- Noise volume: 128×128×64 (NOISE_VOL_XY=128, NOISE_VOL_Z=64)

## Drawing Buffer Encoding
Movement buffer (persistent):
- R: off / shuffle / move left / move right (3-way threshold at 0.25, 0.5, 0.75)
- G: off / trickle / straight down / waterfall down / straight up / waterfall up (5-way threshold)
- B: off / freeze

Paint buffer (persistent):
- R: off / empty / static / gem (threshold at 0.625, 0.875)

Both cleared only by erase brush or global clear. Movement strokes also clear paint.

## Determinism Rule
Same seed + state = identical output everywhere (app, standalone, thumbnails).
- No runtime fallbacks between rendering paths
- Noise volume generated from same GPU shader per seed
- Frame-based time: `time = totalFrameCount / targetFps`

## Development
\`\`\`bash
bun run dev          # Browser dev server (Vite HMR)
bun run build        # Production build
bunx cap sync android # Sync to Android
bunx cap run android  # Run on device/emulator
bun scripts/build-standalone.mjs  # Build on-chain renderer
\`\`\`

## Environment
- `.env` — devnet config
- `.env.production` — mainnet config
- Switch clusters: change `VITE_SOLANA_CLUSTER` env var
```
```
