# Hand Tracking Input — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional webcam-based hand tracking as a browser-only input source, using MediaPipe Hands to control drawing position, draw state, and brush size.

**Architecture:** A `useHandTracking` React hook runs MediaPipe HandLandmarker in a hidden video element, translates right-hand landmarks into engine coordinates, and feeds them through the existing `handlePointerDown/Move/Up` + `setBrushSize` engine methods. Zero engine changes. The hook is inert when disabled — no webcam, no model download, no compute.

**Tech Stack:** `@mediapipe/tasks-vision` (HandLandmarker), React 19 hooks, `requestAnimationFrame` loop

**Spec:** `docs/superpowers/specs/2026-03-29-hand-tracking-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Modify | Add `@mediapipe/tasks-vision` dependency |
| `src/hooks/useHandTracking.ts` | Create | MediaPipe lifecycle, gesture detection, coordinate mapping |
| `src/pages/canvas/CanvasPage.tsx` | Modify | Import hook, add toggle state, wire engine input + brush overlay |

---

### Task 1: Install MediaPipe Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

```bash
bun add @mediapipe/tasks-vision
```

- [ ] **Step 2: Verify installation**

```bash
bun run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "add @mediapipe/tasks-vision dependency for hand tracking"
```

---

### Task 2: Create `useHandTracking` Hook

**Files:**
- Create: `src/hooks/useHandTracking.ts`

- [ ] **Step 1: Create the complete hook file**

Create `src/hooks/useHandTracking.ts` with the full implementation:

```ts
import { useRef, useState, useEffect, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

// --- Types ---

export interface HandTrackingState {
  /** MediaPipe loaded and detecting a hand */
  isActive: boolean;
  /** Screen coordinates for BrushOverlay positioning */
  clientPosition: { x: number; y: number };
  /** Engine coordinates (1080x1920, Y-flipped) for handlePointerDown/Move/Up */
  canvasPosition: { x: number; y: number };
  /** true when hand is fully open (all fingers extended) */
  isDrawing: boolean;
  /** Brush size derived from thumb-index pinch distance, mapped to brushRange */
  brushSize: number;
}

const DEFAULT_STATE: HandTrackingState = {
  isActive: false,
  clientPosition: { x: 0, y: 0 },
  canvasPosition: { x: 0, y: 0 },
  isDrawing: false,
  brushSize: 16,
};

// MediaPipe model hosted on Google's CDN — downloaded at runtime only when enabled
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

// Landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_PIP = 18;
const PINKY_TIP = 20;

// Hysteresis: frames a gesture must hold before toggling draw state
const DRAW_HYSTERESIS_FRAMES = 3;

// Exponential moving average factor for brush size smoothing (0-1, lower = smoother)
const BRUSH_SMOOTH_FACTOR = 0.3;

// Pinch distance range (normalized to hand scale) mapped to brush size
const PINCH_MIN = 0.15; // thumb-index touching
const PINCH_MAX = 0.9;  // thumb-index fully spread

// --- Gesture Helpers ---

interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
}

function isFingerExtended(
  tip: NormalizedLandmark,
  pip: NormalizedLandmark,
): boolean {
  // In MediaPipe's coordinate system, y increases downward.
  // A finger is extended when its tip is above (lower y) the PIP joint.
  return tip.y < pip.y;
}

function isThumbExtended(
  thumbTip: NormalizedLandmark,
  indexMcp: NormalizedLandmark,
  wrist: NormalizedLandmark,
): boolean {
  // Thumb extends laterally — check if thumb tip is farther from wrist
  // than the index MCP along the x-axis
  const thumbDist = Math.abs(thumbTip.x - wrist.x);
  const indexDist = Math.abs(indexMcp.x - wrist.x);
  return thumbDist > indexDist;
}

function isHandOpen(landmarks: NormalizedLandmark[]): boolean {
  return (
    isThumbExtended(landmarks[THUMB_TIP], landmarks[INDEX_MCP], landmarks[WRIST]) &&
    isFingerExtended(landmarks[INDEX_TIP], landmarks[INDEX_PIP]) &&
    isFingerExtended(landmarks[MIDDLE_TIP], landmarks[MIDDLE_PIP]) &&
    isFingerExtended(landmarks[RING_TIP], landmarks[RING_PIP]) &&
    isFingerExtended(landmarks[PINKY_TIP], landmarks[PINKY_PIP])
  );
}

function euclideanDist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function getPinchRatio(landmarks: NormalizedLandmark[]): number {
  const pinchDist = euclideanDist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);
  const handScale = euclideanDist(landmarks[WRIST], landmarks[MIDDLE_MCP]);
  if (handScale < 0.001) return 0;
  return pinchDist / handScale;
}

function mapPinchToBrushSize(
  ratio: number,
  minBrush: number,
  maxBrush: number,
): number {
  const t = Math.max(0, Math.min(1, (ratio - PINCH_MIN) / (PINCH_MAX - PINCH_MIN)));
  return minBrush + t * (maxBrush - minBrush);
}

// --- Hook ---

export function useHandTracking(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  brushRange: { min: number; max: number },
): HandTrackingState {
  const [state, setState] = useState<HandTrackingState>(DEFAULT_STATE);

  // Refs for mutable state that shouldn't trigger re-renders
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Hysteresis counter for draw state
  const drawCounterRef = useRef(0);
  const lastDrawStateRef = useRef(false);

  // Smoothed brush size
  const smoothBrushRef = useRef(16);

  // Keep brush range in a ref so the rAF loop always reads the latest value
  // without needing to restart the effect
  const brushRangeRef = useRef(brushRange);
  brushRangeRef.current = brushRange;

  const cleanup = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    if (handLandmarkerRef.current) {
      handLandmarkerRef.current.close();
      handLandmarkerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.remove();
      videoRef.current = null;
    }
    drawCounterRef.current = 0;
    lastDrawStateRef.current = false;
    setState(DEFAULT_STATE);
  }, []);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    let cancelled = false;

    async function init() {
      // Create hidden video element
      const video = document.createElement('video');
      video.setAttribute('playsinline', '');
      video.setAttribute('autoplay', '');
      video.style.position = 'fixed';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      video.style.width = '1px';
      video.style.height = '1px';
      document.body.appendChild(video);
      videoRef.current = video;

      // Request webcam
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        });
      } catch {
        console.warn('[HandTracking] Camera access denied or unavailable');
        cleanup();
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      // Load MediaPipe
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      if (cancelled) return;

      const handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        numHands: 1,
        runningMode: 'VIDEO',
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      if (cancelled) {
        handLandmarker.close();
        return;
      }
      handLandmarkerRef.current = handLandmarker;

      // Start detection loop
      function detect() {
        if (cancelled) return;
        rafIdRef.current = requestAnimationFrame(detect);

        const canvas = canvasRef.current;
        if (!canvas || !videoRef.current || !handLandmarkerRef.current) return;
        if (videoRef.current.readyState < 2) return; // not enough data

        const result = handLandmarkerRef.current.detectForVideo(
          videoRef.current,
          performance.now(),
        );

        // Find the right hand
        let rightHandIndex = -1;
        if (result.handedness) {
          for (let i = 0; i < result.handedness.length; i++) {
            const cats = result.handedness[i];
            if (cats && cats.length > 0 && cats[0].categoryName === 'Right') {
              rightHandIndex = i;
              break;
            }
          }
        }

        if (rightHandIndex === -1 || !result.landmarks[rightHandIndex]) {
          // No right hand detected
          if (lastDrawStateRef.current) {
            drawCounterRef.current = 0;
            lastDrawStateRef.current = false;
            setState((prev) => ({ ...prev, isActive: false, isDrawing: false }));
          } else {
            setState((prev) =>
              prev.isActive ? { ...prev, isActive: false } : prev,
            );
          }
          return;
        }

        const landmarks = result.landmarks[rightHandIndex];
        const rect = canvas.getBoundingClientRect();

        // Position: palm center (landmark 9), mirrored X
        const palm = landmarks[MIDDLE_MCP];
        const clientX = rect.left + (1 - palm.x) * rect.width;
        const clientY = rect.top + palm.y * rect.height;

        // Engine coords (1080x1920, Y-flipped from DOM)
        const canvasX = (1 - palm.x) * canvas.width;
        const canvasY = (1 - palm.y) * canvas.height;

        // Draw state with hysteresis
        const rawOpen = isHandOpen(landmarks);
        if (rawOpen !== lastDrawStateRef.current) {
          drawCounterRef.current++;
          if (drawCounterRef.current >= DRAW_HYSTERESIS_FRAMES) {
            lastDrawStateRef.current = rawOpen;
            drawCounterRef.current = 0;
          }
        } else {
          drawCounterRef.current = 0;
        }

        // Brush size from pinch, mapped to engine's brush range
        const pinchRatio = getPinchRatio(landmarks);
        const { min, max } = brushRangeRef.current;
        const rawBrush = mapPinchToBrushSize(pinchRatio, min, max);
        smoothBrushRef.current =
          smoothBrushRef.current * (1 - BRUSH_SMOOTH_FACTOR) +
          rawBrush * BRUSH_SMOOTH_FACTOR;

        setState({
          isActive: true,
          clientPosition: { x: clientX, y: clientY },
          canvasPosition: { x: canvasX, y: canvasY },
          isDrawing: lastDrawStateRef.current,
          brushSize: Math.round(smoothBrushRef.current),
        });
      }

      detect();
    }

    init();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled, canvasRef, cleanup]);

  return state;
}
```

- [ ] **Step 2: Verify the hook compiles**

```bash
bun run build
```

Expected: Build succeeds with no errors. The hook is imported nowhere yet, but it should compile cleanly.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useHandTracking.ts
git commit -m "add useHandTracking hook with MediaPipe HandLandmarker"
```

---

### Task 3: Integrate into CanvasPage and BrushOverlay

**Files:**
- Modify: `src/pages/canvas/CanvasPage.tsx`

This task modifies both the `BrushOverlay` component (defined at the top of `CanvasPage.tsx`) and the `CanvasPage` component.

- [ ] **Step 1: Update BrushOverlay to accept hand tracking positions**

In `CanvasPage.tsx`, change the `BrushOverlayHandle` interface (line 15-17) from:

```ts
interface BrushOverlayHandle {
  refresh(): void;
}
```

To:

```ts
interface BrushOverlayHandle {
  refresh(): void;
  updateFromHandTracking(clientX: number, clientY: number): void;
}
```

Update the `useImperativeHandle` call (line 133) from:

```ts
useImperativeHandle(ref, () => ({ refresh }), [refresh]);
```

To:

```ts
useImperativeHandle(ref, () => ({
  refresh,
  updateFromHandTracking(clientX: number, clientY: number) {
    updatePosition(clientX, clientY);
  },
}), [refresh, updatePosition]);
```

- [ ] **Step 2: Add hand tracking state and hook to CanvasPage**

Add the import at the top of the file, with the other hook imports:

```ts
import { useHandTracking } from '../../hooks/useHandTracking';
```

Inside the `CanvasPage` component, add state and refs after the existing declarations (after the `needsInitialLoad` ref, around line 183). Add these lines:

```ts
const [handTrackingEnabled, setHandTrackingEnabled] = useState(false);
const prevHandDrawing = useRef(false);
```

Then, after the `computeCanvasBottom` callback (around line 203), add the hook call. The brush range is derived from the engine's drawing manager, which may not exist yet on first render:

```ts
// Hand tracking (browser only)
const brushOpts = engine?.getDrawingManager().getBrushSizeOptions() ?? [];
const brushRange = {
  min: brushOpts[0] ?? 1,
  max: brushOpts[brushOpts.length - 1] ?? 64,
};
const handTracking = useHandTracking(canvasRef, handTrackingEnabled, brushRange);
```

- [ ] **Step 3: Add keyboard toggle and engine/overlay wiring effects**

Add three `useEffect` blocks after the `handleOverlayClose` callback (around line 274), before the `onPointerDown` function:

```ts
// Toggle hand tracking with 'h' key (browser only)
useEffect(() => {
  if (typeof window !== 'undefined' && 'Capacitor' in window) return;
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      setHandTrackingEnabled((prev) => !prev);
    }
  }
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, []);

// Drive engine from hand tracking
useEffect(() => {
  if (!engine || !handTracking.isActive) {
    // If hand tracking was drawing and goes inactive, release
    if (prevHandDrawing.current) {
      engine?.handlePointerUp();
      prevHandDrawing.current = false;
    }
    return;
  }

  const { canvasPosition, isDrawing, brushSize } = handTracking;

  // Update brush size
  engine.getDrawingManager().setBrushSize(brushSize);

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
```

- [ ] **Step 4: Verify the build compiles**

```bash
bun run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Manual test**

```bash
bun run client
```

1. Open the app in a browser
2. Press `h` to enable hand tracking — browser should prompt for camera access
3. Hold up your right hand, open palm — brush overlay should appear and follow your hand
4. Open hand fully — should start drawing
5. Close hand — should stop drawing
6. Pinch thumb and index together/apart — brush size should change
7. Press `h` again — hand tracking disables, mouse/touch input works normally
8. Verify the overlay (gallery view) still works, freeze/unfreeze works, seed changes work

- [ ] **Step 6: Commit**

```bash
git add src/pages/canvas/CanvasPage.tsx
git commit -m "integrate hand tracking into CanvasPage with brush overlay and engine wiring"
```

---

## Verification Checklist

After all tasks are complete, verify:

- [ ] Hand tracking activates only when toggled on (press `h`)
- [ ] Camera permission is requested only when hand tracking is enabled
- [ ] Open right hand = drawing, closed = not drawing
- [ ] Thumb-index pinch distance controls brush size continuously (including mid-stroke)
- [ ] Brush overlay follows hand position
- [ ] Mouse/touch input still works when hand tracking is on
- [ ] Mouse/touch input works normally when hand tracking is off
- [ ] Toggling hand tracking off stops the webcam (camera light turns off)
- [ ] Overlay/gallery view works normally with hand tracking on or off
- [ ] `bun run build` succeeds with no errors or warnings
- [ ] On Capacitor (Android), the `h` key listener is skipped and hand tracking cannot be enabled
