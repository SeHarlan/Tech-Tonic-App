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
  time: number;
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
  useMoveBlob: boolean;
  moveShapeSpeed: number;
  moveShapeScale: [number, number];
  shouldFallThreshold: number;
  useFallBlob: boolean;
  fallShapeSpeed: number;
  shouldFallScale: [number, number];
  fallWaterfallMult: number;
  defaultWaterfallMode: boolean;
  blackNoiseThreshold: number;
  blackNoiseScale: [number, number];
  blackNoiseEdgeMult: number;
  resetThreshold: number;
  resetNoiseScale: [number, number];
  dirtNoiseScale: [number, number];
  blankStaticScale: [number, number];
  extraFallShapeThreshold: number;
  extraFallShapeScale: [number, number];
  extraMoveShapeThreshold: number;
  extraMoveShapeScale: [number, number];
}

// --- Drawing Types ---

export type DrawMode =
  | 'waterfall' | 'move' | 'shuffle' | 'trickle'
  | 'erase' | 'freeze'
  | 'static' | 'gem' | 'empty';

export type Direction = 'up' | 'down' | 'left' | 'right';

export type EraseVariant = 'movement' | 'paint' | 'both';

export type WaterfallVariant = boolean;
