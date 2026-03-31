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
  /** true when right hand thumb+index are pinched together */
  isDrawing: boolean;
  /** Brush size from left hand pinch spread (palm-facing only), or null if not set */
  brushSize: number | null;
}

const DEFAULT_STATE: HandTrackingState = {
  isActive: false,
  clientPosition: { x: 0, y: 0 },
  canvasPosition: { x: 0, y: 0 },
  isDrawing: false,
  brushSize: null,
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
const PINKY_MCP = 17;

// Right hand: two-gesture draw control
// Pinch (ratio < PINCH_CLOSED) starts drawing; wide spread (ratio > SPREAD_OFF) stops it.
// Large dead zone between them means normal drawing motion can't trigger either state.
const PINCH_CLOSED = 0.2;  // firmly pinched — starts drawing
const SPREAD_OFF = 0.75;   // wide thumb+index spread — stops drawing
const PINCH_FRAMES = 3;    // consecutive frames to confirm pinch-start
const SPREAD_FRAMES = 3;   // consecutive frames to confirm spread-stop

// Palm hysteresis (left hand brush size gate)
// Asymmetric: fast lock prevents brush jumping during wrist rotation,
// slow unlock requires deliberate palm-facing gesture to re-activate
const PALM_LOCK_FRAMES = 2;
const PALM_UNLOCK_FRAMES = 8;

// Left hand: pinch spread range mapped to brush size
const BRUSH_PINCH_MIN = 0.15;
const BRUSH_PINCH_MAX = 0.9;

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

function mapPinchToBrushSize(ratio: number, minBrush: number, maxBrush: number): number {
  const t = Math.max(0, Math.min(1, (ratio - BRUSH_PINCH_MIN) / (BRUSH_PINCH_MAX - BRUSH_PINCH_MIN)));
  return minBrush + t * (maxBrush - minBrush);
}

/**
 * Detects whether the left hand's palm is facing the camera.
 * Uses the 2D cross product of (INDEX_MCP - WRIST) × (PINKY_MCP - WRIST).
 * Positive = palm facing camera for a left hand on a front-facing (user) camera.
 * Rotating the wrist so the back faces the camera flips the sign.
 */
function isPalmFacingCamera(landmarks: NormalizedLandmark[]): boolean {
  const wrist = landmarks[WRIST];
  const indexMcp = landmarks[INDEX_MCP];
  const pinkyMcp = landmarks[PINKY_MCP];
  const ax = indexMcp.x - wrist.x;
  const ay = indexMcp.y - wrist.y;
  const bx = pinkyMcp.x - wrist.x;
  const by = pinkyMcp.y - wrist.y;
  return ax * by - ay * bx > 0;
}

// --- Hook ---

export function useHandTracking(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  enabled: boolean,
  brushRange: { min: number; max: number },
): HandTrackingState {
  const [state, setState] = useState<HandTrackingState>(DEFAULT_STATE);

  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rafIdRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  // Right hand: two-gesture draw state
  const lastDrawStateRef = useRef(false);  // current draw state
  const pinchFrameCountRef = useRef(0);   // consecutive frames confirming current gesture

  // Position filters (One-Euro): minCutoff=1.0 kills jitter at rest, beta=0.15 reduces lag at speed
  const filterXRef = useRef(new OneEuroFilter(1.0, 0.15));
  const filterYRef = useRef(new OneEuroFilter(1.0, 0.15));

  // Brush size filter (One-Euro): smoother, no speed adaptation
  const filterBrushRef = useRef(new OneEuroFilter(0.5, 0.0));

  // Last committed brush size — held when palm turns away or left hand drops out
  const lastBrushSizeRef = useRef<number | null>(null);

  // Left hand: palm orientation state + hysteresis counter
  const palmFacingRef = useRef(false);
  const palmCounterRef = useRef(0);

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
    lastDrawStateRef.current = false;
    pinchFrameCountRef.current = 0;
    filterXRef.current.reset();
    filterYRef.current.reset();
    filterBrushRef.current.reset();
    lastBrushSizeRef.current = null;
    palmFacingRef.current = false;
    palmCounterRef.current = 0;
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

      try {
        await video.play();

        // Load MediaPipe
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        if (cancelled) return;

        const handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_URL },
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
          // Reset filters so re-entry starts at actual position (no straight-line artifact)
          filterXRef.current.reset();
          filterYRef.current.reset();
          pinchFrameCountRef.current = 0;
          if (lastDrawStateRef.current) {
            lastDrawStateRef.current = false;
            setState((prev) => ({ ...prev, isActive: false, isDrawing: false }));
          } else {
            setState((prev) => (prev.isActive ? { ...prev, isActive: false } : prev));
          }
          return;
        }

        const rightLandmarks = result.landmarks[rightHandIndex];

        // Position: palm center (landmark 9), mirror X to match viewport orientation
        const palm = rightLandmarks[MIDDLE_MCP];
        const rawX = (1 - palm.x) * window.innerWidth;
        const rawY = palm.y * window.innerHeight;

        const clientX = filterXRef.current.filter(rawX, timestamp);
        const clientY = filterYRef.current.filter(rawY, timestamp);

        // Engine coords: convert client position to canvas space (Y-flipped)
        const rect = canvas.getBoundingClientRect();
        const canvasX = (clientX - rect.left) * (canvas.width / rect.width);
        const canvasY = canvas.height - (clientY - rect.top) * (canvas.height / rect.height);

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

        // --- Left hand: brush size (only when palm faces camera) ---
        // Turn wrist away from screen to lock brush size; turn palm back to adjust.

        let brushSize: number | null = lastBrushSizeRef.current;

        if (leftHandIndex !== -1 && result.landmarks[leftHandIndex]) {
          const leftLandmarks = result.landmarks[leftHandIndex];

          // Palm orientation with asymmetric hysteresis:
          // - locking (facing→away) is fast to freeze brush before rotation distorts landmarks
          // - unlocking (away→facing) is slow to require a deliberate gesture
          const rawPalmFacing = isPalmFacingCamera(leftLandmarks);
          if (rawPalmFacing !== palmFacingRef.current) {
            palmCounterRef.current++;
            const threshold = palmFacingRef.current ? PALM_LOCK_FRAMES : PALM_UNLOCK_FRAMES;
            if (palmCounterRef.current >= threshold) {
              palmFacingRef.current = rawPalmFacing;
              palmCounterRef.current = 0;
            }
          } else {
            palmCounterRef.current = 0;
          }

          if (palmFacingRef.current) {
            // Palm facing camera: live brush size from pinch spread
            const { min, max } = brushRangeRef.current;
            const rawBrush = mapPinchToBrushSize(getPinchRatio(leftLandmarks), min, max);
            const smoothedBrush = filterBrushRef.current.filter(rawBrush, timestamp);
            brushSize = Math.round(smoothedBrush);
            lastBrushSizeRef.current = brushSize;
          } else {
            // Palm turned away: lock size and reset filter so next activation
            // starts fresh rather than interpolating from a stale position
            filterBrushRef.current.reset();
          }
        }

        // --- Update state ---

        const drawState = lastDrawStateRef.current;

        setState((prev) => {
          if (
            prev.isActive &&
            prev.isDrawing === drawState &&
            prev.brushSize === brushSize &&
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
