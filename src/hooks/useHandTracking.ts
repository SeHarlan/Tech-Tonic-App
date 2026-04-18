import { useRef, useState, useEffect, useCallback } from 'react';
import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { clientToCanvas } from '../utils/canvas-aspect';

// --- Types ---

export interface HandTrackingState {
  /** MediaPipe loaded and detecting a hand */
  isActive: boolean;
  /** Screen coordinates for cursor dot + brush ring positioning */
  clientPosition: { x: number; y: number };
  /** Engine coordinates (1920x1080, Y-flipped) for handlePointerDown/Move/Up */
  canvasPosition: { x: number; y: number };
  /** true when right hand thumb+index are pinched together */
  isDrawing: boolean;
  /** Brush size from two-hand distance gesture, or null when locked */
  brushSize: number | null;
  /** true while the two-hand brush-adjust gesture gate is satisfied */
  isAdjustingBrush: boolean;
}

const DEFAULT_STATE: HandTrackingState = {
  isActive: false,
  clientPosition: { x: 0, y: 0 },
  canvasPosition: { x: 0, y: 0 },
  isDrawing: false,
  brushSize: null,
  isAdjustingBrush: false,
};

// MediaPipe model hosted on Google's CDN — downloaded at runtime only when enabled
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

// Landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const RING_MCP = 13;
const PINKY_MCP = 17;
const MIDDLE_TIP = 12;
const RING_TIP = 16;
const PINKY_TIP = 20;

// Right hand: two-gesture draw control
// Pinch (ratio < PINCH_CLOSED) starts drawing; wide spread (ratio > SPREAD_OFF) stops it.
// Large dead zone between them means normal drawing motion can't trigger either state.
const PINCH_CLOSED = 0.28; // pinched — starts drawing
const SPREAD_OFF = 0.45;   // thumb+index spread — stops drawing
const PINCH_FRAMES = 3;    // consecutive frames to confirm pinch-start
const SPREAD_FRAMES = 1;   // release should feel instant; engage stays gated

// Left-hand grab-and-drag brush adjust
// Make a fist with the left hand to "grab" — that anchors the current brush
// size and the hand's Y position. While the fist is held, vertical hand
// movement scales the brush relative to the anchor: up = bigger, down = smaller.
// Open the hand to release; the size stays where you left it.
const GRAB_ON_FRAMES = 4;   // fist must hold this long to engage
const GRAB_OFF_FRAMES = 3;  // un-fist must hold this long to release
// Mapping: how much normalized Y travel covers the full brush range.
// 0.5 means moving the hand half the camera frame's height covers min↔max.
const GRAB_FULL_RANGE_Y = 0.5;

// --- Cursor stability ---
// Map an inset region of the camera frame to the full viewport. MediaPipe
// tracking is noisiest near frame edges (low landmark confidence, lens
// distortion), so we let the hand stay well inside the reliable center region
// while still reaching the window edges. Users only need their hand to move
// through roughly the middle 70% of the camera frame to cover the full screen.
const CURSOR_EDGE_INSET_X = 0.15;
const CURSOR_EDGE_INSET_Y = 0.12;
// Keep the cursor visible for this many frames after the hand is lost — masks
// brief detection dropouts without committing to the last position forever.
const CURSOR_PERSISTENCE_FRAMES = 6;

// --- One-Euro Filter ---
// Adapts smoothing to velocity: fast movement = low smoothing (responsive),
// slow/still = heavy smoothing (jitter killed). Much better than EMA for drawing.

class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(minCutoff = 1.0, beta = 0.0, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private alpha(cutoff: number, dt: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x: number, t: number): number {
    if (this.xPrev === null || this.tPrev === null) {
      this.xPrev = x;
      this.tPrev = t;
      return x;
    }
    const dt = Math.max((t - this.tPrev) / 1000, 0.001); // seconds, clamped
    const dx = (x - this.xPrev) / dt;
    const aDx = this.alpha(this.dCutoff, dt);
    const dxHat = aDx * dx + (1 - aDx) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = this.alpha(cutoff, dt);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = t;
    return xHat;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }
}

// --- Gesture Helpers ---

interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
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

/**
 * Detects a closed fist — all four non-thumb fingertips curled toward the wrist.
 * Compares each tip's distance to the wrist against the corresponding MCP joint:
 * a curled finger has its tip closer to the wrist than its base knuckle is.
 * Requires at least 3 of 4 fingers curled for robustness.
 */
function isFist(landmarks: NormalizedLandmark[]): boolean {
  const wrist = landmarks[WRIST];
  const fingers: [number, number][] = [
    [INDEX_TIP, INDEX_MCP],
    [MIDDLE_TIP, MIDDLE_MCP],
    [RING_TIP, RING_MCP],
    [PINKY_TIP, PINKY_MCP],
  ];
  let curled = 0;
  for (const [tipIdx, mcpIdx] of fingers) {
    const tipDist = euclideanDist(landmarks[tipIdx], wrist);
    const mcpDist = euclideanDist(landmarks[mcpIdx], wrist);
    if (tipDist < mcpDist * 1.05) curled++;
  }
  return curled >= 3;
}

// --- Hook ---

export function useHandTracking(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  brushRange: { min: number; max: number },
  /**
   * Called once on grab-start to capture the brush size that the gesture
   * should anchor to. Vertical hand movement during the grab is added to this
   * baseline. Should return the engine's current brush size at call time.
   */
  getCurrentBrushSize: () => number,
  /**
   * True when the canvas element is CSS-rotated 90° clockwise (portrait
   * viewport). Canvas-space coords need their axes swapped to account for
   * the rotation — the bounding rect's X spans canvas Y and vice versa.
   */
  rotated = false,
): HandTrackingState {
  const [state, setState] = useState<HandTrackingState>(DEFAULT_STATE);

  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  // Throttle inference to every other animation frame (~30Hz). Canvas keeps
  // rendering at full rate via rAF; only MediaPipe detection is skipped.
  const frameCounterRef = useRef(0);

  // Right hand: two-gesture draw state
  const lastDrawStateRef = useRef(false);  // current draw state
  const pinchFrameCountRef = useRef(0);   // consecutive frames confirming current gesture

  // Position filters (One-Euro): lower minCutoff = heavier smoothing at rest;
  // beta lets fast motion escape the smoothing. Tuned to kill edge jitter.
  const filterXRef = useRef(new OneEuroFilter(0.3, 0.06));
  const filterYRef = useRef(new OneEuroFilter(0.3, 0.06));

  // Persist last good cursor across brief detection dropouts
  const lastGoodClientRef = useRef<{ x: number; y: number } | null>(null);
  const lastGoodCanvasRef = useRef<{ x: number; y: number } | null>(null);
  const lostFramesRef = useRef(0);

  // Brush size filter (One-Euro): smoother, no speed adaptation
  const filterBrushRef = useRef(new OneEuroFilter(0.5, 0.0));

  // Left-hand grab gesture state
  const isGrabbingRef = useRef(false);
  const grabOnCounterRef = useRef(0);
  const grabOffCounterRef = useRef(0);
  const anchorYRef = useRef(0);          // normalized Y at the moment of grab
  const startingBrushRef = useRef(0);    // engine brush size at the moment of grab

  const brushRangeRef = useRef(brushRange);
  useEffect(() => { brushRangeRef.current = brushRange; }, [brushRange]);

  const rotatedRef = useRef(rotated);
  useEffect(() => { rotatedRef.current = rotated; }, [rotated]);

  const getBrushSizeRef = useRef(getCurrentBrushSize);
  useEffect(() => { getBrushSizeRef.current = getCurrentBrushSize; }, [getCurrentBrushSize]);

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
    lastDrawStateRef.current = false;
    pinchFrameCountRef.current = 0;
    filterXRef.current.reset();
    filterYRef.current.reset();
    filterBrushRef.current.reset();
    isGrabbingRef.current = false;
    grabOnCounterRef.current = 0;
    grabOffCounterRef.current = 0;
    anchorYRef.current = 0;
    startingBrushRef.current = 0;
    lastGoodClientRef.current = null;
    lastGoodCanvasRef.current = null;
    lostFramesRef.current = 0;
    setState(DEFAULT_STATE);
  }, []);

  useEffect(() => {
    if (!enabled) {
      // cleanup() resets state to DEFAULT_STATE — intentional when toggling off.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

      try {
        await video.play();

        // Load MediaPipe
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
          numHands: 2,
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
      } catch {
        console.warn('[HandTracking] Failed to initialize MediaPipe');
        cleanup();
        return;
      }

      // Start detection loop
      function detect() {
        if (cancelled) return;
        rafIdRef.current = requestAnimationFrame(detect);

        const canvas = canvasRef.current;
        if (!canvas || !videoRef.current || !handLandmarkerRef.current) return;
        if (videoRef.current.readyState < 2) return;

        // Run inference every other frame (~30Hz) — imperceptible for pointing
        // gestures and halves CPU/GPU load.
        if ((frameCounterRef.current++ & 1) !== 0) return;

        const timestamp = performance.now();
        const result = handLandmarkerRef.current.detectForVideo(videoRef.current, timestamp);

        // Right hand = cursor + draw, Left hand = brush size only (palm-facing gate)
        let rightHandIndex = -1;
        let leftHandIndex = -1;
        if (result.landmarks.length >= 1 && result.handedness) {
          for (let i = 0; i < result.handedness.length; i++) {
            const cats = result.handedness[i];
            if (!cats || cats.length === 0) continue;
            if (cats[0].categoryName === 'Right') rightHandIndex = i;
            else if (cats[0].categoryName === 'Left') leftHandIndex = i;
          }
        }

        // --- Right hand: position + drawing ---

        if (rightHandIndex === -1 || !result.landmarks[rightHandIndex]) {
          // Hand lost — persist the last good cursor position for a few frames
          // so brief detection dropouts (common at frame edges) don't flash the
          // cursor off-screen. After the persistence window, we commit to lost.
          pinchFrameCountRef.current = 0;
          lostFramesRef.current++;
          if (
            lostFramesRef.current <= CURSOR_PERSISTENCE_FRAMES &&
            lastGoodClientRef.current &&
            lastGoodCanvasRef.current
          ) {
            // Keep cursor visible at last good position; cancel any in-progress
            // stroke (since we can't track movement reliably).
            if (lastDrawStateRef.current) {
              lastDrawStateRef.current = false;
              setState((prev) => ({ ...prev, isDrawing: false }));
            }
            return;
          }
          // Committed lost — reset filters so re-entry snaps to fresh position.
          // Also cap lostFramesRef so it doesn't grow unboundedly while the
          // hand stays out of frame.
          filterXRef.current.reset();
          filterYRef.current.reset();
          lastGoodClientRef.current = null;
          lastGoodCanvasRef.current = null;
          lostFramesRef.current = CURSOR_PERSISTENCE_FRAMES + 1;
          if (lastDrawStateRef.current) {
            lastDrawStateRef.current = false;
            setState((prev) => ({ ...prev, isActive: false, isDrawing: false }));
          } else {
            setState((prev) => (prev.isActive ? { ...prev, isActive: false } : prev));
          }
          return;
        }

        lostFramesRef.current = 0;
        const rightLandmarks = result.landmarks[rightHandIndex];

        // Position: palm center (MIDDLE_MCP), mirrored for natural viewport orientation.
        // Map an inset region of the camera frame to the full viewport so the
        // hand stays in the more reliable center portion of the frame.
        const palm = rightLandmarks[MIDDLE_MCP];
        const mirroredX = 1 - palm.x;
        const rangeX = 1 - 2 * CURSOR_EDGE_INSET_X;
        const rangeY = 1 - 2 * CURSOR_EDGE_INSET_Y;
        const normX = Math.max(0, Math.min(1, (mirroredX - CURSOR_EDGE_INSET_X) / rangeX));
        const normY = Math.max(0, Math.min(1, (palm.y - CURSOR_EDGE_INSET_Y) / rangeY));
        const rawX = normX * window.innerWidth;
        const rawY = normY * window.innerHeight;

        const clientX = filterXRef.current.filter(rawX, timestamp);
        const clientY = filterYRef.current.filter(rawY, timestamp);

        const { x: canvasX, y: canvasY } = clientToCanvas(clientX, clientY, canvas, rotatedRef.current);

        lastGoodClientRef.current = { x: clientX, y: clientY };
        lastGoodCanvasRef.current = { x: canvasX, y: canvasY };

        // Draw state: pinch starts, wide spread stops, dead zone in between
        const ratio = getPinchRatio(rightLandmarks);
        if (!lastDrawStateRef.current) {
          // Not drawing — watch for firm pinch to start
          if (ratio < PINCH_CLOSED) {
            pinchFrameCountRef.current++;
            if (pinchFrameCountRef.current >= PINCH_FRAMES) {
              lastDrawStateRef.current = true;
              pinchFrameCountRef.current = 0;
            }
          } else {
            pinchFrameCountRef.current = 0;
          }
        } else {
          // Drawing — watch for wide spread to stop
          if (ratio > SPREAD_OFF) {
            pinchFrameCountRef.current++;
            if (pinchFrameCountRef.current >= SPREAD_FRAMES) {
              lastDrawStateRef.current = false;
              pinchFrameCountRef.current = 0;
            }
          } else {
            pinchFrameCountRef.current = 0;
          }
        }

        // --- Left hand: grab-and-drag brush adjust ---
        // Make a fist with the left hand to engage. Vertical hand movement
        // from the anchor point scales the brush relative to the size at the
        // moment of grab. Open the hand to release; the brush stays put.
        //
        // brushSize is null unless the grab is active THIS frame. Returning
        // null when idle is critical: CanvasPage's brush-sync effect only
        // writes when non-null, so menu / wheel / keyboard inputs aren't
        // overwritten.
        let brushSize: number | null = null;

        if (leftHandIndex !== -1 && result.landmarks[leftHandIndex]) {
          const leftLandmarks = result.landmarks[leftHandIndex];
          const grabRaw = isFist(leftLandmarks);

          if (grabRaw) {
            grabOffCounterRef.current = 0;
            if (!isGrabbingRef.current) {
              grabOnCounterRef.current++;
              if (grabOnCounterRef.current >= GRAB_ON_FRAMES) {
                // Engage: capture anchor + starting size
                isGrabbingRef.current = true;
                anchorYRef.current = leftLandmarks[WRIST].y;
                startingBrushRef.current = getBrushSizeRef.current();
                filterBrushRef.current.reset();
              }
            }
          } else {
            grabOnCounterRef.current = 0;
            if (isGrabbingRef.current) {
              grabOffCounterRef.current++;
              if (grabOffCounterRef.current >= GRAB_OFF_FRAMES) {
                isGrabbingRef.current = false;
                grabOffCounterRef.current = 0;
                filterBrushRef.current.reset();
              }
            }
          }

          if (isGrabbingRef.current) {
            // Hand Y in normalized image coords (0=top, 1=bottom). Up is
            // negative delta, so we negate to make "up = bigger".
            const currentY = leftLandmarks[WRIST].y;
            const deltaY = currentY - anchorYRef.current;
            const { min, max } = brushRangeRef.current;
            const range = max - min;
            const scale = -deltaY / GRAB_FULL_RANGE_Y; // -1..1 over GRAB_FULL_RANGE_Y travel
            const rawBrush = Math.max(min, Math.min(max, startingBrushRef.current + scale * range));
            const smoothedBrush = filterBrushRef.current.filter(rawBrush, timestamp);
            brushSize = Math.round(smoothedBrush);
          }
        } else {
          // Left hand lost — release immediately, no hysteresis
          grabOnCounterRef.current = 0;
          grabOffCounterRef.current = 0;
          if (isGrabbingRef.current) {
            isGrabbingRef.current = false;
            filterBrushRef.current.reset();
          }
        }

        // --- Update state ---

        const drawState = lastDrawStateRef.current;
        const adjusting = isGrabbingRef.current;

        setState((prev) => {
          if (
            prev.isActive &&
            prev.isDrawing === drawState &&
            prev.brushSize === brushSize &&
            prev.isAdjustingBrush === adjusting &&
            Math.abs(prev.clientPosition.x - clientX) < 0.5 &&
            Math.abs(prev.clientPosition.y - clientY) < 0.5
          ) {
            return prev;
          }
          return {
            isActive: true,
            clientPosition: { x: clientX, y: clientY },
            canvasPosition: { x: canvasX, y: canvasY },
            isDrawing: drawState,
            brushSize,
            isAdjustingBrush: adjusting,
          };
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
