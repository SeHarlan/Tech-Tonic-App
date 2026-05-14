// --- Engine Configuration ---

export interface EngineConfig {
  canvas: HTMLCanvasElement;
  seed?: number;
  initialState?: EngineState | null;
  onFpsUpdate?: (fps: number) => void;
  onRecordingStop?: (blob: Blob, extension: string) => void;
}

// --- Serialized State (for NFT updates + standalone renderer) ---

export interface EngineState {
  seed: number;
  totalFrameCount: number;
  params: ShaderParams;
  imageBuffer: Blob | HTMLImageElement;
  movementBuffer: Blob | HTMLImageElement;
  paintBuffer: Blob | HTMLImageElement;
}

// --- Shader Parameters (all deterministic from seed) ---

export interface ShaderParams {
  seed: number;
  fxWithBlocking: boolean;
  blockingScale: number;
  shouldMoveThreshold: number;
  moveShapeSpeed: number;
  moveShapeScale: [number, number];
  shouldFallThreshold: number;
  fallShapeSpeed: number;
  shouldFallScale: [number, number];
  fallWaterfallMult: number;
  defaultWaterfallMode: boolean;
  blackNoiseThreshold: number;
  useRibbonThreshold: number;
  blackNoiseScale: [number, number];
  blackNoiseEdgeMult: number;
  resetThreshold: number;
  dirtNoiseScale: [number, number];
  blankStaticScale: [number, number];
  blankStaticThreshold: number;
  extraFallShapeThreshold: number;
  extraFallShapeScale: [number, number];
  extraMoveShapeThreshold: number;
  extraMoveShapeScale: [number, number];
  domainWarpAmount: number;
  patternMode: number;
  patternStrength: number;
  patternFreq: number;
  patternCenter: [number, number];
  mirrorAmount: number;
  mirrorAxis: number;
  movementShapeScaling: [number, number];
  shapeNoiseMode: number;
  movementNoiseShapeDirection: number;
  blockNoiseDisableShapeMovement: boolean;
}

// --- Drawing Types ---

export type DrawMode =
  | 'waterfall' | 'move' | 'shuffle' | 'trickle'
  | 'erase' | 'freeze'
  | 'static' | 'gem' | 'empty';

export type Direction = 'up' | 'down' | 'left' | 'right';

export type EraseVariant = 'movement' | 'paint' | 'both';

export type WaterfallVariant = boolean;
