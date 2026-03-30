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
  /** Brush size from left hand pinch spread, or null if left hand not detected */
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
const WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

// Landmark indices
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;

// Hysteresis: frames a gesture must hold before toggling draw state
const DRAW_HYSTERESIS_FRAMES = 3;

// Right hand: pinch thresholds with hysteresis band
// Must pinch below PINCH_ON to start drawing, must release above PINCH_OFF to stop
const PINCH_ON = 0.2;
const PINCH_OFF = 0.35;

// Left hand: pinch range for brush size mapping
const BRUSH_PINCH_MIN = 0.15;
const BRUSH_PINCH_MAX = 0.9;

// EMA smoothing factors (lower = smoother)
const POSITION_SMOOTH_FACTOR = 0.6;
const BRUSH_SMOOTH_FACTOR = 0.15;

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

function isPinching(landmarks: NormalizedLandmark[], wasDrawing: boolean): boolean {
  const ratio = getPinchRatio(landmarks);
  // Hysteresis: harder to start drawing than to stop
  return wasDrawing ? ratio < PINCH_OFF : ratio < PINCH_ON;
}

function mapPinchToBrushSize(
  ratio: number,
  minBrush: number,
  maxBrush: number,
): number {
  const t = Math.max(0, Math.min(1, (ratio - BRUSH_PINCH_MIN) / (BRUSH_PINCH_MAX - BRUSH_PINCH_MIN)));
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

  // Right hand: hysteresis counter for draw state
  const drawCounterRef = useRef(0);
  const lastDrawStateRef = useRef(false);

  // Smoothed position (client coords)
  const smoothXRef = useRef<number | null>(null);
  const smoothYRef = useRef<number | null>(null);

  // Left hand: smoothed brush size
  const smoothBrushRef = useRef<number | null>(null);

  // Keep brush range in a ref so the rAF loop reads the latest value
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
    smoothXRef.current = null;
    smoothYRef.current = null;
    smoothBrushRef.current = null;
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
        if (videoRef.current.readyState < 2) return; // not enough data

        const result = handLandmarkerRef.current.detectForVideo(
          videoRef.current,
          performance.now(),
        );

        // Find right and left hands using handedness labels
        // Right hand = cursor + draw, Left hand = brush size only
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
          // Reset position smoothing so re-entry starts fresh
          smoothXRef.current = null;
          smoothYRef.current = null;
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

        const rightLandmarks = result.landmarks[rightHandIndex];

        // Position: palm center (landmark 9), mirrored X
        // Map to full viewport like a mouse cursor
        const palm = rightLandmarks[MIDDLE_MCP];
        const rawX = (1 - palm.x) * window.innerWidth;
        const rawY = palm.y * window.innerHeight;

        // Smooth position with EMA — initialize on first detection
        if (smoothXRef.current === null) {
          smoothXRef.current = rawX;
          smoothYRef.current = rawY;
        } else {
          smoothXRef.current = smoothXRef.current * (1 - POSITION_SMOOTH_FACTOR) + rawX * POSITION_SMOOTH_FACTOR;
          smoothYRef.current = smoothYRef.current! * (1 - POSITION_SMOOTH_FACTOR) + rawY * POSITION_SMOOTH_FACTOR;
        }
        const clientX = smoothXRef.current;
        const clientY = smoothYRef.current!;

        // Engine coords: convert client position to canvas space
        const rect = canvas.getBoundingClientRect();
        const canvasX = (clientX - rect.left) * (canvas.width / rect.width);
        const canvasY = canvas.height - (clientY - rect.top) * (canvas.height / rect.height);

        // Draw state: pinch = drawing, with hysteresis band + frame hysteresis
        const rawPinch = isPinching(rightLandmarks, lastDrawStateRef.current);
        if (rawPinch !== lastDrawStateRef.current) {
          drawCounterRef.current++;
          if (drawCounterRef.current >= DRAW_HYSTERESIS_FRAMES) {
            lastDrawStateRef.current = rawPinch;
            drawCounterRef.current = 0;
          }
        } else {
          drawCounterRef.current = 0;
        }

        // --- Left hand: brush size ---

        let brushSize: number | null = null;
        if (leftHandIndex !== -1 && result.landmarks[leftHandIndex]) {
          const leftLandmarks = result.landmarks[leftHandIndex];
          const pinchRatio = getPinchRatio(leftLandmarks);
          const { min, max } = brushRangeRef.current;
          const rawBrush = mapPinchToBrushSize(pinchRatio, min, max);

          // Heavy EMA smoothing — initialize on first detection
          if (smoothBrushRef.current === null) {
            smoothBrushRef.current = rawBrush;
          } else {
            smoothBrushRef.current =
              smoothBrushRef.current * (1 - BRUSH_SMOOTH_FACTOR) +
              rawBrush * BRUSH_SMOOTH_FACTOR;
          }
          brushSize = Math.round(smoothBrushRef.current);
        } else {
          // Left hand gone — keep last known brush size (don't reset to null)
          // so brush doesn't jump when left hand briefly drops out
          if (smoothBrushRef.current !== null) {
            brushSize = Math.round(smoothBrushRef.current);
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
