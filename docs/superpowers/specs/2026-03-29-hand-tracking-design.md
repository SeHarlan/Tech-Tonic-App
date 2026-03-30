# Hand Tracking Input — Design Spec

**Date:** 2026-03-29
**Status:** Draft
**Dependency:** `@mediapipe/tasks-vision`

## Overview

Add webcam-based hand tracking as an optional input source for the browser version of TechTonic. The right hand controls drawing (position, draw state, brush size) via MediaPipe Hands landmark detection. The feature is fully modular — zero engine changes, zero impact on mobile builds.

## Architecture

**Approach:** React hook (`useHandTracking`) that runs MediaPipe in a hidden video element, translates hand landmarks into the same coordinates the engine already consumes, and feeds them through the existing `handlePointerDown/Move/Up` and `setBrushSize` engine methods.

**Boundary:** Hand tracking lives entirely in the React layer (`src/hooks/`, `src/pages/canvas/`). The engine (`src/engine/`) is not modified. MediaPipe model files are loaded from CDN at runtime only when the feature is activated.

## Hook: `useHandTracking`

**File:** `src/hooks/useHandTracking.ts`

### Interface

```ts
interface HandTrackingState {
  isActive: boolean;          // MediaPipe loaded and detecting a hand
  clientPosition: { x: number; y: number };  // screen coords (for BrushOverlay)
  canvasPosition: { x: number; y: number };  // engine coords (for engine input)
  isDrawing: boolean;         // true when hand is fully open
  brushSize: number;          // derived from thumb-index pinch distance
}

function useHandTracking(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
): HandTrackingState;
```

### Behavior When Disabled

When `enabled` is `false`, the hook:
- Does not request webcam access
- Does not instantiate MediaPipe
- Does not start any rAF loop
- Does not download any model files
- Returns static default values (no allocations per frame)

This means mobile builds pay zero compute cost — the hook exists in the bundle but does nothing.

### Behavior When Enabled

1. Creates a hidden `<video>` element
2. Requests `getUserMedia({ video: true })`
3. Instantiates `HandLandmarker` from `@mediapipe/tasks-vision` (downloads WASM + model from CDN on first activation)
4. Starts a `requestAnimationFrame` loop running detection at video frame rate (~30fps)
5. Processes right-hand landmarks into output state
6. Updates React state at detection rate

### Cleanup

On unmount or when `enabled` flips to `false`:
- Stops the rAF loop
- Closes the MediaPipe `HandLandmarker`
- Stops all video tracks (`stream.getTracks().forEach(t => t.stop())`)
- Removes the hidden video element

## Gesture Detection

### Position Mapping

- **Source landmark:** #9 (middle finger MCP / palm center)
- **MediaPipe output:** Normalized coordinates (0-1 range, relative to video frame)
- **X-axis mirroring:** `x = 1 - landmark.x` (webcam is horizontally flipped)
- **Client coords:** Normalized coords scaled to the canvas element's bounding rect on screen
- **Engine coords:** Client coords converted using the same math as the existing `toCanvasCoords` function (accounts for canvas internal resolution 1080x1920 and Y-axis flip)

### Draw State (Open Hand Detection)

A hand is considered "open" (drawing) when all five digits are extended:
- **Fingers (index, middle, ring, pinky):** Fingertip landmark Y is above (less than) the PIP joint landmark Y
- **Thumb:** Thumb tip landmark (#4) X distance from palm exceeds threshold (accounts for thumb's lateral extension)

**Hysteresis:** Draw state must remain consistent for 3 consecutive frames before toggling. This prevents flickering at gesture boundaries.

- Open hand sustained 3 frames: `isDrawing` flips to `true`
- Non-open hand sustained 3 frames: `isDrawing` flips to `false`

### Brush Size (Thumb-Index Pinch Distance)

- **Raw distance:** Euclidean distance between landmark #4 (thumb tip) and landmark #8 (index fingertip)
- **Normalization:** Divided by hand scale (distance from landmark #0 wrist to landmark #9 palm center) so brush size is independent of camera distance
- **Mapping:** Normalized ratio mapped to engine brush size options `[1, 2, 4, 8, 12, 16, 24, 32, 48, 64]` — pinched = small, spread = large
- **Smoothing:** Exponential moving average over ~3-4 frames to prevent jitter
- **Timing:** Updates every frame regardless of draw state (brush size can change mid-stroke)

## CanvasPage Integration

### State

- New `handTrackingEnabled` state, default `false`
- Toggle via keyboard shortcut (specific key TBD — low priority, can be any unused key)

### Engine Input

A `useEffect` watches the hook's output and drives the engine:

| Hook transition | Engine call |
|----------------|-------------|
| `isDrawing`: `false` -> `true` | `engine.handlePointerDown(canvasPos.x, canvasPos.y)` |
| `isDrawing`: `true`, position changes | `engine.handlePointerMove(canvasPos.x, canvasPos.y)` |
| `isDrawing`: `true` -> `false` | `engine.handlePointerUp()` |
| `brushSize` changes | `engine.getDrawingManager().setBrushSize(brushSize)` |

### Coexistence with Pointer Input

Both hand tracking and pointer input (mouse/touch/stylus) feed the same engine methods. No priority system — last input wins. This is intentional: you can use your mouse while hand tracking is active.

## BrushOverlay Integration

### New Ref Method

Add `updateFromHandTracking(clientX: number, clientY: number)` to the `BrushOverlayHandle` interface. Internally calls the existing `updatePosition` method.

### Behavior

- When hand tracking is active and detecting a hand: overlay follows `clientPosition` from the hook
- When hand tracking is inactive or no hand detected: overlay follows mouse/touch as it does today
- No visual distinction — it's the same green circle either way

## Mobile Isolation

- The `useHandTracking` hook is imported but `enabled` is always `false` on mobile — zero side effects
- The toggle UI to enable hand tracking is conditionally rendered: hidden when `window.Capacitor` is defined
- No dynamic imports or code-splitting needed — MediaPipe WASM/model files load from CDN at runtime only when activated, so they don't affect bundle size
- Zero changes to `src/engine/` — the mobile build path is completely untouched

## Dependencies

| Package | Purpose | Install location |
|---------|---------|-----------------|
| `@mediapipe/tasks-vision` | Hand landmark detection (WASM + JS API) | Root `package.json` (frontend) |

Model files (`hand_landmarker.task`) are fetched from the MediaPipe CDN at runtime, not bundled.

## Files Changed

| File | Change |
|------|--------|
| `src/hooks/useHandTracking.ts` | New file — the hook |
| `src/pages/canvas/CanvasPage.tsx` | Import hook, add state + effect for engine input, pass hand position to BrushOverlay, add toggle UI |
| `package.json` | Add `@mediapipe/tasks-vision` dependency |

## Out of Scope (Future Work)

- Left hand menu control (open palm = open menu, pinch gesture = select)
- Webcam preview overlay (PiP or translucent)
- Hand tracking settings UI (sensitivity, smoothing, landmark choice)
