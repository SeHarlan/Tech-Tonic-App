import type { ShaderParams } from './types';

export const SEED_MODULUS = 1000;

// --- Seeded RNG (mulberry32) ---

export function createSeededRNG(seedValue: number): () => number {
  let a = seedValue;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normalizeSeed(seedValue: number): number {
  const numericSeed = Number(seedValue);
  if (!Number.isFinite(numericSeed)) return 0;
  return Math.floor(Math.abs(numericSeed)) % SEED_MODULUS;
}

// --- Weighted Random ---

export function weightedRandom<T>(
  weights: [T, number][],
  rng: () => number = Math.random,
): T {
  const entries: [T, number][] = weights;

  if (entries.length === 0) return undefined as T;

  const totalWeight = entries.reduce(
    (acc, [, weight]) => acc + Math.max(0, weight),
    0,
  );
  if (totalWeight === 0) return undefined as T;

  const randomValue = rng() * totalWeight;
  let cumulativeWeight = 0;
  for (const [value, weight] of entries) {
    cumulativeWeight += Math.max(0, weight);
    if (randomValue <= cumulativeWeight) {
      return value;
    }
  }
  // Fallback (floating point edge cases)
  return entries[entries.length - 1][0];
}

// --- Shape Scale Helpers ---

function getShapeScale(
  baseScale: [number, number],
  threshold: number,
  adjustmentFactor: number,
  fxWithBlocking: boolean,
  blockingScale: number,
): [number, number] {
  // shapeNormalizer keeps shape size stable so threshold acts as frequency adjuster
  const shapeNormalizer = 0.2 / threshold;
  return baseScale.map((n) => {
    let base = fxWithBlocking ? n / blockingScale : n;
    base /= shapeNormalizer;
    base /= adjustmentFactor;
    return base;
  }) as [number, number];
}

export function getFallShapeScale(
  threshold: number,
  useFallBlob: boolean,
  fxWithBlocking: boolean,
  blockingScale: number,
): [number, number] {
  const shouldFallBaseScale: [number, number] = useFallBlob
    ? [10, 8]
    : [10, 0.5];
  const blobAdjustment = useFallBlob ? 3 : 1;
  return getShapeScale(shouldFallBaseScale, threshold, blobAdjustment, fxWithBlocking, blockingScale);
}

export function getMoveShapeScale(
  threshold: number,
  useMoveBlob: boolean,
  fxWithBlocking: boolean,
  blockingScale: number,
): [number, number] {
  const shouldMoveBaseScale: [number, number] = useMoveBlob
    ? [5, 5]
    : [0.5, 5];
  const blobAdjustment = useMoveBlob ? 2 : 1;
  return getShapeScale(shouldMoveBaseScale, threshold, blobAdjustment, fxWithBlocking, blockingScale);
}

// --- Parameter Randomization ---
export function randomizeShaderParameters(seedValue: number): ShaderParams {
  const rngSeed = normalizeSeed(seedValue);
  const rng = createSeededRNG(rngSeed);

  const randomFloat = (min: number, max: number) =>
    rng() * (max - min) + min;

  // Blocking parameters
  const fxWithBlocking = weightedRandom<boolean>(
    [
      [true, 1],
      [false, 9],
    ],
    rng,
  );

  let blockingScale: number;
  if (fxWithBlocking) {
    blockingScale = weightedRandom<number>(
      [
        [4, 1],
        [8, 5],
        [16, 10],
        [32, 5],
        [64, 1],
      ],
      rng,
    );
  } else {
    blockingScale = weightedRandom<number>(
      [
        [8, 1],
        [16, 2],
        [32, 5],
        [64, 10],
        [128, 5],
        [256, 2],
        [512, 1],
      ],
      rng,
    );
  }

  // Move parameters
  const shouldMoveThreshold = weightedRandom<number>(
    [
      [0.1, 1],
      [0.15, 2],
      [0.2, 5],
      [0.25, 2],
      [0.3, 1],
    ],
    rng,
  );

  const useMoveBlob = rng() < 0.2;
  const moveShapeSpeed = useMoveBlob ? 0.03125 : 0.025;
  const moveShapeScale = getMoveShapeScale(shouldMoveThreshold, useMoveBlob, fxWithBlocking, blockingScale);

  // Fall parameters
  const shouldFallThreshold = weightedRandom<number>(
    [
      [0.1, 1],
      [0.15, 2],
      [0.2, 5],
      [0.25, 2],
      [0.3, 1],
    ],
    rng,
  );

  const fallWaterfallMult = weightedRandom<number>(
    [
      [1, 1],
      [1.25, 2],
      [1.5, 4],
      [1.75, 2],
      [2, 1],
    ],
    rng,
  );

  const defaultWaterfallMode = weightedRandom<boolean>(
    [
      [false, 1],
      [true, 4],
    ],
    rng,
  );

  const useFallBlob = rng() < 0.2;
  const fallShapeSpeed = useFallBlob ? 0.052 : 0.044;
  const shouldFallScale = getFallShapeScale(shouldFallThreshold, useFallBlob, fxWithBlocking, blockingScale);

  // Black noise parameters
  // const blackNoiseThreshold = weightedRandom<number>(
  //   [
  //     [0.45, 1],
  //     [0.5, 6],
  //     [0.55, 1],
  //   ],
  //   rng,
  // );
  const blackNoiseThreshold = 0.5
  
  const blackNoiseBaseScale = [
    Math.floor(randomFloat(4, 10)),
    Math.floor(randomFloat(4, 10)),
  ];

  const blackNoiseScale: [number, number] = [
    blackNoiseBaseScale[0] / blockingScale,
    blackNoiseBaseScale[1] / blockingScale,
  ];

  const blackNoiseEdgeMult = weightedRandom<number>(
    [
      [0.0, 1],
      [0.025, 4],
    ],
    rng,
  );

  // Reset parameters
  const resetThreshold = weightedRandom<number>(
    [
      [0.4, 1],
      [0.45, 2],
      [0.5, 4],
      [0.55, 2],
      [0.6, 1],
    ],
    rng,
  );

  const resetNoiseScale: [number, number] = [
    blackNoiseBaseScale[0] / blockingScale,
    blackNoiseBaseScale[1] / blockingScale,
  ];

  // Ribbon/dirt parameters
  const dirtNoiseScale: [number, number] = [
    randomFloat(2400.0, 2600.0),
    randomFloat(2400.0, 2600.0),
  ];

  const blankStaticScale: [number, number] = [randomFloat(90, 110.0), 0.321];

  // Extra fall parameters
  const extraFallShapeThreshold = weightedRandom<number>(
    [
      [0, 1],
      [0.05, 2],
      [0.1, 5],
      [0.2, 2],
      [0.3, 1],
    ],
    rng,
  );

  const extraFallShapeScale = getFallShapeScale(
    extraFallShapeThreshold,
    useFallBlob,
    fxWithBlocking,
    blockingScale,
  ).map((x) => x * 3) as [number, number];

  // Extra move parameters
  const extraMoveShapeThreshold = weightedRandom<number>(
    [
      [0, 1],
      [0.05, 2],
      [0.1, 5],
      [0.2, 2],
      [0.3, 1],
    ],
    rng,
  );

  const extraMoveShapeScale = getMoveShapeScale(
    extraMoveShapeThreshold,
    useMoveBlob,
    fxWithBlocking,
    blockingScale,
  ).map((x) => x * 3) as [number, number];

  // Domain warp: how much the noise boundaries swirl/fold
  // Operates in normalized noise-space, so no blockingScale scaling needed
  const domainWarpAmount = weightedRandom<number>(
    [
      [1.0, 1],
      [2.0, 2],
      [3.0, 3],
      [4.0, 3],
      [5.0, 2],
      [6.0, 1],
    ],
    rng,
  );
  

  // Pattern overlay: geometric patterns mixed with noise (0=none, 1=radial, 2=diagonal, 3=ridged)
  const patternMode = weightedRandom<number>(
    [
      [0, 3],
      [1, 1],
      [2, 1],
      [3, 2],
    ],
    rng,
  );

  const patternStrength = patternMode === 0 ? 0 : randomFloat(0.25, .75);
  const patternFreq = randomFloat(1.0, 4.0);

  // Golden ratio focal points for pattern origin
  const goldenPoints: [number, number][] = [
    [0.382, 0.382],
    [0.618, 0.382],
    [0.382, 0.618],
    [0.618, 0.618],
  ];
  const patternCenter = goldenPoints[Math.floor(rng() * goldenPoints.length)];

  // Corner mirror: how much opposite corners reflect each other
  const mirrorAmount = randomFloat(0, .66);
  const mirrorAxis = rng() < 0.5 ? 0 : 1; // 0=TL↔BR, 1=TR↔BL

  return {
    seed: rngSeed,
    fxWithBlocking,
    blockingScale,
    shouldMoveThreshold,
    useMoveBlob,
    moveShapeSpeed,
    moveShapeScale,
    shouldFallThreshold,
    useFallBlob,
    fallShapeSpeed,
    shouldFallScale,
    fallWaterfallMult,
    defaultWaterfallMode,
    blackNoiseThreshold,
    blackNoiseScale,
    blackNoiseEdgeMult,
    resetThreshold,
    resetNoiseScale,
    dirtNoiseScale,
    blankStaticScale,
    extraFallShapeThreshold,
    extraFallShapeScale,
    extraMoveShapeThreshold,
    extraMoveShapeScale,
    domainWarpAmount,
    patternMode,
    patternStrength,
    patternFreq,
    patternCenter,
    mirrorAmount,
    mirrorAxis,
  };
}

// --- Default Parameters (seed 0) ---

export const DEFAULT_PARAMS: ShaderParams = randomizeShaderParameters(0);
